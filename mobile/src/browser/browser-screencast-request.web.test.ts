import { describe, expect, it } from 'vitest'
import { BRIDGE_MAX_MESSAGE_BYTES } from '../mobile-web-shell/bridge/bridge-caps'
import { buildMobileBrowserScreencastRequest } from './browser-screencast-request'
import {
  BASE64_BYTES_PER_CHARACTER,
  binaryEventEnvelopeBytes,
  budgetedMobileViewDeviceScaleFactor,
  buildMobileBrowserScreencastRequest as buildOnWeb,
  mobileBrowserFrameAreaBudget,
  WORST_CASE_JPEG_BYTES_PER_PIXEL
} from './browser-screencast-request.web'

/** A phone's measured browser area, in CSS pixels. */
const PHONE = { width: 390, height: 712 }

/** What the shell would have to post for a frame of this area at the worst case JPEG has. */
function frameMessageBytes(areaPixels: number): number {
  const imageBytes = areaPixels * WORST_CASE_JPEG_BYTES_PER_PIXEL
  return Math.ceil(imageBytes / BASE64_BYTES_PER_CHARACTER) + binaryEventEnvelopeBytes()
}

function mobileFrameArea(
  layout: { width: number; height: number },
  request: { deviceScaleFactor?: number } | null
): number {
  const scale = request?.deviceScaleFactor
  if (scale === undefined) {
    throw new Error('the request carried no device scale factor')
  }
  return Math.round(layout.width) * Math.round(layout.height) * scale * scale
}

describe('the mobile-view area budget', () => {
  // The control, and the reason the budget exists: what the native request asks for on this same
  // phone does not fit in one bridge message, and the shell would answer it with a dropped frame.
  it('is needed: the native request overflows the frame cap on a phone', () => {
    const native = buildMobileBrowserScreencastRequest(PHONE, 2, 'mobile')

    expect(native?.deviceScaleFactor).toBe(2)
    expect(frameMessageBytes(mobileFrameArea(PHONE, native))).toBeGreaterThan(
      BRIDGE_MAX_MESSAGE_BYTES
    )
  })

  it('keeps the worst case frame inside one bridge message', () => {
    const budgeted = buildOnWeb(PHONE, 2, 'mobile')

    expect(frameMessageBytes(mobileFrameArea(PHONE, budgeted))).toBeLessThanOrEqual(
      BRIDGE_MAX_MESSAGE_BYTES
    )
  })

  // Derived from the same constants the module derives from, not written down: a budget the test
  // restates is a budget that agrees with itself and with nothing else.
  it('asks for the scale the cap and the worst case together allow', () => {
    const expected = Math.sqrt(mobileBrowserFrameAreaBudget() / (PHONE.width * PHONE.height))

    const scale = budgetedMobileViewDeviceScaleFactor(PHONE)

    expect(scale).toBeLessThanOrEqual(expected)
    // Floored to two decimals, so it is the largest such scale rather than merely a safe one.
    expect(scale).toBeGreaterThan(expected - 0.01)
  })

  it('leaves web mode byte-identical to the native request', () => {
    expect(buildOnWeb(PHONE, 2, 'web')).toEqual(
      buildMobileBrowserScreencastRequest(PHONE, 2, 'web')
    )
    expect(buildOnWeb(PHONE, 2)).toEqual(buildMobileBrowserScreencastRequest(PHONE, 2))
  })

  it('never asks for more density than native, on a viewport the budget does not bind', () => {
    expect(budgetedMobileViewDeviceScaleFactor({ width: 200, height: 200 })).toBe(2)
  })

  it('stops at one device pixel per CSS pixel on a viewport no scale would fit', () => {
    // Past this the page would be asking for a blurrier frame than its own layout; a frame that
    // still does not fit is C6 ruling 1's to drop.
    expect(budgetedMobileViewDeviceScaleFactor({ width: 2000, height: 1400 })).toBe(1)
  })

  it('answers the native factor when there is no layout to budget against', () => {
    expect(budgetedMobileViewDeviceScaleFactor(null)).toBe(2)
    expect(buildOnWeb(null, 2, 'mobile')).toBeNull()
    expect(buildOnWeb({ width: 0, height: 712 }, 2, 'mobile')).toBeNull()
  })
})

describe('the budget derivation', () => {
  it('spends the whole cap that the envelope leaves', () => {
    const envelope = binaryEventEnvelopeBytes()
    const expectedArea = Math.floor(
      Math.floor((BRIDGE_MAX_MESSAGE_BYTES - envelope) * BASE64_BYTES_PER_CHARACTER) /
        WORST_CASE_JPEG_BYTES_PER_PIXEL
    )

    expect(mobileBrowserFrameAreaBudget()).toBe(expectedArea)
  })

  it('measures the envelope rather than naming a number, and leaves it room to grow', () => {
    const envelope = binaryEventEnvelopeBytes()

    // Big enough to be the real shape, small enough that the budget is not swallowed by it.
    expect(envelope).toBeGreaterThan(200)
    expect(envelope).toBeLessThan(BRIDGE_MAX_MESSAGE_BYTES / 100)
  })
})
