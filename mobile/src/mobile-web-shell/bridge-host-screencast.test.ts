/**
 * The binary screencast lane at the host, which is the half `bridge-screencast-binary.ts` was
 * landed without.
 *
 * Read back through the page's own reader and its own decoder rather than against a literal: what
 * matters is that the frame a native listener would have been handed is the frame the page
 * reconstructs, and a shape assertion here could agree with itself while disagreeing with the page.
 */
import { describe, expect, it } from 'vitest'
import {
  BrowserScreencastOpcode,
  type BrowserScreencastFrame
} from '../transport/browser-screencast-protocol'
import { decodeBridgeScreencastFrame } from './bridge/bridge-screencast-binary'
import { clientFrame } from './bridge-host-test-fakes'
import { harness, ID } from './bridge-host-test-harness'

const SCREENCAST = 'browser.screencast'

function screencastSubscribe(id: string, wantsBinary?: boolean): string {
  return clientFrame({
    type: 'subscribe',
    id,
    method: SCREENCAST,
    params: { worktree: 'id:w', page: 'p' },
    ...(wantsBinary === undefined ? {} : { wantsBinary })
  })
}

function frame(seq: number, image: Uint8Array): BrowserScreencastFrame {
  return {
    opcode: BrowserScreencastOpcode.Frame,
    seq,
    format: 'jpeg',
    metadata: { deviceWidth: 390, deviceHeight: 712, imageWidth: 975, imageHeight: 609 },
    image
  }
}

const IMAGE = Uint8Array.from({ length: 512 }, (_, index) => (index * 31 + 7) & 0xff)

describe('the host asks for binary only when the page did', () => {
  it('hands the client no binary listener for a plain subscribe', () => {
    const bridge = harness({ ready: true })
    bridge.host.receive(screencastSubscribe(ID))
    expect(bridge.client.streams[0]?.emitBinary).toBeNull()
  })

  it('hands the client a binary listener when the page asked for one', () => {
    const bridge = harness({ ready: true })
    bridge.host.receive(screencastSubscribe(ID, true))
    expect(bridge.client.streams[0]?.emitBinary).toBeInstanceOf(Function)
  })

  it('treats wantsBinary false as no listener at all', () => {
    const bridge = harness({ ready: true })
    bridge.host.receive(screencastSubscribe(ID, false))
    expect(bridge.client.streams[0]?.emitBinary).toBeNull()
  })
})

describe('a binary frame crosses as the event the page decodes', () => {
  it('reconstructs the frame the native listener was handed', () => {
    const bridge = harness({ ready: true })
    bridge.host.receive(screencastSubscribe(ID, true))
    bridge.client.streams[0]?.emitBinary?.(frame(41, IMAGE))
    const event = bridge.last()
    expect(event).toMatchObject({ v: 1, type: 'event', id: ID, seq: 1 })
    const binary = 'binary' in event ? event.binary : null
    expect(binary).not.toBeNull()
    expect(binary === null ? null : decodeBridgeScreencastFrame(binary)).toEqual(frame(41, IMAGE))
  })

  /** One ledger, not two: the page acks by the event seq, so a binary frame that restarted or
   *  skipped it would ack frames the shell never sent. */
  it('shares one seq sequence with the JSON events of the same stream', () => {
    const bridge = harness({ ready: true })
    bridge.host.receive(screencastSubscribe(ID, true))
    bridge.client.streams[0]?.emit({ type: 'ready' })
    bridge.client.streams[0]?.emitBinary?.(frame(0, IMAGE))
    bridge.client.streams[0]?.emit({ type: 'ready' })
    expect(
      bridge
        .frames()
        .filter((message) => message.type === 'event')
        .map((m) => m.seq)
    ).toEqual([1, 2, 3])
  })

  it('delivers nothing for a stream the page already cancelled', () => {
    const bridge = harness({ ready: true })
    bridge.host.receive(screencastSubscribe(ID, true))
    const emitBinary = bridge.client.streams[0]?.emitBinary
    bridge.host.receive(clientFrame({ type: 'cancel', id: ID, target: 'subscription' }))
    emitBinary?.(frame(1, IMAGE))
    expect(bridge.frames().filter((message) => message.type === 'event')).toEqual([])
  })
})
