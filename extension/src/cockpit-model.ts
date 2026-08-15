import { resolve } from 'node:path'

import type { ExtensionProject, ExtensionSession } from './reup-data.js'
import { isInsideAnyWorkspaceRoot, isSameOrInside } from './workspace-paths.js'

export interface CockpitProjectGroup {
  project: ExtensionProject
  sessions: ExtensionSession[]
}

/**
 * Which locally discovered sessions a cockpit surface may show.
 *
 * `workspace` is the product default: a VS Code window answers for the folder
 * it has open. `all` is the explicit widening for cross-project work. The
 * device-wide default this replaced came from the removed shared memory store
 * (`Documents/DEFERRED_PROJECT_MEMORY_SYNC.md`) and no longer has a rationale.
 */
export type SessionScope = 'all' | 'workspace'

export interface ExtensionCockpitModel {
  activeEditorPath: string | null
  attentionElsewhere: ExtensionSession[]
  generatedAt: string
  projects: ExtensionProject[]
  recentElsewhere: CockpitProjectGroup[]
  /**
   * Sessions in the same repository as an open folder but not beneath it: a
   * monorepo root when one package is open, a sibling package. Shown as their
   * own group rather than folded into the workspace, so the workspace keeps
   * meaning exactly the folder while nearby work stays one click away.
   */
  repositoryProjects: CockpitProjectGroup[]
  /**
   * The scope actually applied. A requested `workspace` scope collapses to
   * `all` when no folder is open, because there is then nothing to scope to.
   * Surfaces draw this answer; they never re-derive it.
   */
  resolvedScope: SessionScope
  sessions: ExtensionSession[]
  summary: {
    /** Counts over every locally discovered session, whatever the scope. */
    activeCount: number
    attentionCount: number
    /** Sessions outside both the workspace and its repository. */
    elsewhereSessionCount: number
    repositorySessionCount: number
    /** Counts over the resolved scope — what badges and the status bar draw. */
    scopedActiveCount: number
    scopedAttentionCount: number
    workspaceSessionCount: number
  }
  workspaceProjects: CockpitProjectGroup[]
  workspaceRoots: string[]
}

export interface CockpitContext {
  activeEditorPath?: string
  /**
   * Whether the repository group contributes to the badge and status counts.
   * It is the same codebase, so it does by default; a user who wants the
   * indicator to track the open folder alone can turn it off.
   */
  countRepositorySessions?: boolean
  includeArchived?: boolean
  /**
   * Repository roots containing the open folders, resolved by the caller
   * because it needs the filesystem and this model stays pure. Often equal to
   * `workspaceRoots`, and then the repository group is simply empty.
   */
  repositoryRoots?: string[]
  sessionScope?: SessionScope
  workspaceRoots: string[]
}

const RECENT_PROJECT_LIMIT = 20

export function buildCockpitModel(
  projects: ExtensionProject[],
  sessions: ExtensionSession[],
  context: CockpitContext,
  generatedAt = new Date().toISOString()
): ExtensionCockpitModel {
  const workspaceRoots = context.workspaceRoots.map((root) => resolve(root))
  const activeEditorPath = context.activeEditorPath ? resolve(context.activeEditorPath) : null
  const resolvedScope = resolveSessionScope(context.sessionScope, workspaceRoots)

  const workspaceProjectIds = new Set(
    projects
      .filter((project) => isInsideAnyWorkspaceRoot(project.path, workspaceRoots))
      .map((project) => project.id)
  )
  const workspaceSessions = sessions
    .filter(
      (session) =>
        workspaceProjectIds.has(session.projectId) ||
        sessionMatchesAnyWorkspace(session, workspaceRoots)
    )
    .sort((left, right) => compareCockpitSessions(left, right, activeEditorPath))
  const workspaceIds = new Set(workspaceSessions.map((session) => session.id))

  // Same repository, but not beneath the open folder. Disjoint from the
  // workspace bucket by construction, so no session is ever counted twice.
  const repositoryRoots = (context.repositoryRoots ?? []).map((root) => resolve(root))
  const repositorySessions = sessions
    .filter(
      (session) =>
        !workspaceIds.has(session.id) &&
        isInsideAnyWorkspaceRoot(session.projectPath, repositoryRoots)
    )
    .sort((left, right) => compareCockpitSessions(left, right, activeEditorPath))
  const nearbyIds = new Set([...workspaceIds, ...repositorySessions.map((session) => session.id)])
  const sessionsElsewhere = sessions.filter((session) => !nearbyIds.has(session.id))

  // Workspace scope answers for the open folder and its repository. The
  // elsewhere sections stay computed but empty so every surface reads one
  // classification.
  const attentionElsewhere =
    resolvedScope === 'workspace'
      ? []
      : sessionsElsewhere
          .filter((session) => session.needsAttention)
          .sort((left, right) => compareCockpitSessions(left, right, activeEditorPath))
  const attentionIds = new Set(attentionElsewhere.map((session) => session.id))
  const recentElsewhereSessions =
    resolvedScope === 'workspace'
      ? []
      : sessionsElsewhere.filter((session) => !attentionIds.has(session.id))
  const countedSessions =
    context.countRepositorySessions === false
      ? workspaceSessions
      : [...workspaceSessions, ...repositorySessions]
  const scopedSessions = resolvedScope === 'workspace' ? countedSessions : sessions

  return {
    activeEditorPath,
    attentionElsewhere,
    generatedAt,
    projects,
    recentElsewhere: groupSessionsByProject(projects, recentElsewhereSessions)
      .sort(compareProjectGroups)
      .slice(0, RECENT_PROJECT_LIMIT),
    repositoryProjects: groupSessionsByProject(projects, repositorySessions).sort(
      compareProjectGroups
    ),
    resolvedScope,
    sessions,
    summary: {
      activeCount: sessions.filter((session) => session.isActive).length,
      attentionCount: sessions.filter((session) => session.needsAttention).length,
      elsewhereSessionCount: sessionsElsewhere.length,
      repositorySessionCount: repositorySessions.length,
      scopedActiveCount: scopedSessions.filter((session) => session.isActive).length,
      scopedAttentionCount: scopedSessions.filter((session) => session.needsAttention).length,
      workspaceSessionCount: workspaceSessions.length,
    },
    workspaceProjects: groupSessionsByProject(projects, workspaceSessions).sort((left, right) => {
      const activeEditorDifference =
        Number(projectContainsPath(right.project.path, activeEditorPath)) -
        Number(projectContainsPath(left.project.path, activeEditorPath))
      return activeEditorDifference || compareProjectGroups(left, right)
    }),
    workspaceRoots,
  }
}

