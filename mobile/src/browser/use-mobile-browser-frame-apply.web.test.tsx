// @vitest-environment happy-dom
/**
 * The frame path as the page resolves it: the apply hook against the `.web.ts` paint siblings,
 * with real DOM nodes where the refs are.
 *
 * The flip is what this is for. Natively the offscreen layer becomes visible when the `<Image>`
 * reports its own decode; a `background-image` write reports nothing, so without the decode probe
 * the pending layer stays hidden and the pane freezes on the first frame it ever painted.
 */
import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Image, View } from 'react-native'
import {
  BrowserScreencastOpcode,
  type BrowserScreencastFrame
} from '../transport/browser-screencast-protocol'
import { useMobileBrowserFrameApply } from './use-mobile-browser-frame-apply'
import type { FrameLayer } from './mobile-browser-frame-state'

// Both siblings, so what runs below is the module graph the page bundle resolves.
vi.mock('./browser-frame-layer-paint', async () => await import('./browser-frame-layer-paint.web'))
vi.mock('./browser-frame-data-uri', async () => await import('./browser-frame-data-uri.web'))

/** One frame per index, with base64 that names it, so a layer's background says what landed. */
function frameAt(index: number): BrowserScreencastFrame {
  return {
    opcode: BrowserScreencastOpcode.Frame,
    seq: index,
    format: 'jpeg',
    metadata: { deviceWidth: 390, deviceHeight: 712, pageScaleFactor: 1 },
    image: new Uint8Array([index]),
    b64: `frame-${index}`
  }
}

/**
 * A decode the test finishes, because a real one is neither instant nor synchronous.
 *
 * happy-dom resolves `decode()` in the next microtask for anything, which collapses the state the
 * flip exists to manage: the frame is on the hidden layer and not yet showing. Holding the promise
 * makes "offscreen" and "flipped" two observable moments rather than one.
 */
const decodes: { pending: (() => void)[] } = { pending: [] }
let realImage: typeof window.Image

beforeEach(() => {
  decodes.pending = []
  realImage = window.Image
  window.Image = class extends realImage {
    override decode(): Promise<void> {
      return new Promise((resolve) => decodes.pending.push(() => resolve()))
    }
  }
})

afterEach(() => {
  window.Image = realImage
})

async function finishDecodes(): Promise<void> {
  const settling = decodes.pending
  decodes.pending = []
  await act(async () => {
    for (const settle of settling) {
      settle()
    }
    await Promise.resolve()
  })
}

function mountImageHost(): HTMLElement {
  const host = document.createElement('div')
  host.append(document.createElement('div'))
  document.body.append(host)
  return host
}

function backgroundOf(host: HTMLElement): string {
  const surface = host.firstElementChild
  return surface instanceof HTMLElement ? surface.style.backgroundImage : ''
}

function mountApplyHook() {
  const imageHosts: [HTMLElement, HTMLElement] = [mountImageHost(), mountImageHost()]
  const layers: [HTMLElement, HTMLElement] = [
    document.createElement('div'),
    document.createElement('div')
  ]
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: on RN Web a ref is the DOM node, which is the whole reason these siblings exist; the hook's signature is still the native one.
  const asImages = imageHosts as unknown as [Image | null, Image | null]
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: same mismatch, for the layer refs the visibility writer takes.
  const asViews = layers as unknown as [View | null, View | null]
  const frameUriRef: { current: string | null } = { current: null }
  const pendingFrameLayerRef: { current: FrameLayer | null } = { current: null }
  const visibleFrameLayerRef: { current: FrameLayer } = { current: 0 }
  const refs = {
    browserImageRefs: { current: asImages },
    browserLayerRefs: { current: asViews },
    busyRef: { current: true },
    frameMetadataRef: { current: null },
    frameMountedRef: { current: false },
    frameThrottleTimerRef: { current: null },
    frameUriRef,
    lastAppliedFrameAtRef: { current: 0 },
    pendingFrameLayerRef,
    pendingThrottledFrameRef: { current: null },
    setBusy: () => {},
    setFrameMetadata: () => {},
    setFrameUri: () => {},
    visibleFrameLayerRef
  }
  const held: { apply: ((frame: BrowserScreencastFrame, key: string) => void) | null } = {
    apply: null
  }
  function Screen(): null {
    held.apply = useMobileBrowserFrameApply(refs).applyFrameThrottled
    return null
  }
  act(() => {
    create(createElement(Screen))
  })
  const apply = held.apply
  if (apply === null) {
    throw new Error('nothing mounted')
  }
  return { apply, imageHosts, layers, refs }
}

async function applyFrame(
  harness: ReturnType<typeof mountApplyHook>,
  frame: BrowserScreencastFrame
): Promise<void> {
  // Zeroed rather than waited out: the 100 ms pacer is not what this file is measuring.
  harness.refs.lastAppliedFrameAtRef.current = 0
  await act(async () => {
    harness.apply(frame, 'wt:page:mobile')
    await Promise.resolve()
  })
}

describe('the page frame path', () => {
  it('paints the first frame on the visible layer without a flip', async () => {
    const harness = mountApplyHook()

    await applyFrame(harness, frameAt(1))

    expect(backgroundOf(harness.imageHosts[0])).toContain('frame-1')
    expect(harness.refs.visibleFrameLayerRef.current).toBe(0)
    expect(harness.refs.pendingFrameLayerRef.current).toBeNull()
  })

  it('paints the next frame offscreen and flips only once it has decoded', async () => {
    const harness = mountApplyHook()
    await applyFrame(harness, frameAt(1))

    await applyFrame(harness, frameAt(2))

    // Painted on the hidden layer, and the visible one is still the frame before it.
    expect(backgroundOf(harness.imageHosts[1])).toContain('frame-2')
    expect(harness.refs.pendingFrameLayerRef.current).toBe(1)
    expect(harness.refs.visibleFrameLayerRef.current).toBe(0)

    await finishDecodes()

    expect(harness.refs.visibleFrameLayerRef.current).toBe(1)
    expect(harness.refs.pendingFrameLayerRef.current).toBeNull()
    expect([harness.layers[0].style.opacity, harness.layers[1].style.opacity]).toEqual(['0', '1'])
  })

  it('keeps streaming past the second frame, which a missing flip would stop dead', async () => {
    const harness = mountApplyHook()
    await applyFrame(harness, frameAt(1))
    await applyFrame(harness, frameAt(2))
    await finishDecodes()

    await applyFrame(harness, frameAt(3))
    await finishDecodes()

    expect(harness.refs.visibleFrameLayerRef.current).toBe(0)
    expect(backgroundOf(harness.imageHosts[0])).toContain('frame-3')
    expect([harness.layers[0].style.opacity, harness.layers[1].style.opacity]).toEqual(['1', '0'])
  })

  it('repoints the pending layer at the newest frame while the previous one decodes', async () => {
    const harness = mountApplyHook()
    await applyFrame(harness, frameAt(1))
    await applyFrame(harness, frameAt(2))

    await applyFrame(harness, frameAt(3))

    // Still one pending layer, now carrying the newest frame rather than the one it was given.
    expect(harness.refs.pendingFrameLayerRef.current).toBe(1)
    expect(backgroundOf(harness.imageHosts[1])).toContain('frame-3')

    await finishDecodes()

    // Frame 2's decode resolved too and must not have flipped on its own: the pane would have
    // shown the layer before frame 3 had painted. One flip, on the frame the layer is holding.
    expect(harness.refs.visibleFrameLayerRef.current).toBe(1)
    expect(harness.refs.pendingFrameLayerRef.current).toBeNull()
  })
})
