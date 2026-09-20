// Plain Delete moves the selected In progress workspace to Done. The part worth an E2E is the
// focus handoff: the shortcut only runs while the sidebar listbox itself holds focus, and the
// only way a user gets there is by clicking a card, whose pointer handlers suppress the browser's
// own focus-nearest-focusable behaviour.

import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { worktreeRow, worktreeRowSurface } from './worktree-row-locators'

async function seedInProgressWorkspace(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const store = window.__store
    if (!store) {
      throw new Error('window.__store is not available')
    }
    const state = store.getState()
    state.setActiveView('terminal')
    state.setSidebarOpen(true)
    state.setGroupBy('workspace-status')
    state.setSortBy('smart')

    const worktree = Object.values(state.worktreesByRepo)
      .flat()
      .find((candidate) => !candidate.isArchived)
    if (!worktree) {
      throw new Error('Delete-to-Done E2E needs at least one worktree')
    }
    await state.updateWorktreeMeta(
      worktree.id,
      { workspaceStatus: 'in-progress' },
      { executionHostId: worktree.hostId ?? 'local' }
    )
    return worktree.id
  })
}

async function getWorkspaceStatus(page: Page, worktreeId: string): Promise<string | null> {
  return page.evaluate((id) => {
    const state = window.__store?.getState()
    if (!state) {
      return null
    }
    const worktree = Object.values(state.worktreesByRepo)
      .flat()
      .find((candidate) => candidate.id === id)
    return worktree?.workspaceStatus ?? null
  }, worktreeId)
}

async function sidebarListHasFocus(page: Page): Promise<boolean> {
  return page.evaluate(() => document.activeElement?.hasAttribute('data-worktree-sidebar') === true)
}

test.describe('Delete marks the selected workspace Done', () => {
  test.beforeEach(async ({ orcaPage }) => {
    await waitForSessionReady(orcaPage)
    await waitForActiveWorktree(orcaPage)
  })

  test('a sidebar click leaves the list focused, and Delete moves In progress to Done', async ({
    orcaPage
  }) => {
    const worktreeId = await seedInProgressWorkspace(orcaPage)
    await expect
      .poll(() => getWorkspaceStatus(orcaPage, worktreeId), {
        timeout: 10_000,
        message: 'Seeding the workspace as In progress did not settle'
      })
      .toBe('in-progress')

    await expect(worktreeRow(orcaPage, worktreeId)).toBeVisible()
    await worktreeRowSurface(orcaPage, worktreeId).click()

    await expect
      .poll(() => sidebarListHasFocus(orcaPage), {
        timeout: 5_000,
        message: 'Clicking a workspace card did not leave the sidebar list focused'
      })
      .toBe(true)

    await expect
      .poll(
        () =>
          orcaPage.evaluate((id) => window.__store?.getState().activeWorktreeId === id, worktreeId),
        { timeout: 5_000, message: 'Clicking the card did not activate that workspace' }
      )
      .toBe(true)

    await orcaPage.keyboard.press('Delete')

    await expect
      .poll(() => getWorkspaceStatus(orcaPage, worktreeId), {
        timeout: 10_000,
        message: 'Delete did not move the selected In progress workspace to Done'
      })
      .toBe('completed')
  })

  test('Delete is inert once the workspace is already Done', async ({ orcaPage }) => {
    const worktreeId = await seedInProgressWorkspace(orcaPage)
    await worktreeRowSurface(orcaPage, worktreeId).click()
    await expect.poll(() => sidebarListHasFocus(orcaPage), { timeout: 5_000 }).toBe(true)

    await orcaPage.keyboard.press('Delete')
    await expect
      .poll(() => getWorkspaceStatus(orcaPage, worktreeId), { timeout: 10_000 })
      .toBe('completed')

    // Why: the second press must not fall through to any other Delete handler
    // and must not push the workspace into some further status.
    await orcaPage.keyboard.press('Delete')
    await orcaPage.waitForTimeout(500)
    expect(await getWorkspaceStatus(orcaPage, worktreeId)).toBe('completed')
    await expect(worktreeRow(orcaPage, worktreeId)).toBeVisible()
  })
})
