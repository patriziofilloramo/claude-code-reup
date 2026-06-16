import { access } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'

import { loadProjects } from '../../src/core/project/project-discovery.js'
import { normalizePathForComparison } from '../../src/core/project/path-comparison.js'
import { getActiveSessions } from '../../src/core/session/active-sessions.js'
import type { Project, Session, SessionStatus } from '../../src/core/session/session-model.js'
import { isValidSessionId } from '../../src/core/session/session-model.js'
import {
  loadSessionPreview,
  sessionTranscriptPath,
} from '../../src/core/session/session-preview.js'
import { primaryStatus } from '../../src/core/session/session-signals.js'
import { compactProjectName, compactText } from './formatting.js'
import type { SwoopLogger } from './logger.js'

const PREVIEW_HINT_LIMIT = 80

export interface ExtensionProject {
  id: string
  name: string
  path: string
  sessionCount: number
  updated: string | null
}

export interface ExtensionSession {
  branch: string | null
  contextTokens: number | null
  currentBranch: string | null
  id: string
  isActive: boolean
  messageCount: number
  needsAttention: boolean
  planSummary: string | null
  primaryStatus: SessionStatus
  projectId: string
  projectName: string
  projectPath: string
  title: string
  todoSummary: string | null
  updated: string | null
}

export interface ExtensionSessionModel {
  generatedAt: string
  projects: ExtensionProject[]
  sessions: ExtensionSession[]
}

export interface LoadExtensionModelOptions {
  includeArchived: boolean
  includePreviewHints: boolean
  workspacePath?: string
}

export class SwoopDataSource {
  constructor(private readonly logger: SwoopLogger) {}

  async loadModel(options: LoadExtensionModelOptions): Promise<ExtensionSessionModel> {
    const [projects, activeSessionIds] = await Promise.all([loadProjects(), getActiveSessions()])
    const sessions = await createExtensionSessions(projects, activeSessionIds, options)
    const visibleProjectIds = new Set(sessions.map((session) => session.projectId))
    const extensionProjects = projects
      .filter((project) => visibleProjectIds.has(project.id) || options.includeArchived)
      .map((project) => createExtensionProject(project, sessions))

    this.logger.debug('loaded Swoop model', {
      projects: extensionProjects.length,
      sessions: sessions.length,
    })

    return {
      generatedAt: new Date().toISOString(),
      projects: extensionProjects,
      sessions: rankSessionsForWorkspace(sessions, options.workspacePath),
    }
  }
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export function rankSessionsForWorkspace(
  sessions: ExtensionSession[],
  workspacePath: string | undefined
): ExtensionSession[] {
  return [...sessions].sort((left, right) => {
    const leftScore = workspaceScore(left, workspacePath)
    const rightScore = workspaceScore(right, workspacePath)
    if (leftScore !== rightScore) return rightScore - leftScore
    const leftBranchMatches = branchMatchesCurrentWorkspace(left)
    const rightBranchMatches = branchMatchesCurrentWorkspace(right)
    if (leftBranchMatches !== rightBranchMatches) return leftBranchMatches ? -1 : 1
    if (left.isActive !== right.isActive) return left.isActive ? -1 : 1
    if (left.needsAttention !== right.needsAttention) return left.needsAttention ? -1 : 1
    return (right.updated ?? '').localeCompare(left.updated ?? '')
  })
}

export function sessionMatchesWorkspace(
  session: ExtensionSession,
  workspacePath: string | undefined
): boolean {
  return workspaceScore(session, workspacePath) > 0
}

async function createExtensionSessions(
  projects: Project[],
  activeSessionIds: ReadonlySet<string>,
  options: LoadExtensionModelOptions
): Promise<ExtensionSession[]> {
  const rawRows = projects.flatMap((project) =>
    project.sessions
      .filter((session) => options.includeArchived || !session.signals.archived)
      .map((session) => ({ project, session }))
  )

  return Promise.all(
    rawRows.map(async ({ project, session }, index) =>
      createExtensionSession(project, session, activeSessionIds, {
        includePreviewHints: options.includePreviewHints && index < PREVIEW_HINT_LIMIT,
      })
    )
  )
}

async function createExtensionSession(
  project: Project,
  session: Session,
  activeSessionIds: ReadonlySet<string>,
  options: { includePreviewHints: boolean }
): Promise<ExtensionSession> {
  const status = primaryStatus(session.signals)
  const previewHints = options.includePreviewHints
    ? await loadPreviewHints(project.id, session.id)
    : { planSummary: null, todoSummary: null }

  return {
    branch: session.gitBranch ?? null,
    contextTokens: session.context.latestContextTokens,
    currentBranch: session.currentBranch ?? null,
    id: session.id,
    isActive: activeSessionIds.has(session.id),
    messageCount: session.messageCount,
    needsAttention: isAttentionStatus(status),
    planSummary: previewHints.planSummary,
    primaryStatus: status,
    projectId: project.id,
    projectName: compactProjectName(project.path),
    projectPath: session.projectPath,
    title: session.alias ?? session.name,
    todoSummary: previewHints.todoSummary,
    updated: session.updated,
  }
}

export function isAttentionStatus(status: SessionStatus): boolean {
  return status === 'interrupted' || status === 'expiring' || status === 'path-missing'
}

function createExtensionProject(project: Project, sessions: ExtensionSession[]): ExtensionProject {
  const projectSessions = sessions.filter((session) => session.projectId === project.id)
  return {
    id: project.id,
    name: compactProjectName(project.path),
    path: project.path,
    sessionCount: projectSessions.length,
    updated: projectSessions[0]?.updated ?? null,
  }
}

async function loadPreviewHints(
  projectId: string,
  sessionId: string
): Promise<Pick<ExtensionSession, 'planSummary' | 'todoSummary'>> {
  if (!isValidSessionId(sessionId)) return { planSummary: null, todoSummary: null }

  const preview = await loadSessionPreview(sessionTranscriptPath(projectId, sessionId))
  const todoCounts = preview.automaticContext.todos.counts
  const openTodos = todoCounts.pending + todoCounts.in_progress + todoCounts.unknown
  return {
    planSummary: preview.automaticContext.plan
      ? compactText(preview.automaticContext.plan.text, 90)
      : null,
    todoSummary:
      openTodos > 0 || todoCounts.completed > 0
        ? `${openTodos} open, ${todoCounts.completed} done`
        : null,
  }
}

function workspaceScore(session: ExtensionSession, workspacePath: string | undefined): number {
  if (!workspacePath) return 0

  const workspace = normalizePathForComparison(resolve(workspacePath))
  const project = normalizePathForComparison(resolve(session.projectPath))
  if (workspace === project) return 100
  if (isPathInside(project, workspace) || isPathInside(workspace, project)) return 70
  return 0
}

function isPathInside(candidatePath: string, parentPath: string): boolean {
  try {
    const relativePath = relative(parentPath, candidatePath)
    return relativePath !== '' && !relativePath.startsWith('..') && !isAbsolute(relativePath)
  } catch {
    return false
  }
}

function branchMatchesCurrentWorkspace(session: ExtensionSession): boolean {
  return (
    session.branch !== null &&
    session.currentBranch !== null &&
    session.branch === session.currentBranch
  )
}
