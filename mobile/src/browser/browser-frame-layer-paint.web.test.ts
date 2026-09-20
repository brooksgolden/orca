// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import type { Image, View } from 'react-native'
import {
  updateBrowserImageSource,
  updateBrowserLayerVisibility,
  whenBrowserFrameDisplayable
} from './browser-frame-layer-paint'
import {
  updateBrowserImageSource as updateBrowserImageSourceOnWeb,
  updateBrowserLayerVisibility as updateBrowserLayerVisibilityOnWeb,
  whenBrowserFrameDisplayable as whenBrowserFrameDisplayableOnWeb
} from './browser-frame-layer-paint.web'

/** A 1x1 gif, so the probe in the web sibling has something a real decoder would accept. */
const FRAME_URI = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

/**
 * What RN Web renders an `<Image>` as: the ref is the outer element and the frame is painted as a
 * `background-image` on its first child, which is where `resizeMode` already put `background-size`.
 */
function mountImageHost(): HTMLElement {
  const host = document.createElement('div')
  host.append(document.createElement('div'))
  document.body.append(host)
  return host
}

function mountLayer(): HTMLElement {
  const layer = document.createElement('div')
  document.body.append(layer)
  return layer
}

// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the point of the test is that a DOM node is what the native signature receives on RN Web, which is exactly the mismatch these siblings exist for.
const asImageRef = (node: HTMLElement) => node as unknown as Image
// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: same mismatch, for the layer refs the visibility writer takes.
const asViewRef = (node: HTMLElement) => node as unknown as View

describe('the native frame-path writes against an RN Web ref', () => {
  it('throws from updateBrowserImageSource, because a DOM node has no setNativeProps', () => {
    expect(() => updateBrowserImageSource(asImageRef(mountImageHost()), FRAME_URI)).toThrow(
      /setNativeProps is not a function/
    )
  })

  it('throws from updateBrowserLayerVisibility for the same reason', () => {
    expect(() =>
      updateBrowserLayerVisibility([asViewRef(mountLayer()), asViewRef(mountLayer())], 0)
    ).toThrow(/setNativeProps is not a function/)
  })

  it('reports no decode of its own: the rendered Image fires onLoad natively', () => {
    const onDisplayable = vi.fn()
    whenBrowserFrameDisplayable(FRAME_URI, { onDisplayable, onUndecodable: vi.fn() })
    expect(onDisplayable).not.toHaveBeenCalled()
  })
})

describe('the web siblings', () => {
  it('paints the frame as a background-image on the element RN Web sizes', () => {
    const host = mountImageHost()

    updateBrowserImageSourceOnWeb(asImageRef(host), FRAME_URI)

    const surface = host.firstElementChild
    expect(surface).toBeInstanceOf(HTMLElement)
    expect(surface instanceof HTMLElement ? surface.style.backgroundImage : null).toBe(
      `url("${FRAME_URI}")`
    )
    // The host itself is untouched: RN Web's own layout styles live there.
    expect(host.style.backgroundImage).toBe('')
  })

  it('flips the double buffer with one opacity write per layer', () => {
    const layers: [HTMLElement, HTMLElement] = [mountLayer(), mountLayer()]

    updateBrowserLayerVisibilityOnWeb([asViewRef(layers[0]), asViewRef(layers[1])], 1)

    expect([layers[0].style.opacity, layers[1].style.opacity]).toEqual(['0', '1'])
  })

  it('tolerates a layer that has unmounted between the frame and the write', () => {
    expect(() => updateBrowserLayerVisibilityOnWeb([null, null], 0)).not.toThrow()
    expect(() => updateBrowserImageSourceOnWeb(null, FRAME_URI)).not.toThrow()
  })

  it('reports a frame displayable only once it has decoded', async () => {
    const onDisplayable = vi.fn()

    whenBrowserFrameDisplayableOnWeb(FRAME_URI, { onDisplayable, onUndecodable: vi.fn() })

    expect(onDisplayable).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(onDisplayable).toHaveBeenCalledTimes(1))
  })

  // happy-dom resolves `decode()` for anything, because it has no decoder; a browser rejects on a
  // corrupt frame. Stubbed rather than skipped: the rejection is the only thing that frees the
  // pending layer, and an untested one strands the pane on the frame before it for good.
  it('reports a frame that cannot decode, so the pending layer is not stranded', async () => {
    const onUndecodable = vi.fn()
    const realImage = window.Image
    class UndecodableImage extends realImage {
      override decode(): Promise<void> {
        return Promise.reject(new Error('the source image cannot be decoded'))
      }
    }
    window.Image = UndecodableImage

    try {
      whenBrowserFrameDisplayableOnWeb('data:image/jpeg;base64,notreallyjpeg', {
        onDisplayable: vi.fn(),
        onUndecodable
      })
      await vi.waitFor(() => expect(onUndecodable).toHaveBeenCalledTimes(1))
    } finally {
      window.Image = realImage
    }
  })
})
