import { randomUUID } from 'node:crypto'
import { readFile, rename, rm, unlink, writeFile } from 'node:fs/promises'
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
 * Serialises writes originating inside this process. The filesystem lock used
 * inside each queued operation coordinates independent Swoop processes.
 */
const projectWriteQueues = new Map<string, Promise<void>>()

// -----------------------------------------------------------------------------
// Sidecar persistence
// -----------------------------------------------------------------------------

async function readProjectSidecar(projectDirectory: string): Promise<ProjectSidecarMetadata> {
  try {
    const sidecarPath = join(projectDirectory, 'swoop.json')
    return JSON.parse(await readFile(sidecarPath, 'utf8')) as ProjectSidecarMetadata
  } catch {
    // A missing or malformed sidecar is equivalent to having no Swoop metadata.
    return {}
  }
}

async function enqueueProjectSidecarUpdate(
  projectDirectory: string,
  updateMetadata: (metadata: ProjectSidecarMetadata) => void
): Promise<void> {
  const previousUpdate = projectWriteQueues.get(projectDirectory) ?? Promise.resolve()
  const queuedUpdate = previousUpdate.then(() =>
    withProjectSidecarLock(projectDirectory, async () => {
      const sidecarMetadata = await readProjectSidecar(projectDirectory)
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
  const sidecarPath = join(projectDirectory, 'swoop.json')
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
      // reader has the destination open. The advisory lock prevents Swoop writers
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

/** Merges Swoop-owned aliases, archive state, and tags into a discovered project. */
export async function mergeProjectSidecarMetadata(
  projectDirectory: string,
  project: Project
): Promise<Project> {
  const sidecarMetadata = await readProjectSidecar(projectDirectory)

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

/** Sets or clears the Swoop-only display alias for a session. */
export async function setSessionAlias(
  projectId: string,
  sessionId: string,
  alias: string | undefined
): Promise<void> {
  await enqueueProjectSidecarUpdate(getProjectDirectory(projectId), (metadata) => {
    const sessionMetadata = sessionMetadataEntry(metadata, sessionId)
    if (alias) sessionMetadata.alias = alias
    else delete sessionMetadata.alias
  })
  invalidateProjectCache()
}

/**
 * Permanently deletes a session transcript and removes it from the Swoop sidecar.
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
 * Replaces the project-level tag list stored in swoop.json.
 * Tags must already be normalized and validated by the caller.
 */
export async function setProjectTags(projectId: string, normalizedTags: string[]): Promise<void> {
  await enqueueProjectSidecarUpdate(getProjectDirectory(projectId), (metadata) => {
    if (normalizedTags.length > 0) metadata.projectTags = normalizedTags
    else delete metadata.projectTags
  })
  invalidateProjectCache()
}

/** Updates whether Swoop hides the session; Claude-owned data is never modified. */
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
