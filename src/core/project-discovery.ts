import { execFile } from 'node:child_process'
import { access, lstat, readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { APP } from '../config/app.js'
import { log } from '../utils/logger.js'
import { getClaudeProjectsDirectory, resolveProjectPath } from './claude-paths.js'
import { getCachedProjects, setCachedProjects } from './project-cache.js'
import type { Project, Session, SessionContextMetrics, SessionSignals } from './session-model.js'
import { isValidSessionId } from './session-model.js'
import { mergeProjectSidecarMetadata } from './session-metadata.js'
import { calculateExpiryDays } from './session-signals.js'
import { parseSessionTranscript } from './session-transcript.js'

const execFileAsync = promisify(execFile)

const SESSION_TRANSCRIPT_FILE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i

// -----------------------------------------------------------------------------
// Public discovery API
// -----------------------------------------------------------------------------

/** Loads every project containing sessions, newest project activity first. */
export async function loadProjects(): Promise<Project[]> {
  const projectsDirectory = getClaudeProjectsDirectory()
  const cached = getCachedProjects(projectsDirectory)
  if (cached) return cached

  log.debug('loadProjects: scanning', projectsDirectory)

  const projectDirectoryNames = await listProjectDirectoryNames(projectsDirectory)
  const discoveredProjects = await Promise.all(
    projectDirectoryNames.map((directoryName) =>
      loadProjectDirectory(directoryName, projectsDirectory)
    )
  )

  const projects = discoveredProjects
    .filter((project): project is Project => project !== null && project.sessions.length > 0)
    .sort(compareProjectsByRecentActivity)

  setCachedProjects(projectsDirectory, projects)
  return projects
}

/** Resolves one project from the authoritative discovery result. */
export async function loadProjectById(projectId: string): Promise<Project | null> {
  const projects = await loadProjects()
  return projects.find((project) => project.id === projectId) ?? null
}

// -----------------------------------------------------------------------------
// Project loading
// -----------------------------------------------------------------------------

async function listProjectDirectoryNames(projectsDirectory: string): Promise<string[]> {
  try {
    const entries = await readdir(projectsDirectory, { withFileTypes: true })
    // Include both real directories and junctions/symlinks (shared storage).
    // On Windows, junctions report isDirectory()=true; on Unix, symlinks report isSymbolicLink()=true.
    return entries
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => entry.name)
  } catch {
    // A fresh Claude Code installation may not have created `projects/` yet.
    return []
  }
}

async function loadProjectDirectory(
  directoryName: string,
  projectsDirectory: string
): Promise<Project | null> {
  try {
    const projectDirectory = join(projectsDirectory, directoryName)
    const decodedProjectPath = await resolveProjectPath(directoryName)
    const sessions =
      (await loadIndexedSessions(projectDirectory)) ??
      (await loadTranscriptSessions(projectDirectory, decodedProjectPath))
    const sessionsWithPathStatus = await annotatePathExistence(sessions)
    const sessionsWithCurrentBranches = await annotateCurrentGitBranches(sessionsWithPathStatus)
    const canonicalProjectPath = sessionsWithCurrentBranches[0]?.projectPath ?? decodedProjectPath

    const { isShared, cloudPath } = await readLinkState(projectDirectory)
    const syncStale = cloudPath ? await checkSyncStale(projectDirectory, cloudPath) : undefined

    return mergeProjectSidecarMetadata(projectDirectory, {
      id: directoryName,
      isShared,
      cloudPath,
      syncStale,
      path: canonicalProjectPath,
      sessions: sessionsWithCurrentBranches,
    })
  } catch {
    // One unreadable or malformed project must not hide the remaining projects.
    return null
  }
}

/**
 * Compares a local project directory against its linked cloud directory.
 * Returns true if any file is present in one location but missing in the
 * other, or if a file differs in size (indicating the sync is behind).
 *
 * Checks one level of subdirectories (e.g. memory/) so cross-device memory
 * divergence is detected. Returns false when the cloud dir is unreachable.
 */
async function checkSyncStale(localDir: string, cloudDir: string): Promise<boolean> {
  let cloudEntries: string[]
  try {
    cloudEntries = await readdir(cloudDir)
  } catch {
    return false
  }

  const localEntries = await readdir(localDir).catch((): string[] => [])
  const localSet = new Set(localEntries)
  const cloudSet = new Set(cloudEntries)

  // Check top-level files (skip the .ccm-link marker — it is local-only)
  for (const name of [...localSet, ...cloudSet]) {
    if (name === APP.cloudLinkFile) continue
    const inLocal = localSet.has(name)
    const inCloud = cloudSet.has(name)
    if (inLocal !== inCloud) {
      const path = inLocal ? join(localDir, name) : join(cloudDir, name)
      const s = await stat(path).catch(() => null)
      if (s?.isFile()) return true
    }
  }

  // Recurse into shared subdirectories one level (covers memory/, etc.)
  for (const name of localSet) {
    if (!cloudSet.has(name)) continue
    const localSub = join(localDir, name)
    const cloudSub = join(cloudDir, name)
    const [lStat, cStat] = await Promise.all([
      stat(localSub).catch(() => null),
      stat(cloudSub).catch(() => null),
    ])
    if (!lStat?.isDirectory() || !cStat?.isDirectory()) continue

    const [localSubFiles, cloudSubFiles] = await Promise.all([
      readdir(localSub).catch((): string[] => []),
      readdir(cloudSub).catch((): string[] => []),
    ])
    if (localSubFiles.length !== cloudSubFiles.length) return true
    const cloudSubSet = new Set(cloudSubFiles)
    for (const f of localSubFiles) {
      if (!cloudSubSet.has(f)) return true
    }
  }

  return false
}

