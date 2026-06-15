import { readFile, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { getActiveSessions } from './active-sessions.js'
import { getProjectDirectory } from './claude-paths.js'
import { invalidateProjectCache } from './project-cache.js'
import type { Project } from './session-model.js'
import { withProjectSidecarLock } from './project-sidecar-lock.js'

interface SessionSidecarMetadata {
  alias?: string
  archived?: boolean
}

interface ProjectSidecarMetadata {
  sessions?: Record<string, SessionSidecarMetadata>
}

export class ActiveSessionDeletionError extends Error {
  constructor(sessionId: string) {
    super(`cannot delete active session: ${sessionId}`)
    this.name = 'ActiveSessionDeletionError'
  }
}

/**
 * Serialises writes originating inside this process. The filesystem lock used
 * inside each queued operation coordinates independent CCM processes.
 */
const projectWriteQueues = new Map<string, Promise<void>>()

// -----------------------------------------------------------------------------
// Sidecar persistence
// -----------------------------------------------------------------------------

async function readProjectSidecar(projectDirectory: string): Promise<ProjectSidecarMetadata> {
  try {
    const sidecarPath = join(projectDirectory, 'ccm.json')
    return JSON.parse(await readFile(sidecarPath, 'utf8')) as ProjectSidecarMetadata
  } catch {
    // A missing or malformed sidecar is equivalent to having no CCM metadata.
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
  const sidecarPath = join(projectDirectory, 'ccm.json')
  // PID-qualified temp paths prevent independent CCM processes from writing
  // the same temporary file before either reaches the atomic rename.
  const temporarySidecarPath = `${sidecarPath}.${process.pid}.tmp`

  try {
    await writeFile(temporarySidecarPath, JSON.stringify(metadata, null, 2), 'utf8')
    await rename(temporarySidecarPath, sidecarPath)
  } finally {
    // `rename` removes the temp path on success. Cleanup matters only after an
    // interrupted or failed write.
    await unlink(temporarySidecarPath).catch(() => {})
  }
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

/** Merges CCM-owned aliases and archive state into a discovered project. */
export async function mergeProjectSidecarMetadata(
  projectDirectory: string,
  project: Project
): Promise<Project> {
  const sidecarMetadata = await readProjectSidecar(projectDirectory)
  if (!sidecarMetadata.sessions) return project

  return {
    ...project,
    sessions: project.sessions.map((session) => {
      const sessionMetadata = sidecarMetadata.sessions?.[session.id]
      if (!sessionMetadata) return session

      return {
        ...session,
        alias: sessionMetadata.alias || session.alias,
        signals: {
          ...session.signals,
          archived: sessionMetadata.archived ?? session.signals.archived,
        },
      }
    }),
  }
}

/** Sets or clears the CCM-only display alias for a session. */
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
 * Permanently deletes a session transcript and removes it from the CCM sidecar.
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

  // Remove the sidecar entry to avoid orphaned metadata
  await enqueueProjectSidecarUpdate(projectDirectory, (metadata) => {
    if (metadata.sessions) delete metadata.sessions[sessionId]
  })

  invalidateProjectCache()
}

/** Updates whether CCM hides the session; Claude-owned data is never modified. */
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
