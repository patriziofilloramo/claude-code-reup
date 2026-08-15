import {
  parseSessionQuery,
  sessionMatchesParsedQuery,
} from '../../src/core/session/session-query.js'
import { compareCockpitSessions } from './cockpit-model.js'
import type { ExtensionProject, ExtensionSession } from './reup-data.js'

export type DashboardFilter =
  | 'active'
  | 'all'
  | 'archived'
  | 'attention'
  | 'repository'
  | 'workspace'

export interface DashboardModel {
  continueNow: ExtensionSession | null
  projects: ExtensionProject[]
  sessions: ExtensionSession[]
  summary: {
    active: number
    archived: number
    attention: number
    projects: number
    sessions: number
  }
}

export function buildDashboardModel(
  projects: ExtensionProject[],
  sessions: ExtensionSession[],
  activeEditorPath: string | null,
  /**
   * Sessions the "Continue now" hero may propose. Under workspace scope this
   * is the workspace's own sessions: the primary call to action must not send
   * the user into a repository this window has not opened. `sessions` stays
   * complete regardless, because deep search resolves its hits against it.
   */
  continueNowCandidates: ExtensionSession[] = sessions
): DashboardModel {
  const ranked = [...sessions].sort((left, right) =>
    compareCockpitSessions(left, right, activeEditorPath)
  )
  const candidateIds = new Set(continueNowCandidates.map((session) => session.id))
  return {
    continueNow:
      ranked.find((session) => !session.archived && candidateIds.has(session.id)) ?? null,
    projects: [...projects].sort((left, right) =>
      (right.updated ?? '').localeCompare(left.updated ?? '')
    ),
    sessions: ranked,
    summary: {
      active: sessions.filter((session) => session.isActive).length,
      archived: sessions.filter((session) => session.archived).length,
      attention: sessions.filter((session) => session.needsAttention).length,
      projects: projects.length,
      sessions: sessions.length,
    },
  }
}

export function filterDashboardSessions(
  sessions: ExtensionSession[],
  queryText: string,
  filter: DashboardFilter,
  projectId: string | null,
  workspaceProjectIds: ReadonlySet<string>,
  repositoryProjectIds: ReadonlySet<string> = new Set()
): ExtensionSession[] {
  const query = parseSessionQuery(queryText)
  return sessions.filter((session) => {
    if (projectId && session.projectId !== projectId) return false
    if (filter === 'archived' && !session.archived) return false
    if (filter !== 'archived' && session.archived) return false
    if (filter === 'active' && !session.isActive) return false
    if (filter === 'attention' && !session.needsAttention) return false
    if (filter === 'workspace' && !workspaceProjectIds.has(session.projectId)) return false
    if (filter === 'repository' && !repositoryProjectIds.has(session.projectId)) return false
    return sessionMatchesParsedQuery(
      {
        active: session.isActive,
        archived: session.archived,
        branches: [session.branch ?? '', session.currentBranch ?? ''],
        project: [session.projectId, session.projectName, session.projectPath],
        status: session.primaryStatus,
        tags: session.tags,
        text: [session.id, session.title, ...session.tags],
      },
      query
    )
  })
}
