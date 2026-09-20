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
const ADDRESS_STYLES_NATIVE = 'src/browser/browser-address-field-styles.ts'

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
   * The one the census cannot see, and why it is not a regression.
   *
   * `resolveLocal` in the seam module tries `.ts`, `.tsx`, `/index.ts` and `/index.tsx` and never
   * `.web.ts`, so an import it follows lands on the native sibling even when the bundle resolved
   * the web one. The address field is split that way on purpose: native keeps the 12px it has
   * always rendered, and the browser gets the seam. The census reads the 12 and calls it an
   * offender.
   *
   * Pinned rather than left to surprise whoever lists the pane's route. Two ways out then: teach
   * `resolveLocal` the `.web` extensions the builder already prefers, which would make the census
   * measure what the page runs for every split; or move the address field onto the seam natively
   * and accept 14px in the toolbar.
   */
  it('reports the address field, because it cannot follow a .web sibling', () => {
    expect(offendingFiles()).toEqual([ADDRESS_STYLES_NATIVE])
  })
})
