/**
 * The browser pane's two text inputs, read the way C4.2's census reads them.
 *
 * The pane is not in any page route today, so no route closure reaches it and the census that
 * enforces the seam is not run against it: it walks the source-control hub and the review route,
 * and the pane is in neither. C6 raises both inputs anyway, because the failure is not cosmetic —
 * an input under 16px makes an iOS browser zoom the page on focus, and `keyboard-occlusion.web.ts`
 * reads a visual viewport scale other than 1 as "no keyboard" for the rest of the typing session.
 *
 * This file is the census run by hand over the pane's own modules, so the raise is checked by the
 * rule that will judge it once a route lists the pane.
 */
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  textInputFontSizeOffenders,
  unresolvedTextInputStyles
} from './mobile-web-app-text-input-font-size-seam.mjs'

const mobileDir = join(fileURLToPath(new URL('../..', import.meta.url)), 'mobile')

/**
 * The pane's text-input modules, named as the bundler resolves them: a `.web.ts` where one exists,
 * which is what `mobileWebAppRouteClosure` reports for a real route.
 */
const PANE_CLOSURE = {
  local: [
    'src/browser/MobileBrowserPaneView.tsx',
    'src/browser/MobileBrowserAddressField.tsx',
    'src/browser/mobile-browser-pane-styles.ts',
    'src/browser/browser-address-field-styles.web.ts',
    'src/platform/text-input-font-size.web.ts'
  ]
}

const KEY_ROW_STYLES = 'src/browser/mobile-browser-pane-styles.ts'

function offendingFiles() {
  return textInputFontSizeOffenders(mobileDir, PANE_CLOSURE).map((entry) =>
    entry.slice(0, entry.lastIndexOf(':'))
  )
}

describe('the browser pane text inputs under the C4.2 census', () => {
  it('reads every input the pane declares, so the verdicts below are complete', () => {
    // The completeness half: an empty offender list means nothing if the walk found no input.
    expect(unresolvedTextInputStyles(mobileDir, PANE_CLOSURE)).toEqual([])
    expect(PANE_CLOSURE.local).toContain('src/platform/text-input-font-size.web.ts')
  })

  it('takes the key row input through the seam', () => {
    expect(offendingFiles()).not.toContain(KEY_ROW_STYLES)
  })

  /**
   * The address field is split, and the split is what the census now reads.
   *
   * Native keeps the 12px the toolbar has always rendered, because no phone has a page to zoom;
   * the browser gets the seam. `resolveLocal` follows the `.web.ts` the builder would have
   * resolved, so the size judged here is the size the page runs rather than the one it does not.
   */
  it('takes the address field through the seam, through its .web sibling', () => {
    expect(offendingFiles()).toEqual([])
  })
})
