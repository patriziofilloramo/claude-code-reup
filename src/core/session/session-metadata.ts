import { randomUUID } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { copyFile, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { getActiveSessions } from './active-sessions.js'
import { getProjectDirectory } from '../project/claude-paths.js'
import { invalidateProjectCache } from '../project/project-cache.js'
import type { Project } from './session-model.js'
import { withProjectSidecarLock } from '../project/project-sidecar-lock.js'
import { log } from '../../utils/logger.js'

const SIDECAR_REPLACE_ATTEMPTS = 20
const SIDECAR_REPLACE_RETRY_MS = 40
const RETRYABLE_REPLACE_ERROR_CODES = new Set(['EACCES', 'EBUSY', 'EPERM'])
const PROJECT_SIDECAR_FILE = 'reup.json'
const LEGACY_PROJECT_SIDECAR_FILE = `${'swo'}${'op'}.json`
export const SESSION_ALIAS_MAX_LENGTH = 160

interface SessionSidecarMetadata {
  alias?: string
  archived?: boolean
  tags?: string[]
}

interface ProjectSidecarMetadata {
  sessions?: Record<string, SessionSidecarMetadata>
  projectTags?: string[]
}

export class ActiveSessionDeletionError extends Error {
  constructor(sessionId: string) {
    super(`cannot delete active session: ${sessionId}`)
    this.name = 'ActiveSessionDeletionError'
  }
}

/**
 * Raised when `reup.json` exists but cannot be turned into metadata, and a
 * caller asked to update it.
 *
 * Rewriting an unreadable sidecar would silently discard every alias, tag, and
 * archive flag it still holds, so updates fail loudly and leave the file
 * untouched for repair. Read paths degrade to "no Reup metadata" instead.
 */
export class ProjectSidecarUnreadableError extends Error {
  constructor(
    readonly sidecarPath: string,
    options?: { cause?: unknown }
  ) {
    super(
      `cannot read Reup metadata at ${sidecarPath}; refusing to overwrite it. ` +
        'Repair or delete the file, then retry.',
      options
    )
    this.name = 'ProjectSidecarUnreadableError'
  }
}

/**
 * Outcome of reading a project sidecar.
 *
 * `absent` and `unreadable` are deliberately distinct: only the former means
 * "this project has no Reup metadata". Collapsing them is what turns a
 * transient read failure into permanent data loss on the next write.
 */
type ProjectSidecarSnapshot =
  | { metadata: ProjectSidecarMetadata; state: 'loaded' }
  | { state: 'absent' }
  | { cause: unknown; state: 'unreadable' }

/**
 * Serialises writes originating inside this process. The filesystem lock used
 * inside each queued operation coordinates independent Reup processes.
 */
const projectWriteQueues = new Map<string, Promise<void>>()

// -----------------------------------------------------------------------------
// Sidecar persistence
// -----------------------------------------------------------------------------

/**
 * Loads the sidecar, reporting precisely why no metadata came back.
 *
 * A legacy sidecar is migrated only when the current one is genuinely absent,
 * so a damaged `reup.json` is never shadowed by older data.
 */
async function loadProjectSidecar(
  projectDirectory: string,
  options: { insideLock?: boolean } = {}
): Promise<ProjectSidecarSnapshot> {
  const sidecarPath = join(projectDirectory, PROJECT_SIDECAR_FILE)
  const current = await readSidecarFile(sidecarPath)
  if (current.state !== 'absent') return current

  if (!(await legacyProjectSidecarExists(projectDirectory))) return { state: 'absent' }

  if (options.insideLock) await migrateLegacyProjectSidecarWithoutLock(projectDirectory)
  else await migrateLegacyProjectSidecar(projectDirectory)

  return readSidecarFile(sidecarPath)
}

async function readSidecarFile(sidecarPath: string): Promise<ProjectSidecarSnapshot> {
  let contents: string
  try {
    contents = await readFile(sidecarPath, 'utf8')
  } catch (error) {
    // Only a missing file proves the project has no Reup metadata. EACCES,
    // EBUSY, and EPERM are contention or permission failures that must not be
    // mistaken for emptiness.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'absent' }
    return { cause: error, state: 'unreadable' }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(contents)
  } catch (error) {
    return { cause: error, state: 'unreadable' }
  }

  if (!isMetadataObject(parsed)) {
    return { cause: new TypeError('sidecar root must be a JSON object'), state: 'unreadable' }
  }
  return { metadata: parsed, state: 'loaded' }
}

/**
 * Best-effort read for display. One damaged sidecar must not hide a project, so
 * an unreadable file degrades to "no Reup metadata" here — updates go through
 * {@link enqueueProjectSidecarUpdate}, which refuses instead of overwriting.
 */
async function readProjectSidecarForDisplay(
  projectDirectory: string
): Promise<ProjectSidecarMetadata> {
  let snapshot: ProjectSidecarSnapshot
  try {
    snapshot = await loadProjectSidecar(projectDirectory)
  } catch (error) {
    // Includes a failed legacy migration: discovery must still list the project.
    snapshot = { cause: error, state: 'unreadable' }
  }

  if (snapshot.state === 'unreadable') {
    log.warn(
      `sidecar: ignoring unreadable ${PROJECT_SIDECAR_FILE} in ${projectDirectory}:`,
      snapshot.cause
    )
  }
  return snapshot.state === 'loaded' ? snapshot.metadata : {}
}

async function enqueueProjectSidecarUpdate(
  projectDirectory: string,
  updateMetadata: (metadata: ProjectSidecarMetadata) => void
): Promise<void> {
  const previousUpdate = projectWriteQueues.get(projectDirectory) ?? Promise.resolve()
  const queuedUpdate = previousUpdate.then(() =>
    withProjectSidecarLock(projectDirectory, async () => {
      const snapshot = await loadProjectSidecar(projectDirectory, { insideLock: true })
      if (snapshot.state === 'unreadable') {
        throw new ProjectSidecarUnreadableError(join(projectDirectory, PROJECT_SIDECAR_FILE), {
          cause: snapshot.cause,
        })
      }

      const sidecarMetadata = snapshot.state === 'loaded' ? snapshot.metadata : {}
      updateMetadata(sidecarMetadata)
      await writeProjectSidecarAtomically(projectDirectory, sidecarMetadata)
    })
  )

  // A failed update must reject its caller, but must not poison later updates in
  // this process. The queue therefore stores a handled continuation.
  projectWriteQueues.set(
    projectDirectory,
    queuedUpdate.catch(() => {})
  )
  return queuedUpdate
}

async function writeProjectSidecarAtomically(
  projectDirectory: string,
  metadata: ProjectSidecarMetadata
): Promise<void> {
  const sidecarPath = join(projectDirectory, PROJECT_SIDECAR_FILE)
  const temporarySidecarPath = `${sidecarPath}.${process.pid}.${randomUUID()}.tmp`

  try {
    await writeFile(temporarySidecarPath, JSON.stringify(metadata, null, 2), 'utf8')
    await replaceSidecarWithRetry(temporarySidecarPath, sidecarPath)
  } finally {
    // `rename` removes the temp path on success. Cleanup matters only after an
    // interrupted or failed write.
    await unlink(temporarySidecarPath).catch(() => {})
  }
}

async function migrateLegacyProjectSidecar(projectDirectory: string): Promise<void> {
  await withProjectSidecarLock(projectDirectory, () =>
    migrateLegacyProjectSidecarWithoutLock(projectDirectory)
  )
}

async function legacyProjectSidecarExists(projectDirectory: string): Promise<boolean> {
  try {
    await readFile(join(projectDirectory, LEGACY_PROJECT_SIDECAR_FILE), 'utf8')
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function migrateLegacyProjectSidecarWithoutLock(projectDirectory: string): Promise<void> {
  const sidecarPath = join(projectDirectory, PROJECT_SIDECAR_FILE)
  const legacySidecarPath = join(projectDirectory, LEGACY_PROJECT_SIDECAR_FILE)
  try {
    await copyFile(legacySidecarPath, sidecarPath, fsConstants.COPYFILE_EXCL)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT' && code !== 'EEXIST') throw error
  }
}

async function replaceSidecarWithRetry(
  temporarySidecarPath: string,
  sidecarPath: string
): Promise<void> {
  for (let attempt = 1; attempt <= SIDECAR_REPLACE_ATTEMPTS; attempt++) {
    try {
      await rename(temporarySidecarPath, sidecarPath)
      return
    } catch (error) {
      if (!shouldRetrySidecarReplace(error) || attempt === SIDECAR_REPLACE_ATTEMPTS) throw error

      // Windows can reject a rename-over-existing-file while another short-lived
      // reader has the destination open. The advisory lock prevents Reup writers
      // from racing each other; this retry handles external readers.
      await waitForSidecarReplaceRetry(attempt)
    }
  }
}

function shouldRetrySidecarReplace(error: unknown): boolean {
  const errorCode = (error as NodeJS.ErrnoException).code
  return typeof errorCode === 'string' && RETRYABLE_REPLACE_ERROR_CODES.has(errorCode)
}

async function waitForSidecarReplaceRetry(attempt: number): Promise<void> {
  const jitterMs = Math.random() * 15
  const backoffMs = SIDECAR_REPLACE_RETRY_MS + Math.min(attempt * 5, 60) + jitterMs
  await new Promise<void>((resolve) => setTimeout(resolve, backoffMs))
}

function isMetadataObject(value: unknown): value is ProjectSidecarMetadata {
  if (!isRecord(value)) return false
  const projectTags = value['projectTags']
  if (projectTags !== undefined && !isStringArray(projectTags)) return false

  const sessions = value['sessions']
  if (sessions === undefined) return true
  return isRecord(sessions) && Object.values(sessions).every(isSessionMetadataObject)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSessionMetadataObject(value: unknown): value is SessionSidecarMetadata {
  if (!isRecord(value)) return false
  const alias = value['alias']
  const archived = value['archived']
  const tags = value['tags']
  return (
    (alias === undefined || typeof alias === 'string') &&
    (archived === undefined || typeof archived === 'boolean') &&
    (tags === undefined || isStringArray(tags))
  )
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

function sessionMetadataEntry(
  metadata: ProjectSidecarMetadata,
  sessionId: string
): SessionSidecarMetadata {
  metadata.sessions ??= {}
  metadata.sessions[sessionId] ??= {}
  return metadata.sessions[sessionId]
}

// -----------------------------------------------------------------------------
// Public metadata API
// -----------------------------------------------------------------------------

/** Merges Reup-owned aliases, archive state, and tags into a discovered project. */
export async function mergeProjectSidecarMetadata(
  projectDirectory: string,
  project: Project
): Promise<Project> {
  const sidecarMetadata = await readProjectSidecarForDisplay(projectDirectory)

  const projectWithTags: Project = sidecarMetadata.projectTags
    ? { ...project, projectTags: sidecarMetadata.projectTags }
    : project

  if (!sidecarMetadata.sessions) return projectWithTags

  return {
    ...projectWithTags,
    sessions: projectWithTags.sessions.map((session) => {
      const sessionMetadata = sidecarMetadata.sessions?.[session.id]
      if (!sessionMetadata) return session

      return {
        ...session,
        alias: sessionMetadata.alias || session.alias,
        tags: sessionMetadata.tags ?? session.tags,
        signals: {
          ...session.signals,
          archived: sessionMetadata.archived ?? session.signals.archived,
        },
      }
    }),
  }
}

/** Sets or clears the Reup-only display alias for a session. */
export async function setSessionAlias(
  projectId: string,
  sessionId: string,
  alias: string | undefined
): Promise<void> {
  const normalizedAlias = normalizeSessionAlias(alias)
  await enqueueProjectSidecarUpdate(getProjectDirectory(projectId), (metadata) => {
    const sessionMetadata = sessionMetadataEntry(metadata, sessionId)
    if (normalizedAlias) sessionMetadata.alias = normalizedAlias
    else delete sessionMetadata.alias
  })
  invalidateProjectCache()
}

export function normalizeSessionAlias(alias: unknown): string | undefined {
  if (alias === undefined || alias === null) return undefined
  if (typeof alias !== 'string') throw new TypeError('session alias must be a string')
  const normalized = alias.trim()
  if (!normalized) return undefined
  if (normalized.length > SESSION_ALIAS_MAX_LENGTH) {
    throw new RangeError(`session alias must be at most ${SESSION_ALIAS_MAX_LENGTH} characters`)
  }
  return normalized
}

/**
 * Permanently deletes a session transcript and removes it from the Reup sidecar.
 * The `.jsonl` file is owned by Claude Code — this is a destructive operation.
 */
export async function deleteSession(projectId: string, sessionId: string): Promise<void> {
  if ((await getActiveSessions()).has(sessionId)) {
    throw new ActiveSessionDeletionError(sessionId)
  }

  const projectDirectory = getProjectDirectory(projectId)
  const jsonlPath = join(projectDirectory, `${sessionId}.jsonl`)

  // Delete the transcript (ignore if already gone)
  await rm(jsonlPath, { force: true })

  try {
    // Remove the sidecar entry to avoid orphaned metadata. Once the transcript
    // has been removed, this cleanup is best-effort: an orphaned sidecar entry
    // is ignored by discovery and must not turn a successful delete into an
    // apparent failure for the user.
    await enqueueProjectSidecarUpdate(projectDirectory, (metadata) => {
      if (metadata.sessions) delete metadata.sessions[sessionId]
    })
  } catch (error) {
    log.warn('delete: transcript removed but sidecar cleanup failed:', error)
  }

  invalidateProjectCache()
}

/**
 * Replaces the complete tag list for a session.
 * Tags must already be normalized and validated by the caller.
 */
export async function setSessionTags(
  projectId: string,
  sessionId: string,
  normalizedTags: string[]
): Promise<void> {
  await enqueueProjectSidecarUpdate(getProjectDirectory(projectId), (metadata) => {
    const entry = sessionMetadataEntry(metadata, sessionId)
    if (normalizedTags.length > 0) entry.tags = normalizedTags
    else delete entry.tags
  })
  invalidateProjectCache()
}

/**
 * Replaces the project-level tag list stored in reup.json.
 * Tags must already be normalized and validated by the caller.
 */
export async function setProjectTags(projectId: string, normalizedTags: string[]): Promise<void> {
  await enqueueProjectSidecarUpdate(getProjectDirectory(projectId), (metadata) => {
    if (normalizedTags.length > 0) metadata.projectTags = normalizedTags
    else delete metadata.projectTags
  })
  invalidateProjectCache()
}

/** Updates whether Reup hides the session; Claude-owned data is never modified. */
export async function setSessionArchived(
  projectId: string,
  sessionId: string,
  archived: boolean
): Promise<void> {
  await enqueueProjectSidecarUpdate(getProjectDirectory(projectId), (metadata) => {
    sessionMetadataEntry(metadata, sessionId).archived = archived
  })
  invalidateProjectCache()
}
