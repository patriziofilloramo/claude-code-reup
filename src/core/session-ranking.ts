import { isAbsolute, relative, resolve } from 'node:path'

import type { Project, Session } from './session-model.js'

export interface RankedSession {
  active: boolean
  inCurrentDirectory: boolean
  project: Project
  session: Session
}

/**
 * Flattens and ranks sessions for interactive suggestions.
 *
 * Sessions associated with the current directory come first, followed by
 * active sessions and then recent activity. Archived sessions remain
 * discoverable, but sort behind otherwise equivalent sessions.
 */
export function rankSessionCandidates(
  projects: Project[],
  activeSessionIds: ReadonlySet<string>,
  currentDirectory?: string
): RankedSession[] {
  return projects
    .flatMap((project) =>
      project.sessions.map((session) => ({
        active: activeSessionIds.has(session.id),
        inCurrentDirectory: isCurrentDirectoryWithinProject(currentDirectory, session.projectPath),
        project,
        session,
      }))
    )
    .sort(compareSessionCandidates)
}

/** Filters ranked candidates without changing their relevance order. */
export function filterSessionCandidates(
  candidates: RankedSession[],
  query: string
): RankedSession[] {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return candidates

  return candidates.filter(({ project, session }) =>
    [
      project.id,
      project.path,
      session.alias,
      session.currentBranch,
      session.gitBranch,
      session.id,
      session.name,
      session.projectPath,
    ].some((value) => value?.toLowerCase().includes(normalizedQuery))
  )
}

function compareSessionCandidates(left: RankedSession, right: RankedSession): number {
  if (left.inCurrentDirectory !== right.inCurrentDirectory) {
    return left.inCurrentDirectory ? -1 : 1
  }
  if (left.active !== right.active) return left.active ? -1 : 1
  if (left.session.signals.archived !== right.session.signals.archived) {
    return left.session.signals.archived ? 1 : -1
  }
  return right.session.updated.localeCompare(left.session.updated)
}

function isCurrentDirectoryWithinProject(
  currentDirectory: string | undefined,
  projectPath: string
): boolean {
  if (!currentDirectory) return false

  try {
    const relativePath = relative(resolve(projectPath), resolve(currentDirectory))
    return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))
  } catch {
    return false
  }
}
