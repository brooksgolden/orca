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
import { BRIDGE_MAX_MESSAGE_BYTES } from './bridge/bridge-caps'
import { BRIDGE_MAX_UNACKED_FRAMES } from './bridge-host-subscriptions'
import { clientFrame } from './bridge-host-test-fakes'
import { harness, ID, OTHER } from './bridge-host-test-harness'

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

/**
 * The drop rule, and the JSON rule it is scoped away from, in one place.
 *
 * C0.3 ended a stream whose event would not fit, because a hole in a JSON stream is invisible to
 * its reader and a transcript with a gap is worse than one that stopped. A screencast hole is
 * neither: the next frame is one throttle interval away and the pane keeps the last one on screen.
 * So the two verdicts differ by the kind of event, and both are asserted here so neither can be
 * changed into the other by accident.
 */
describe('an over-cap frame drops on the binary lane and ends the stream on the JSON one', () => {
  /** Encoded, this exceeds `BRIDGE_MAX_MESSAGE_BYTES`: 500,000 bytes is 666,668 base64 chars. */
  const OVERSIZED = new Uint8Array(500_000)
  /** The image plus the event frame around it, which is what the cap is applied to — the number
   *  the diagnostic reports is the frame, never the image. */
  const OVERSIZED_FRAME_BYTES = 666_668 + 194

  function openBinary(): ReturnType<typeof harness> {
    const bridge = harness({ ready: true })
    bridge.host.receive(screencastSubscribe(ID, true))
    return bridge
  }

  it('drops a binary frame over the frame cap and keeps the stream open', () => {
    const bridge = openBinary()
    bridge.client.streams[0]?.emitBinary?.(frame(1, OVERSIZED))
    expect(bridge.frames().filter((message) => message.type === 'end')).toEqual([])
    bridge.client.streams[0]?.emitBinary?.(frame(2, IMAGE))
    const events = bridge.frames().filter((message) => message.type === 'event')
    expect(events).toHaveLength(1)
    expect(bridge.client.streams[0]?.unsubscribes).toBe(0)
  })

  it('ends a JSON event over the same cap with overflow, as it always has', () => {
    const bridge = openBinary()
    bridge.client.streams[0]?.emit('z'.repeat(BRIDGE_MAX_MESSAGE_BYTES))
    expect(bridge.last()).toEqual({ v: 1, type: 'end', id: ID, reason: 'overflow' })
    expect(bridge.client.streams[0]?.unsubscribes).toBe(1)
  })

  /** The page acks by this number, so a dropped frame must not consume one: a gap would have it
   *  acking a frame the shell never posted. */
  it('does not spend a seq on a frame it dropped', () => {
    const bridge = openBinary()
    bridge.client.streams[0]?.emitBinary?.(frame(1, IMAGE))
    bridge.client.streams[0]?.emitBinary?.(frame(2, OVERSIZED))
    bridge.client.streams[0]?.emitBinary?.(frame(3, IMAGE))
    expect(
      bridge
        .frames()
        .filter((message) => message.type === 'event')
        .map((message) => message.seq)
    ).toEqual([1, 2])
  })

  it('drops rather than ends when the unacked frame window is full', () => {
    const bridge = openBinary()
    for (let index = 0; index < BRIDGE_MAX_UNACKED_FRAMES + 4; index += 1) {
      bridge.client.streams[0]?.emitBinary?.(frame(index, IMAGE))
    }
    expect(bridge.frames().filter((message) => message.type === 'event')).toHaveLength(
      BRIDGE_MAX_UNACKED_FRAMES
    )
    expect(bridge.frames().filter((message) => message.type === 'end')).toEqual([])
    // And the window reopens, which is what says the stream was left usable rather than merely open.
    bridge.host.receive(clientFrame({ type: 'ack', id: ID, seq: BRIDGE_MAX_UNACKED_FRAMES }))
    bridge.client.streams[0]?.emitBinary?.(frame(999, IMAGE))
    expect(bridge.frames().filter((message) => message.type === 'event')).toHaveLength(
      BRIDGE_MAX_UNACKED_FRAMES + 1
    )
  })

  it('counts every dropped frame and reports the running total', () => {
    const bridge = openBinary()
    bridge.client.streams[0]?.emitBinary?.(frame(1, OVERSIZED))
    bridge.client.streams[0]?.emitBinary?.(frame(2, OVERSIZED))
    expect(bridge.droppedBinaryFrames).toEqual([1, 2])
  })

  /** Per subscription for the diagnostic, total for the surface: a second stream must not restart
   *  the number the dev facts show. */
  it('keeps counting across a second subscription on the same host', () => {
    const bridge = openBinary()
    bridge.client.streams[0]?.emitBinary?.(frame(1, OVERSIZED))
    bridge.host.receive(clientFrame({ type: 'cancel', id: ID, target: 'subscription' }))
    bridge.host.receive(screencastSubscribe(OTHER, true))
    bridge.client.streams[1]?.emitBinary?.(frame(1, OVERSIZED))
    expect(bridge.droppedBinaryFrames).toEqual([1, 2])
    expect(bridge.diagnostics.filter((entry) => entry.kind === 'binary-frame-dropped')).toEqual([
      { kind: 'binary-frame-dropped', id: ID, bytes: OVERSIZED_FRAME_BYTES, dropped: 1 },
      { kind: 'binary-frame-dropped', id: OTHER, bytes: OVERSIZED_FRAME_BYTES, dropped: 1 }
    ])
  })
})
