import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileBrowserAddressField } from './MobileBrowserAddressField'

// Hoisted with the mock factory, which runs before every module-level const in this file.
const platform = vi.hoisted(() => ({ OS: 'ios' }))

vi.mock('react-native', () => ({
  Platform: platform,
  StyleSheet: {
    absoluteFillObject: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    create: (styles: unknown) => styles
  },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View'
}))

function addressInput(os: string): Record<string, unknown> {
  platform.OS = os
  let renderer: ReactTestRenderer | null = null
  act(() => {
    renderer = create(
      createElement(MobileBrowserAddressField, {
        disabled: false,
        focused: false,
        onBlur: () => {},
        onChangeText: () => {},
        onFocus: () => {},
        onSubmit: () => {},
        value: 'https://dashboard.example'
      })
    )
  })
  if (renderer === null) {
    throw new Error('nothing mounted')
  }
  const mounted: ReactTestRenderer = renderer
  // By prop rather than `findByType('TextInput')`: a host-component string is not an `ElementType`
  // and does not typecheck, and a test outside `tsc` is a pin that proves nothing.
  return mounted.root.findByProps({ placeholder: 'URL' }).props
}

afterEach(() => {
  platform.OS = 'ios'
})

describe('the address field keyboard', () => {
  // `keyboardType` is a native enum a browser does not read, so without this the page's address bar
  // gets the plain keyboard and loses the slash and the .com key it has on a phone.
  it('asks for the URL keyboard through inputMode on the web', () => {
    expect(addressInput('web').inputMode).toBe('url')
  })

  // `inputMode` takes precedence over `keyboardType`, so anything other than undefined here would
  // replace the iOS URL keyboard rather than add to it.
  it('leaves inputMode unset on both native platforms', () => {
    expect(addressInput('ios').inputMode).toBeUndefined()
    expect(addressInput('ios').keyboardType).toBe('url')
    expect(addressInput('android').inputMode).toBeUndefined()
    expect(addressInput('android').keyboardType).toBe('default')
  })
})
