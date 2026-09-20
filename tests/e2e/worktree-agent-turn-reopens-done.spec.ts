// A fresh agent turn in a workspace marked Done puts it back to In progress. The unit test covers
// the reducer; this covers the wiring through the real store and the real metadata write, which is
// where a wrong workspace id or execution host would show up.

import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

type Scenario = { worktreeId: string; paneKey: string }

async function seedDoneWorkspaceWithTab(page: Page): Promise<Scenario> {
  return page.evaluate(async () => {
    const store = window.__store
    if (!store) {
      throw new Error('window.__store is not available')
    }
    const state = store.getState()
    const worktree = Object.values(state.worktreesByRepo)
      .flat()
      .find((candidate) => !candidate.isArchived)
    if (!worktree) {
      throw new Error('Reopen E2E needs at least one worktree')
    }
    await state.updateWorktreeMeta(
      worktree.id,
      { workspaceStatus: 'completed', lastActivityAt: 1 },
      { executionHostId: worktree.hostId ?? 'local' }
    )
    const current = store.getState()
    const tab =
      current.tabsByWorktree[worktree.id]?.[0] ??
      current.createTab(worktree.id, undefined, undefined, { activate: false })
    if (!tab) {
      throw new Error('Reopen E2E could not get a terminal tab')
    }
    return { worktreeId: worktree.id, paneKey: `${tab.id}:0` }
  })
}

async function readWorkspace(
  page: Page,
  worktreeId: string
): Promise<{ status: string | null; lastActivityAt: number | null }> {
  return page.evaluate((id) => {
    const worktree = Object.values(window.__store?.getState().worktreesByRepo ?? {})
      .flat()
      .find((candidate) => candidate.id === id)
    return {
      status: worktree?.workspaceStatus ?? null,
      lastActivityAt: worktree?.lastActivityAt ?? null
    }
  }, worktreeId)
}

async function seedDoneAndSettle(page: Page): Promise<Scenario> {
  const scenario = await seedDoneWorkspaceWithTab(page)
  await expect
    .poll(async () => (await readWorkspace(page, scenario.worktreeId)).status, {
      timeout: 10_000,
      message: 'Seeding the workspace as Done did not settle'
    })
    .toBe('completed')
  return scenario
}

test.describe('an agent turn reopens a Done workspace', () => {
  test.beforeEach(async ({ orcaPage }) => {
    await waitForSessionReady(orcaPage)
    await waitForActiveWorktree(orcaPage)
  })

  test('moves Done to In progress and refreshes recency on a fresh turn', async ({ orcaPage }) => {
    const scenario = await seedDoneAndSettle(orcaPage)

    await orcaPage.evaluate((scenario) => {
      window.__store?.getState().setAgentStatus(scenario.paneKey, {
        state: 'working',
        prompt: 'New task',
        agentType: 'claude'
      })
    }, scenario)

    await expect
      .poll(async () => (await readWorkspace(orcaPage, scenario.worktreeId)).status, {
        timeout: 10_000,
        message: 'A fresh agent turn did not move the Done workspace back to In progress'
      })
      .toBe('in-progress')

    const reopened = await readWorkspace(orcaPage, scenario.worktreeId)
    expect(reopened.lastActivityAt ?? 0).toBeGreaterThan(1)
  })

  test('leaves a workspace Done when the working snapshot is a stale restore', async ({
    orcaPage
  }) => {
    const scenario = await seedDoneAndSettle(orcaPage)

    // Why this case: hydration replays old working states. Reopening on those would flip every
    // finished workspace back to In progress on every launch.
    await orcaPage.evaluate((scenario) => {
      window.__store
        ?.getState()
        .setAgentStatus(
          scenario.paneKey,
          { state: 'working', prompt: 'Old task', agentType: 'claude', restoredUnconfirmed: true },
          undefined,
          { updatedAt: Date.now() - 120_000 }
        )
    }, scenario)

    await orcaPage.waitForTimeout(1_000)
    expect((await readWorkspace(orcaPage, scenario.worktreeId)).status).toBe('completed')
  })
})
