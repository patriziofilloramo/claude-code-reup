import { isAbsolute, relative, resolve } from 'node:path'

import { normalizePathForComparison } from '../../src/core/project/path-comparison.js'

/**
 * Whether `candidatePath` is `parentPath` itself or a descendant of it.
 *
 * This is the only path comparison Reup's VS Code surfaces may use to decide
 * workspace membership. Two traps make a hand-rolled check wrong:
 *
 * - VS Code's `Uri.fsPath` always lower-cases the Windows drive letter, while
 *   Claude Code records whatever casing the shell had (`C:\...` from a
 *   terminal, `c:\...` from an editor-spawned one). A raw `===` therefore
 *   misses the single most common match of all — a session started in the
 *   workspace root — and silently empties the workspace view.
 * - The relation is deliberately one-directional. An ancestor of the open
 *   folder is not part of this workspace: treating containment as symmetric
 *   pulled a home directory and a monorepo parent into a project's own view.
 *
 * A session recorded in a parent of the open folder is therefore out of scope
 * by design. `Reup: Resume Session` remains the global escape hatch for it.
 */
export function isSameOrInside(candidatePath: string, parentPath: string): boolean {
  const candidate = normalizePathForComparison(resolve(candidatePath))
  const parent = normalizePathForComparison(resolve(parentPath))
  if (candidate === parent) return true

  try {
    const relativePath = relative(parent, candidate)
    return relativePath !== '' && !relativePath.startsWith('..') && !isAbsolute(relativePath)
  } catch {
    return false
  }
}

/** Whether a recorded path belongs to any of the currently open workspace roots. */
export function isInsideAnyWorkspaceRoot(
  candidatePath: string,
  workspaceRoots: readonly string[]
): boolean {
  return workspaceRoots.some((root) => isSameOrInside(candidatePath, root))
}
