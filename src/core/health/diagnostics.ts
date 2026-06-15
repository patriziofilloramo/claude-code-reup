import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { getClaudeProjectsDirectory, resolveProjectPath } from '../project/claude-paths.js'
import { loadProjects } from '../project/project-discovery.js'
import { inspectProjectSidecarLock } from '../project/project-sidecar-lock.js'
import { isValidSessionId } from '../session/session-model.js'
import type { Project, Session, SessionStatus } from '../session/session-model.js'
import { primaryStatus } from '../session/session-signals.js'

const SESSION_TRANSCRIPT_PATTERN =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i

export interface BrokenSessionIndex {
  path: string
  projectId: string
  reason: string
}

export interface DiagnosticsSession extends Session {
  primaryStatus: SessionStatus
  projectId: string
}

export interface OrphanedTranscript {
  projectId: string
  projectPath: string
  sessionId: string
}

export interface StaleSidecarLock {
  path: string
  projectId: string
  reason: string
}

export interface DiagnosticsReport {
  brokenIndices: BrokenSessionIndex[]
  expiring: DiagnosticsSession[]
  orphanedTranscripts: OrphanedTranscript[]
  pathMissing: DiagnosticsSession[]
  staleLocks: StaleSidecarLock[]
}

/** Performs non-destructive checks shared by the web Lost & Found view and CLI doctor. */
export async function buildDiagnosticsReport(): Promise<DiagnosticsReport> {
  const projectsDirectory = getClaudeProjectsDirectory()
  const [projects, projectDirectoryNames] = await Promise.all([
    loadProjects(),
    listProjectDirectoryNames(projectsDirectory),
  ])
  const projectsById = new Map(projects.map((project) => [project.id, project]))
  const report: DiagnosticsReport = {
    brokenIndices: [],
    expiring: [],
    orphanedTranscripts: [],
    pathMissing: [],
    staleLocks: [],
  }

  collectSessionDiagnostics(projects, report)
  await Promise.all(
    projectDirectoryNames.map((projectId) =>
      inspectProjectDirectory(projectsDirectory, projectId, projectsById.get(projectId), report)
    )
  )
  sortDiagnosticsReport(report)
  return report
}

function collectSessionDiagnostics(projects: Project[], report: DiagnosticsReport): void {
  for (const project of projects) {
    for (const session of project.sessions) {
      const diagnosticSession = serializeDiagnosticsSession(project.id, session)
      if (diagnosticSession.primaryStatus === 'expiring') report.expiring.push(diagnosticSession)
      if (diagnosticSession.primaryStatus === 'path-missing') {
        report.pathMissing.push(diagnosticSession)
      }
    }
  }
}

async function inspectProjectDirectory(
  projectsDirectory: string,
  projectId: string,
  project: Project | undefined,
  report: DiagnosticsReport
): Promise<void> {
  const projectDirectory = join(projectsDirectory, projectId)
  const [indexResult, fileNames, lockInspection] = await Promise.all([
    inspectSessionIndex(projectDirectory, projectId),
    listFileNames(projectDirectory),
    inspectProjectSidecarLock(join(projectDirectory, 'ccm.json.lock')),
  ])

  if (indexResult.broken) report.brokenIndices.push(indexResult.broken)
  if (indexResult.sessionIds) {
    const projectPath = project?.path ?? (await resolveProjectPath(projectId))
    for (const fileName of fileNames) {
      const match = SESSION_TRANSCRIPT_PATTERN.exec(fileName)
      if (!match || indexResult.sessionIds.has(match[1].toLowerCase())) continue
      report.orphanedTranscripts.push({
        projectId,
        projectPath,
        sessionId: match[1].toLowerCase(),
      })
    }
  }
  if (lockInspection.state === 'abandoned' || lockInspection.state === 'unknown') {
    report.staleLocks.push({
      path: join(projectDirectory, 'ccm.json.lock'),
      projectId,
      reason: lockInspection.reason,
    })
  }
}

async function inspectSessionIndex(
  projectDirectory: string,
  projectId: string
): Promise<{ broken?: BrokenSessionIndex; sessionIds?: Set<string> }> {
  const indexPath = join(projectDirectory, 'sessions-index.json')
  let indexContent: string
  try {
    indexContent = await readFile(indexPath, 'utf8')
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
      ? {}
      : { broken: { path: indexPath, projectId, reason: 'index is unreadable' } }
  }

  try {
    const parsedIndex = JSON.parse(indexContent) as unknown
    const index =
      parsedIndex !== null && typeof parsedIndex === 'object'
        ? (parsedIndex as { sessions?: unknown })
        : {}
    if (!Array.isArray(index.sessions)) {
      return { broken: { path: indexPath, projectId, reason: 'sessions array is missing' } }
    }

    const sessionIds = new Set<string>()
    for (const session of index.sessions) {
      const sessionId = (session as Record<string, unknown> | null)?.['id']
      if (typeof sessionId !== 'string' || !isValidSessionId(sessionId)) {
        return { broken: { path: indexPath, projectId, reason: 'session entry has no valid id' } }
      }
      sessionIds.add(sessionId.toLowerCase())
    }
    return { sessionIds }
  } catch {
    return { broken: { path: indexPath, projectId, reason: 'index contains invalid JSON' } }
  }
}

function serializeDiagnosticsSession(projectId: string, session: Session): DiagnosticsSession {
  return { ...session, primaryStatus: primaryStatus(session.signals), projectId }
}

async function listProjectDirectoryNames(projectsDirectory: string): Promise<string[]> {
  try {
    return (await readdir(projectsDirectory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

async function listFileNames(directory: string): Promise<string[]> {
  try {
    return await readdir(directory)
  } catch {
    return []
  }
}

function sortDiagnosticsReport(report: DiagnosticsReport): void {
  report.brokenIndices.sort((left, right) => left.projectId.localeCompare(right.projectId))
  report.expiring.sort((left, right) => left.updated.localeCompare(right.updated))
  report.orphanedTranscripts.sort((left, right) => left.sessionId.localeCompare(right.sessionId))
  report.pathMissing.sort((left, right) => right.updated.localeCompare(left.updated))
  report.staleLocks.sort((left, right) => left.projectId.localeCompare(right.projectId))
}
