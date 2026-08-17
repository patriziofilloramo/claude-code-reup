import { access, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { getClaudeProjectsDirectory, resolveProjectPath } from '../project/claude-paths.js'
import { loadProjects } from '../project/project-discovery.js'
import { inspectProjectSidecarLock } from '../project/project-sidecar-lock.js'
import { getLiveSessionRecords } from '../session/active-sessions.js'
import { readAttentionMarkers } from '../session/attention.js'
import { inspectAttentionHookHealth } from '../session/attention-hooks-integration.js'
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

/**
 * An attention marker whose session holds no live process.
 *
 * The marker can never alert again — `resolveSessionLiveState()` answers
 * `detached` without a live process, before it ever consults needs-input — so
 * this is hygiene, not a wrong state. It is reported because nothing collects
 * it: `resolveUserInputWait()` deliberately stays pure and only names a stale
 * marker for a caller to delete, the web is the sole caller that does, and its
 * call sites sit inside the live-lock loop. A marker left by an abandoned
 * session is therefore unreachable by every automatic path, and only
 * `reup attention remove`, which clears the whole directory, can remove it.
 */
export interface OrphanedAttentionMarker {
  occurredAt: string
  sessionId: string
}

export interface LegacyProjectMemoryArtifact {
  kind: 'link-marker' | 'project-memory-directory'
  path: string
  projectId: string
}

export interface DiagnosticsReport {
  /**
   * Set when Reup's Claude Code hooks are registered but name a script that no
   * longer exists. They then run and fail silently, costing every turn
   * boundary and needs-input alert, with no other symptom than live state
   * quietly degrading to guesswork.
   */
  brokenAttentionHook: { command: string; missingPath: string } | null
  brokenIndices: BrokenSessionIndex[]
  expiring: DiagnosticsSession[]
  legacyProjectMemoryArtifacts: LegacyProjectMemoryArtifact[]
  orphanedAttentionMarkers: OrphanedAttentionMarker[]
  orphanedTranscripts: OrphanedTranscript[]
  pathMissing: DiagnosticsSession[]
  staleLocks: StaleSidecarLock[]
}

/** Performs non-destructive checks shared by the web Lost & Found view and CLI doctor. */
export async function buildDiagnosticsReport(): Promise<DiagnosticsReport> {
  const projectsDirectory = getClaudeProjectsDirectory()
  const [projects, projectDirectoryNames, attentionMarkers, liveSessions] = await Promise.all([
    loadProjects(),
    listProjectDirectoryNames(projectsDirectory),
    readAttentionMarkers(),
    getLiveSessionRecords(),
  ])
  const projectsById = new Map(projects.map((project) => [project.id, project]))
  const hookHealth = await inspectAttentionHookHealth()
  const report: DiagnosticsReport = {
    brokenAttentionHook: null,
    brokenIndices: [],
    expiring: [],
    legacyProjectMemoryArtifacts: [],
    orphanedAttentionMarkers: [],
    orphanedTranscripts: [],
    pathMissing: [],
    staleLocks: [],
  }

  // Absence of a live process is the evidence here, never age: a marker for a
  // running session is legitimate however old it looks.
  const liveSessionIds = new Set(liveSessions.map((record) => record.sessionId))
  report.orphanedAttentionMarkers = attentionMarkers
    .filter((marker) => !liveSessionIds.has(marker.sessionId))
    .map((marker) => ({ occurredAt: marker.occurredAt, sessionId: marker.sessionId }))
    .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))

  if (hookHealth.state === 'broken') {
    report.brokenAttentionHook = {
      command: hookHealth.command,
      missingPath: hookHealth.missingPath,
    }
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
  const [indexResult, fileNames, ...lockInspections] = await Promise.all([
    inspectSessionIndex(projectDirectory, projectId),
    listFileNames(projectDirectory),
    inspectProjectSidecarLock(join(projectDirectory, PROJECT_SIDECAR_LOCK)),
    inspectProjectSidecarLock(join(projectDirectory, LEGACY_PROJECT_SIDECAR_LOCK)),
  ])

  if (indexResult.broken) report.brokenIndices.push(indexResult.broken)
  await collectLegacyProjectMemoryArtifacts(projectDirectory, projectId, fileNames, project, report)
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
  for (const [index, lockInspection] of lockInspections.entries()) {
    if (lockInspection.state === 'abandoned' || lockInspection.state === 'unknown') {
      report.staleLocks.push({
        path: join(
          projectDirectory,
          index === 0 ? PROJECT_SIDECAR_LOCK : LEGACY_PROJECT_SIDECAR_LOCK
        ),
        projectId,
        reason: lockInspection.reason,
      })
    }
  }
}

async function collectLegacyProjectMemoryArtifacts(
  projectDirectory: string,
  projectId: string,
  fileNames: string[],
  project: Project | undefined,
  report: DiagnosticsReport
): Promise<void> {
  const memoryPaths = new Set<string>()
  for (const marker of [PROJECT_MEMORY_LINK_FILE, LEGACY_PROJECT_MEMORY_LINK_FILE]) {
    if (!fileNames.includes(marker)) continue
    const markerPath = join(projectDirectory, marker)
    report.legacyProjectMemoryArtifacts.push({
      kind: 'link-marker',
      path: markerPath,
      projectId,
    })
    const markerTarget = await readOptionalText(markerPath)
    if (markerTarget) {
      if (markerTarget.replace(/[\\/]+$/, '').endsWith(PROJECT_MEMORY_DIRECTORY)) {
        memoryPaths.add(markerTarget)
      }
      memoryPaths.add(join(markerTarget, PROJECT_MEMORY_DIRECTORY))
    }
  }

  const projectPath = project?.path ?? (await resolveProjectPath(projectId))
  memoryPaths.add(join(projectPath, PROJECT_MEMORY_DIRECTORY))

  for (const memoryPath of memoryPaths) {
    if (!(await pathExists(memoryPath))) continue
    report.legacyProjectMemoryArtifacts.push({
      kind: 'project-memory-directory',
      path: memoryPath,
      projectId,
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

const PROJECT_SIDECAR_LOCK = 'reup.json.lock'
const LEGACY_PROJECT_SIDECAR_LOCK = `${'swo'}${'op'}.json.lock`
const PROJECT_MEMORY_DIRECTORY = '.claude-memory'
const PROJECT_MEMORY_LINK_FILE = '.reup-link'
const LEGACY_PROJECT_MEMORY_LINK_FILE = `.${'swo'}${'op'}-link`

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

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function readOptionalText(path: string): Promise<string | null> {
  try {
    const value = (await readFile(path, 'utf8')).trim()
    return value.length > 0 ? value : null
  } catch {
    return null
  }
}

function sortDiagnosticsReport(report: DiagnosticsReport): void {
  report.brokenIndices.sort((left, right) => left.projectId.localeCompare(right.projectId))
  report.expiring.sort((left, right) => left.updated.localeCompare(right.updated))
  report.legacyProjectMemoryArtifacts.sort((left, right) => left.path.localeCompare(right.path))
  report.orphanedTranscripts.sort((left, right) => left.sessionId.localeCompare(right.sessionId))
  report.pathMissing.sort((left, right) => right.updated.localeCompare(left.updated))
  report.staleLocks.sort((left, right) => left.projectId.localeCompare(right.projectId))
}
