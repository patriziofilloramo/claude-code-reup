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
import { getResumeAdvice, type ResumeAdvice } from '../../src/core/session/resume-advice.js'
import { searchTranscripts } from '../../src/core/session/session-search.js'
import {
  isResumeListVisibleSession,
  isResumeVisibleSession,
  type ResumeListSessionInput,
} from '../../src/core/session/session-visibility.js'
import {
  getProjectSyncStatus,
  type ProjectSyncStatus,
} from '../../src/core/sync/project-sync-status.js'
import {
  buildCockpitModel,
  type CockpitContext,
  type ExtensionCockpitModel,
} from './cockpit-model.js'
import { compactProjectName, compactText } from './formatting.js'
import type { ReupLogger } from './logger.js'

const PREVIEW_HINT_LIMIT = 80

export interface ExtensionProject {
  id: string
  memoryStatus: ProjectSyncStatus | null
  name: string
  path: string
  sessionCount: number
  updated: string | null
}

export interface ExtensionSession {
  advice: ResumeAdvice
  archived: boolean
  branch: string | null
  branchDrift: boolean
  contextTokens: number | null
  currentBranch: string | null
  id: string
  isActive: boolean
  messageCount: number
  memoryStatus: ProjectSyncStatus | null
  needsAttention: boolean
  planSummary: string | null
  primaryStatus: SessionStatus
  projectId: string
  projectName: string
  projectPath: string
  tags: string[]
  title: string
  todoSummary: string | null
  updated: string | null
}

export interface ExtensionSessionModel {
  generatedAt: string
  projects: ExtensionProject[]
  sessions: ExtensionSession[]
}

export interface ExtensionContentMatch {
  matchCount: number
  session: ExtensionSession
  snippet: string
}

export interface LoadExtensionModelOptions {
  includeArchived: boolean
  includePreviewHints: boolean
  workspacePath?: string
}

export class ReupDataSource {
  constructor(private readonly logger: ReupLogger) {}

  async loadModel(options: LoadExtensionModelOptions): Promise<ExtensionSessionModel> {
    const [projects, activeSessionIds] = await Promise.all([loadProjects(), getActiveSessions()])
    const sessions = await createExtensionSessions(projects, activeSessionIds, options)
    const visibleProjectIds = new Set(sessions.map((session) => session.projectId))
    const extensionProjects = projects
      .filter((project) => visibleProjectIds.has(project.id))
      .map((project) => createExtensionProject(project, sessions))

    this.logger.debug('loaded Reup model', {
      projects: extensionProjects.length,
      sessions: sessions.length,
    })

    return {
      generatedAt: new Date().toISOString(),
      projects: extensionProjects,
      sessions: rankSessionsForWorkspace(sessions, options.workspacePath),
    }
  }

  async loadCockpitModel(context: CockpitContext): Promise<ExtensionCockpitModel> {
    const [projects, activeSessionIds] = await Promise.all([loadProjects(), getActiveSessions()])
    const sessions = await createExtensionSessions(projects, activeSessionIds, {
      includeArchived: context.includeArchived ?? false,
      includePreviewHints: false,
      workspacePath: context.workspaceRoots[0],
    })
    const visibleProjectIds = new Set(sessions.map((session) => session.projectId))
    const extensionProjects = projects
      .filter((project) => visibleProjectIds.has(project.id))
      .map((project) => createExtensionProject(project, sessions))
    const model = buildCockpitModel(extensionProjects, sessions, context)
    this.logger.debug('loaded Reup cockpit model', {
      attention: model.summary.attentionCount,
      projects: extensionProjects.length,
      sessions: sessions.length,
      workspaceSessions: model.summary.workspaceSessionCount,
    })
    return model
  }

  async resolveSession(projectId: string, sessionId: string): Promise<ExtensionSession | null> {
    const [projects, activeSessionIds] = await Promise.all([loadProjects(), getActiveSessions()])
    const project = projects.find((candidate) => candidate.id === projectId)
    const session = project?.sessions.find((candidate) => candidate.id === sessionId)
    if (!project || !session || !isResumeVisibleSession(session)) return null
    return createExtensionSession(project, session, activeSessionIds, {
      includePreviewHints: false,
    })
  }

  async loadPreview(projectId: string, sessionId: string) {
    return loadSessionPreview(sessionTranscriptPath(projectId, sessionId))
  }

  async searchTranscriptContent(
    query: string,
    includeArchived: boolean,
    onProgress?: (scanned: number, total: number) => void
  ): Promise<ExtensionContentMatch[]> {
    const [projects, activeSessionIds] = await Promise.all([loadProjects(), getActiveSessions()])
    const searchableProjects = projects.map((project) => ({
      ...project,
      sessions: project.sessions.filter((session) =>
        isExtensionSessionVisible(session, { includeArchived })
      ),
    }))
    const matches = await searchTranscripts(query, searchableProjects, onProgress)
    return Promise.all(
      matches.map(async (match) => ({
        matchCount: match.matchCount,
        session: await createExtensionSession(match.project, match.session, activeSessionIds, {
          includePreviewHints: false,
        }),
        snippet: match.snippet,
      }))
    )
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

export function isExtensionSessionVisible(
  session: ResumeListSessionInput,
  options: Pick<LoadExtensionModelOptions, 'includeArchived'>
): boolean {
  return isResumeListVisibleSession(session, options)
}

async function createExtensionSessions(
  projects: Project[],
  activeSessionIds: ReadonlySet<string>,
  options: LoadExtensionModelOptions
): Promise<ExtensionSession[]> {
  const rawRows = projects.flatMap((project) =>
    project.sessions
      .filter((session) => isExtensionSessionVisible(session, options))
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
    advice: getResumeAdvice(session, activeSessionIds.has(session.id)),
    archived: session.signals.archived,
    branch: session.gitBranch ?? null,
    branchDrift:
      Boolean(session.gitBranch) &&
      Boolean(session.currentBranch) &&
      session.gitBranch !== session.currentBranch,
    contextTokens: session.context.latestContextTokens,
    currentBranch: session.currentBranch ?? null,
    id: session.id,
    isActive: activeSessionIds.has(session.id),
    messageCount: session.messageCount,
    memoryStatus: getProjectSyncStatus(project),
    needsAttention: isAttentionStatus(status),
    planSummary: previewHints.planSummary,
    primaryStatus: status,
    projectId: project.id,
    projectName: compactProjectName(project.path),
    projectPath: session.projectPath,
    tags: session.tags ?? [],
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
    memoryStatus: getProjectSyncStatus(project),
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
