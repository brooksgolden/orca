const SIDEBAR_LIST_SELECTOR = '[role="listbox"][data-worktree-sidebar]'

let claimed = false

/**
 * Records that the user's own gesture, a click on a workspace card, put
 * keyboard focus on the sidebar workspace list.
 *
 * Why this exists: a terminal pane focuses itself when it is created or
 * activated, and a workspace that has never been opened this session mounts its
 * first pane *after* the click that selected it. Without a claim, that late
 * focus yanks the caret out of the list the user just clicked, so list-scoped
 * shortcuts (Delete to move a workspace to Done) silently do nothing on a cold
 * workspace while working fine on a warm one. The claim makes the two match.
 *
 * It is deliberately not a timer: a cold PTY can take seconds to spawn, and the
 * claim has to outlive that without ever outliving the user's focus.
 */
export function claimSidebarListFocus(): void {
  claimed = true
}

export function releaseSidebarListFocus(): void {
  claimed = false
}

/**
 * True only while a claim is live *and* the list still holds focus. Any focus
 * move off the list (clicking into a terminal, opening a dialog, Enter to dive
 * into the pane) retires the claim on the next read, so nothing has to remember
 * to release it.
 */
export function sidebarListFocusIsClaimed(): boolean {
  if (!claimed) {
    return false
  }
  const active = typeof document === 'undefined' ? null : document.activeElement
  if (active instanceof HTMLElement && active.matches(SIDEBAR_LIST_SELECTOR)) {
    return true
  }
  claimed = false
  return false
}
