// @vitest-environment happy-dom
import { renderHook, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Worktree } from '../../../../../../shared/worktree/types'
import { cloneDefaultWorkspaceStatuses } from '../../../../../../shared/workspace-statuses'
import { useSidebarWorktreeSortOrder } from './use-sort-order'

const state = vi.hoisted(() => ({
  sortEpoch: 0,
  worktreesByRepo: {} as Record<string, Worktree[]>,
  tabsByWorktree: {},
  ptyIdsByTabId: {},
  agentStatusByPaneKey: {}
}))
vi.mock('@/store', () => ({
  useAppStore: Object.assign((selector: (value: typeof state) => unknown) => selector(state), {
    getState: () => state
  })
}))
vi.mock('@/lib/telemetry', () => ({ track: vi.fn() }))
vi.mock('@/lib/worktree-sort-order-persistence', () => ({
  persistWorktreeSortOrderByHost: vi.fn()
}))

afterEach(cleanup)

function workspace(id: string, lastActivityAt: number, sortOrder: number): Worktree {
  return {
    id,
    repoId: 'repo',
    path: `/repo/${id}`,
    branch: id,
    head: '',
    isBare: false,
    isMainWorktree: false,
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    isArchived: false,
    comment: '',
    isUnread: false,
    isPinned: false,
    displayName: id,
    sortOrder,
    lastActivityAt,
    workspaceStatus: 'completed'
  }
}

describe('status sorting before terminal startup', () => {
  it('sorts Done by recency immediately on enabling status grouping', () => {
    const old = workspace('old', Date.now() - 86_400_000, 100)
    const recent = workspace('recent', Date.now() - 1000, 0)
    state.worktreesByRepo = { repo: [old, recent] }
    const repoMap = new Map()
    const workspaceStatuses = cloneDefaultWorkspaceStatuses()
    const { result, rerender } = renderHook(
      ({ grouped }: { grouped: boolean }) =>
        useSidebarWorktreeSortOrder({
          allWorktrees: [old, recent],
          repoMap,
          workspaceStatuses,
          sortBy: 'smart',
          groupBy: grouped ? 'workspace-status' : 'none'
        }),
      { initialProps: { grouped: false } }
    )
    expect(result.current).toEqual(['old', 'recent'])
    rerender({ grouped: true })
    expect(result.current).toEqual(['recent', 'old'])
    rerender({ grouped: false })
    expect(result.current).toEqual(['old', 'recent'])
  })
})
