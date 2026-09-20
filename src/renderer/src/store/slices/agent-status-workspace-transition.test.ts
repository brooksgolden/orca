import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTestStore, makeTab, makeWorktree, seedStore } from './store-test-helpers'

afterEach(() => vi.useRealTimers())

describe('agent turn workspace activity', () => {
  it('reopens a Done workspace and refreshes recency when a new turn starts', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-20T12:00:00Z'))
    const store = createTestStore()
    const worktree = makeWorktree({
      id: 'wt-1',
      repoId: 'repo1',
      workspaceStatus: 'completed',
      lastActivityAt: 1
    })
    const updateWorktreeMeta = vi.fn().mockResolvedValue({ ok: true })
    seedStore(store, {
      worktreesByRepo: { repo1: [worktree] },
      tabsByWorktree: { 'wt-1': [makeTab({ id: 'tab-1', worktreeId: 'wt-1' })] },
      updateWorktreeMeta
    })

    store.getState().setAgentStatus('tab-1:0', {
      state: 'working',
      prompt: 'New task',
      agentType: 'claude'
    })

    expect(updateWorktreeMeta).toHaveBeenCalledWith(
      'wt-1',
      { workspaceStatus: 'in-progress', lastActivityAt: Date.now() },
      { executionHostId: 'local' }
    )
    updateWorktreeMeta.mockClear()
    store.getState().setAgentStatus('tab-1:0', {
      state: 'working',
      prompt: 'New task',
      agentType: 'claude'
    })
    expect(updateWorktreeMeta).not.toHaveBeenCalled()
  })

  it('ignores a stale restored working snapshot', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-20T12:00:00Z'))
    const store = createTestStore()
    const updateWorktreeMeta = vi.fn().mockResolvedValue({ ok: true })
    seedStore(store, {
      worktreesByRepo: {
        repo1: [makeWorktree({ id: 'wt-1', repoId: 'repo1', workspaceStatus: 'completed' })]
      },
      tabsByWorktree: { 'wt-1': [makeTab({ id: 'tab-1', worktreeId: 'wt-1' })] },
      updateWorktreeMeta
    })

    store
      .getState()
      .setAgentStatus(
        'tab-1:0',
        { state: 'working', prompt: 'Old task', agentType: 'claude', restoredUnconfirmed: true },
        undefined,
        { updatedAt: Date.now() - 120_000 }
      )
    expect(updateWorktreeMeta).not.toHaveBeenCalled()
  })
})
