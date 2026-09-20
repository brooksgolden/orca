import { BRIDGE_MAX_MESSAGE_BYTES } from '../mobile-web-shell/bridge/bridge-caps'
import { BRIDGE_PROTOCOL_VERSION } from '../mobile-web-shell/bridge/bridge-envelope'
import {
  assembleMobileBrowserScreencastRequest,
  MOBILE_VIEW_DEVICE_SCALE_FACTOR,
  type BrowserStreamLayout,
  type MobileBrowserScreencastRequest,
  type MobileBrowserViewMode
} from './browser-screencast-request-parameters'

export { MOBILE_BROWSER_FRAME_MIN_INTERVAL_MS } from './browser-screencast-request-parameters'
export type {
  BrowserStreamLayout,
  MobileBrowserScreencastRequest,
  MobileBrowserViewMode
} from './browser-screencast-request-parameters'

/**
 * The bytes one pixel of this pane's JPEG costs at its worst.
 *
 * Measured on this lane's fixtures at quality 72: uniform random noise, which is the image JPEG
 * compresses least and the ceiling every real page sits under, encoded at 0.545 bytes per pixel.
 * Photographic content measured near a tenth of that. The number is the worst case rather than a
 * typical one because it is the one a budget has to survive.
 */
export const WORST_CASE_JPEG_BYTES_PER_PIXEL = 0.545

/** Base64 carries three bytes in four characters, and a character is one UTF-8 byte here. */
export const BASE64_BYTES_PER_CHARACTER = 3 / 4

/**
 * What the frame's envelope costs, derived rather than typed, so the budget cannot drift from the
 * shape the shell actually sends.
 *
 * Everything but the image at its widest: a full-length correlation id, both sequence counters at
 * the largest integer they can hold, and every metadata field present carrying a wide fraction.
 * A real frame's envelope is smaller, which leaves the budget conservative in the safe direction.
 */
export function binaryEventEnvelopeBytes(): number {
  const widestNumber = -1_234_567.890_123_4
  return JSON.stringify({
    v: BRIDGE_PROTOCOL_VERSION,
    type: 'event',
    id: 'a'.repeat(22),
    seq: Number.MAX_SAFE_INTEGER,
    binary: {
      b64: '',
      format: 'jpeg',
      frameSeq: Number.MAX_SAFE_INTEGER,
      metadata: {
        offsetTop: widestNumber,
        pageScaleFactor: widestNumber,
        deviceWidth: widestNumber,
        deviceHeight: widestNumber,
        imageWidth: widestNumber,
        imageHeight: widestNumber,
        scrollOffsetX: widestNumber,
        scrollOffsetY: widestNumber,
        timestamp: widestNumber
      }
    }
  }).length
}

/**
 * The frame area one bridge message can carry, in device pixels.
 *
 * The cap, less what the envelope costs, is the base64 the image may occupy; three quarters of that
 * is the JPEG; divided by the worst case a pixel costs, it is an area. Computed from the cap rather
 * than written down beside it, because a cap that moves and a budget that does not is a pane that
 * goes dark on a page it could have streamed.
 */
export function mobileBrowserFrameAreaBudget(): number {
  const base64Characters = BRIDGE_MAX_MESSAGE_BYTES - binaryEventEnvelopeBytes()
  const imageBytes = Math.floor(base64Characters * BASE64_BYTES_PER_CHARACTER)
  return Math.floor(imageBytes / WORST_CASE_JPEG_BYTES_PER_PIXEL)
}

/**
 * The device scale factor the mobile view may ask for and stay inside one message.
 *
 * Mobile view is the one mode where the page knows the frame exactly: it names the viewport, so the
 * frame is that viewport times this factor squared. Web mode is a desktop viewport letterboxed into
 * `maxWidth`/`maxHeight`, which the page cannot predict, so it is left alone and C6 ruling 1's
 * drop-the-over-cap-frame rule is its only protection.
 *
 * Floored to two decimals so rounding cannot push the area back over the budget, and never above
 * what native asks for: this bounds density, it does not raise it. Never below 1 either — past that
 * the page would be asking for fewer device pixels than it has CSS pixels, which is a blurry frame
 * rather than a working one, and a frame that still does not fit is ruling 1's to drop.
 */
export function budgetedMobileViewDeviceScaleFactor(layout: BrowserStreamLayout | null): number {
  if (!layout || layout.width <= 0 || layout.height <= 0) {
    return MOBILE_VIEW_DEVICE_SCALE_FACTOR
  }
  const viewportArea = Math.round(layout.width) * Math.round(layout.height)
  const budgeted = Math.sqrt(mobileBrowserFrameAreaBudget() / viewportArea)
  return Math.max(1, Math.min(MOBILE_VIEW_DEVICE_SCALE_FACTOR, Math.floor(budgeted * 100) / 100))
}

/** Web sibling: the same request, with the mobile view's density held inside the frame cap. */
export function buildMobileBrowserScreencastRequest(
  layout: BrowserStreamLayout | null,
  pixelRatio: number,
  viewMode: MobileBrowserViewMode = 'web'
): MobileBrowserScreencastRequest | null {
  return assembleMobileBrowserScreencastRequest(
    layout,
    pixelRatio,
    viewMode,
    budgetedMobileViewDeviceScaleFactor(layout)
  )
}
