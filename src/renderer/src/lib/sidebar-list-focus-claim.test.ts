// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  claimSidebarListFocus,
  releaseSidebarListFocus,
  sidebarListFocusIsClaimed
} from './sidebar-list-focus-claim'

function mountSidebarList(): HTMLElement {
  const list = document.createElement('div')
  list.setAttribute('role', 'listbox')
  list.setAttribute('data-worktree-sidebar', 'true')
  list.tabIndex = 0
  document.body.append(list)
  return list
}

beforeEach(() => {
  releaseSidebarListFocus()
  document.body.innerHTML = ''
})

afterEach(() => {
  releaseSidebarListFocus()
  document.body.innerHTML = ''
})

describe('sidebar list focus claim', () => {
  it('is not claimed until a sidebar gesture claims it', () => {
    mountSidebarList().focus()
    expect(sidebarListFocusIsClaimed()).toBe(false)
  })

  it('holds while the list still owns focus', () => {
    mountSidebarList().focus()
    claimSidebarListFocus()
    expect(sidebarListFocusIsClaimed()).toBe(true)
    // Why re-read: a cold PTY can take seconds, so the claim must not be a timer.
    expect(sidebarListFocusIsClaimed()).toBe(true)
  })

  it('retires itself once focus moves off the list and does not come back', () => {
    const list = mountSidebarList()
    const other = document.createElement('textarea')
    document.body.append(other)
    list.focus()
    claimSidebarListFocus()
    expect(sidebarListFocusIsClaimed()).toBe(true)

    other.focus()
    expect(sidebarListFocusIsClaimed()).toBe(false)

    list.focus()
    expect(sidebarListFocusIsClaimed()).toBe(false)
  })

  it('does not claim focus that landed on other sidebar chrome', () => {
    const unrelated = document.createElement('div')
    unrelated.setAttribute('role', 'listbox')
    unrelated.tabIndex = 0
    document.body.append(unrelated)
    unrelated.focus()
    claimSidebarListFocus()
    expect(sidebarListFocusIsClaimed()).toBe(false)
  })
})