/**
 * Returns the link state for a project directory.
 * Prefers the .ccm-link file (new local-first model); falls back to detecting
 * legacy NTFS junctions / symlinks for projects not yet migrated.
 */
async function readLinkState(
  projectDirectory: string
): Promise<{ isShared: boolean; cloudPath?: string }> {
  try {
    const cloudPath = (await readFile(join(projectDirectory, APP.cloudLinkFile), 'utf8')).trim()
    if (cloudPath) return { isShared: true, cloudPath }
  } catch { /* no .ccm-link file — check for legacy junction */ }

  try {
    const isJunction = (await lstat(projectDirectory)).isSymbolicLink()
    return { isShared: isJunction }
  } catch {
    return { isShared: false }
  }
}

/**
 * Returns the current HEAD branch name for a git repository.
 * Returns undefined when the path is not a repo, git is unavailable, or HEAD
 * is detached (i.e. `git rev-parse` prints the literal string "HEAD").
 */
async function readCurrentGitBranch(projectPath: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: projectPath,
      timeout: 3_000,
    })
    const branch = stdout.trim()
    return branch === 'HEAD' ? undefined : branch
  } catch {
    return undefined
  }
}

function compareProjectsByRecentActivity(left: Project, right: Project): number {
  const leftUpdatedAt = left.sessions[0]?.updated ?? ''
  const rightUpdatedAt = right.sessions[0]?.updated ?? ''
  return rightUpdatedAt.localeCompare(leftUpdatedAt)
}

function compareSessionsByRecentActivity(left: Session, right: Session): number {
  return right.updated.localeCompare(left.updated)
}

// -----------------------------------------------------------------------------
// Session sources
// -----------------------------------------------------------------------------

/**
 * Uses Claude Code's metadata index without opening transcripts.
 *
 * Transcript-derived signals deliberately remain `null`: unknown data must not
 * be presented as a clean session merely because the fast path was used.
 */
async function loadIndexedSessions(projectDirectory: string): Promise<Session[] | null> {
  try {
    const indexContent = await readFile(join(projectDirectory, 'sessions-index.json'), 'utf8')
    const sessionIndex = JSON.parse(indexContent) as { sessions?: Session[] }
    if (!sessionIndex.sessions?.length) return null

    const resumableSessions = (
      await Promise.all(
        sessionIndex.sessions.map(async (session) =>
          (await indexedSessionHasTranscript(projectDirectory, session)) ? session : null
        )
      )
    ).filter((session): session is Session => session !== null)
    if (resumableSessions.length === 0) return null

    return resumableSessions
      .map((session) => ({
        ...session,
        context: createUnanalysedContextMetrics(),
        signals: createUnanalysedSignals(session.updated),
      }))
      .sort(compareSessionsByRecentActivity)
  } catch {
    // Missing or malformed indices fall back to authoritative JSONL transcripts.
    return null
  }
}

async function indexedSessionHasTranscript(
  projectDirectory: string,
  session: Session
): Promise<boolean> {
  if (!isValidSessionId(session.id) || session.messageCount === 0) return false
  try {
    await access(join(projectDirectory, `${session.id}.jsonl`))
    return true
  } catch {
    return false
  }
}

function createUnanalysedContextMetrics(): SessionContextMetrics {
  return {
    latestContextTokens: null,
    latestModel: null,
    latestOutputTokens: null,
    models: null,
  }
}

function createUnanalysedSignals(updatedAt: string): SessionSignals {
  return {
    analysisComplete: false,
    archived: false,
    compactionCount: null,
    expiresInDays: calculateExpiryDays(updatedAt),
    interrupted: null,
    lastToolFailed: null,
    pathExists: true,
  }
}

async function loadTranscriptSessions(
  projectDirectory: string,
  decodedProjectPath: string
): Promise<Session[]> {
  let projectFileNames: string[]
  try {
    projectFileNames = await readdir(projectDirectory)
  } catch {
    return []
  }

  const parsedSessions = await Promise.all(
    projectFileNames
      .filter((fileName) => SESSION_TRANSCRIPT_FILE_PATTERN.test(fileName))
      .map((fileName) =>
        parseSessionTranscript(join(projectDirectory, fileName), decodedProjectPath)
      )
  )

  return parsedSessions
    .filter((session): session is Session => session !== null)
    .sort(compareSessionsByRecentActivity)
}

// -----------------------------------------------------------------------------
// Filesystem annotations
// -----------------------------------------------------------------------------

/** Checks each unique recorded working directory once, then annotates sessions. */
async function annotatePathExistence(sessions: Session[]): Promise<Session[]> {
  const uniqueProjectPaths = [...new Set(sessions.map((session) => session.projectPath))]
  const pathExistence = new Map(
    await Promise.all(
      uniqueProjectPaths.map(async (projectPath) => {
        try {
          await access(projectPath)
          return [projectPath, true] as const
        } catch {
          return [projectPath, false] as const
        }
      })
    )
  )

  return sessions.map((session) => ({
    ...session,
    signals: {
      ...session.signals,
      pathExists: pathExistence.get(session.projectPath) ?? false,
    },
  }))
}

/**
 * Resolves each unique session working directory once, then attaches its
 * current branch to the sessions that actually use that path.
 */
async function annotateCurrentGitBranches(sessions: Session[]): Promise<Session[]> {
  const uniqueProjectPaths = [...new Set(sessions.map((session) => session.projectPath))]
  const currentBranches = new Map(
    await Promise.all(
      uniqueProjectPaths.map(async (projectPath) => {
        const currentBranch = await readCurrentGitBranch(projectPath)
        return [projectPath, currentBranch] as const
      })
    )
  )

  return sessions.map((session) => {
    const currentBranch = currentBranches.get(session.projectPath)
    return currentBranch ? { ...session, currentBranch } : session
  })
}
