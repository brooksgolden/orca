import { useMemo } from 'react'
import { Columns2 } from 'lucide-react'
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import { activateAndRevealWorkspace } from '@/lib/worktree-activation'
import { collectWorkspaceIds, findWorkspaceSplitGroup } from '@/lib/workspace-split-layout'
import { useAppStore } from '@/store'
import { useAllWorktrees } from '@/store/selectors'
import { folderWorkspaceKey } from '../../../../shared/workspace-scope'

// Why shared constants: the normalisers below must return a stable identity so
// the candidate memo does not rebuild on every render when a slice is absent.
const NO_WORKTREES: never[] = []
const NO_FOLDERS: never[] = []
const NO_SPLIT_GROUPS: never[] = []

export function WorkspaceSplitMenuItems({
  worktreeId,
  disabled
}: {
  worktreeId: string
  disabled: boolean
}): React.JSX.Element | null {
  const allWorktrees = useAllWorktrees()
  const folderWorkspaces = useAppStore((state) => state.folderWorkspaces)
  const splitGroups = useAppStore((state) => state.workspaceSplitGroups)
  const placeWorkspaceAtEdge = useAppStore((state) => state.placeWorkspaceAtEdge)
  const unsplitWorkspace = useAppStore((state) => state.unsplitWorkspace)
  // Why normalise: this renders inside the workspace context menu, so a store
  // composition that has not produced one of these slices would throw during
  // render and take the entire menu down rather than hiding one submenu.
  const worktrees = Array.isArray(allWorktrees) ? allWorktrees : NO_WORKTREES
  const folders = Array.isArray(folderWorkspaces) ? folderWorkspaces : NO_FOLDERS
  const groups = Array.isArray(splitGroups) ? splitGroups : NO_SPLIT_GROUPS
  const group = findWorkspaceSplitGroup(groups, worktreeId)
  const candidates = useMemo(() => {
    const options = [
      ...worktrees.map((worktree) => ({
        id: worktree.id,
        name:
          worktree.displayName || worktree.path.split(/[\\/]/).findLast(Boolean) || worktree.path
      })),
      ...folders.map((folder) => ({ id: folderWorkspaceKey(folder.id), name: folder.name }))
    ]
    const seen = new Set<string>()
    return options.filter((option) => {
      if (
        option.id === worktreeId ||
        seen.has(option.id) ||
        findWorkspaceSplitGroup(groups, option.id)
      ) {
        return false
      }
      seen.add(option.id)
      return true
    })
  }, [worktrees, folders, groups, worktreeId])

  if (group) {
    return (
      <DropdownMenuItem
        disabled={disabled}
        onSelect={() => {
          const partnerId = collectWorkspaceIds(group.layout).find((id) => id !== worktreeId)
          if (
            partnerId &&
            activateAndRevealWorkspace(partnerId, { revealInSidebar: false }) !== false
          ) {
            unsplitWorkspace(worktreeId)
          }
        }}
      >
        <Columns2 className="size-3.5" />
        {translate('orca.workspace.unsplit', 'Unsplit workspace')}
      </DropdownMenuItem>
    )
  }
  if (candidates.length === 0) {
    return null
  }
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger disabled={disabled}>
        <Columns2 className="size-3.5" />
        {translate('orca.workspace.splitWith', 'Split with workspace')}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <div className="max-h-80 overflow-y-auto worktree-sidebar-scrollbar">
          {candidates.map((candidate) => (
            <DropdownMenuItem
              key={candidate.id}
              onSelect={() => {
                if (
                  activateAndRevealWorkspace(candidate.id, { revealInSidebar: false }) !== false &&
                  activateAndRevealWorkspace(worktreeId, { revealInSidebar: false }) !== false
                ) {
                  placeWorkspaceAtEdge(candidate.id, worktreeId, 'right')
                }
              }}
            >
              <span className="max-w-56 truncate">{candidate.name}</span>
            </DropdownMenuItem>
          ))}
        </div>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
