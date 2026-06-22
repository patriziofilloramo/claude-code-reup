import { isAbsolute, relative, resolve } from 'node:path'

import type { ExtensionProject, ExtensionSession } from './swoop-data.js'

export interface CockpitProjectGroup {
  project: ExtensionProject
  sessions: ExtensionSession[]
}

export interface ExtensionCockpitModel {
  activeEditorPath: string | null
  attentionElsewhere: ExtensionSession[]
  generatedAt: string
  projects: ExtensionProject[]
  recentElsewhere: CockpitProjectGroup[]
  sessions: ExtensionSession[]
  summary: {
    activeCount: number
    attentionCount: number
    workspaceSessionCount: number
  }
  workspaceProjects: CockpitProjectGroup[]
  workspaceRoots: string[]
}

export interface CockpitContext {
  activeEditorPath?: string
  includeArchived?: boolean
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
  const workspaceProjectIds = new Set(
    projects
      .filter((project) => workspaceRoots.some((root) => pathsOverlap(project.path, root)))
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

  const attentionElsewhere = sessions
    .filter((session) => !workspaceIds.has(session.id) && session.needsAttention)
    .sort((left, right) => compareCockpitSessions(left, right, activeEditorPath))
  const claimedIds = new Set([...workspaceIds, ...attentionElsewhere.map((session) => session.id)])
  const recentElsewhereSessions = sessions.filter((session) => !claimedIds.has(session.id))

  return {
    activeEditorPath,
    attentionElsewhere,
    generatedAt,
    projects,
    recentElsewhere: groupSessionsByProject(projects, recentElsewhereSessions)
      .sort(compareProjectGroups)
      .slice(0, RECENT_PROJECT_LIMIT),
    sessions,
    summary: {
      activeCount: sessions.filter((session) => session.isActive).length,
      attentionCount: sessions.filter((session) => session.needsAttention).length,
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
  return workspaceRoots.some((root) => pathsOverlap(session.projectPath, root))
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
  return (
    candidatePath !== null &&
    (projectPath === candidatePath || isPathInside(candidatePath, projectPath))
  )
}

function pathsOverlap(left: string, right: string): boolean {
  const resolvedLeft = resolve(left)
  const resolvedRight = resolve(right)
  return (
    resolvedLeft === resolvedRight ||
    isPathInside(resolvedLeft, resolvedRight) ||
    isPathInside(resolvedRight, resolvedLeft)
  )
}

function isPathInside(candidatePath: string, parentPath: string): boolean {
  try {
    const relativePath = relative(parentPath, candidatePath)
    return relativePath !== '' && !relativePath.startsWith('..') && !isAbsolute(relativePath)
  } catch {
    return false
  }
}