/**
 * Resolves the requested scope against what the window can actually answer for.
 * Without an open folder there is no workspace to scope to, so the request
 * degrades to `all` rather than producing a permanently empty view.
 */
function resolveSessionScope(
  requestedScope: SessionScope | undefined,
  workspaceRoots: readonly string[]
): SessionScope {
  return (requestedScope ?? 'workspace') === 'workspace' && workspaceRoots.length > 0
    ? 'workspace'
    : 'all'
}

export function compareCockpitSessions(
  left: ExtensionSession,
  right: ExtensionSession,
  activeEditorPath: string | null
): number {
  const activeEditorDifference =
    Number(projectContainsPath(right.projectPath, activeEditorPath)) -
    Number(projectContainsPath(left.projectPath, activeEditorPath))
  if (activeEditorDifference) return activeEditorDifference
  if (left.isActive !== right.isActive) return left.isActive ? -1 : 1

  const adviceDifference = adviceRank(right) - adviceRank(left)
  if (adviceDifference) return adviceDifference

  const leftBranchMatches = branchMatches(left)
  const rightBranchMatches = branchMatches(right)
  if (leftBranchMatches !== rightBranchMatches) return leftBranchMatches ? -1 : 1
  return (right.updated ?? '').localeCompare(left.updated ?? '')
}

export function sessionMatchesAnyWorkspace(
  session: ExtensionSession,
  workspaceRoots: readonly string[]
): boolean {
  return isInsideAnyWorkspaceRoot(session.projectPath, workspaceRoots)
}

function groupSessionsByProject(
  projects: ExtensionProject[],
  sessions: ExtensionSession[]
): CockpitProjectGroup[] {
  const projectById = new Map(projects.map((project) => [project.id, project]))
  const groups = new Map<string, ExtensionSession[]>()
  for (const session of sessions) {
    const group = groups.get(session.projectId) ?? []
    group.push(session)
    groups.set(session.projectId, group)
  }

  return [...groups.entries()].flatMap(([projectId, projectSessions]) => {
    const project = projectById.get(projectId)
    if (!project) return []
    return [
      {
        project,
        sessions: [...projectSessions].sort((left, right) =>
          compareCockpitSessions(left, right, null)
        ),
      },
    ]
  })
}

function compareProjectGroups(left: CockpitProjectGroup, right: CockpitProjectGroup): number {
  const leftActive = left.sessions.some((session) => session.isActive)
  const rightActive = right.sessions.some((session) => session.isActive)
  if (leftActive !== rightActive) return leftActive ? -1 : 1
  const leftAttention = left.sessions.some((session) => session.needsAttention)
  const rightAttention = right.sessions.some((session) => session.needsAttention)
  if (leftAttention !== rightAttention) return leftAttention ? -1 : 1
  return (right.project.updated ?? '').localeCompare(left.project.updated ?? '')
}

function adviceRank(session: ExtensionSession): number {
  if (session.advice.severity === 'blocked') return 2
  if (session.advice.severity === 'warning') return 1
  return 0
}

function branchMatches(session: ExtensionSession): boolean {
  return (
    session.branch !== null &&
    session.currentBranch !== null &&
    session.branch === session.currentBranch
  )
}

function projectContainsPath(projectPath: string, candidatePath: string | null): boolean {
  return candidatePath !== null && isSameOrInside(candidatePath, projectPath)
}
