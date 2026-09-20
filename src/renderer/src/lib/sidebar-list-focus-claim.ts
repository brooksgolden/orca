const SIDEBAR_LIST_SELECTOR = '[role="listbox"][data-worktree-sidebar]'

let claimedList: HTMLElement | null = null

// Cold panes can mount seconds after a card click; preserve list focus until it actually leaves.
export function claimSidebarListFocus(): void {
  releaseSidebarListFocus()
  const active = typeof document === 'undefined' ? null : document.activeElement
  if (active instanceof HTMLElement && active.matches(SIDEBAR_LIST_SELECTOR)) {
    claimedList = active
    active.addEventListener('focusout', releaseSidebarListFocus, { once: true })
  }
}

export function releaseSidebarListFocus(): void {
  claimedList?.removeEventListener('focusout', releaseSidebarListFocus)
  claimedList = null
}

// Also clear disconnected lists, which may not receive focusout when removed.
export function sidebarListFocusIsClaimed(): boolean {
  if (!claimedList) {
    return false
  }
  const active = typeof document === 'undefined' ? null : document.activeElement
  if (active === claimedList) {
    return true
  }
  releaseSidebarListFocus()
  return false
}
