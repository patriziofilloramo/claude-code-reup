import { execFile } from 'node:child_process'
import { access, lstat, readdir, readFile, readlink } from 'node:fs/promises'
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
import { syncRegistry } from './sync-registry.js'

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
    .filter(
      (project): project is Project =>
        project !== null && (project.sessions.length > 0 || project.cloudOffline === true)
    )
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
    const { isShared, cloudPath, cloudOffline } = await readLinkState(projectDirectory)
    const unlinkedDevices = isShared && cloudPath
      ? await readUnlinkedDevices(cloudPath)
      : undefined

    // Detect offline cloud storage before attempting to read sessions.
    // An inaccessible junction target means the drive is unmounted; surfacing
    // the project with cloudOffline=true lets the UI warn the user rather
    // than silently hiding the project.
    if (isShared && !(await isAccessible(projectDirectory))) {
      return { id: directoryName, isShared: true, cloudOffline: true, path: decodedProjectPath, sessions: [] }
    }

    const sessions =
      (await loadIndexedSessions(projectDirectory)) ??
      (await loadTranscriptSessions(projectDirectory, decodedProjectPath))
    const sessionsWithPathStatus = await annotatePathExistence(sessions)
    const sessionsWithCurrentBranches = await annotateCurrentGitBranches(sessionsWithPathStatus)
    const canonicalProjectPath = sessionsWithCurrentBranches[0]?.projectPath ?? decodedProjectPath

    return mergeProjectSidecarMetadata(projectDirectory, {
      id: directoryName,
      isShared,
      cloudPath,
      cloudOffline,
      unlinkedDevices,
      path: canonicalProjectPath,
      sessions: sessionsWithCurrentBranches,
    })
  } catch {
    // One unreadable or malformed project must not hide the remaining projects.
    return null
  }
}

/**
 * Returns the link state for a project directory.
 *
 * Priority:
 *   1. syncRegistry (populated by initCloudSync): authoritative after startup,
 *      covers the offline case where the junction is temporarily replaced by a
 *      real local directory.
 *   2. NTFS junction / symlink detection via lstat: pre-startup state and
 *      fresh installs.
 *   3. Legacy .ccm-link file: projects not yet migrated to junction model.
 */
async function readLinkState(
  projectDirectory: string
): Promise<{ isShared: boolean; cloudPath?: string; cloudOffline?: boolean }> {
  // 1. Registry — always wins when populated (ccm is running)
  const regEntry = syncRegistry.get(projectDirectory)
  if (regEntry) {
    return {
      isShared: true,
      cloudPath: regEntry.cloudDir,
      cloudOffline: !regEntry.isOnline,
    }
  }

  // 2. Junction / symlink
  try {
    const fileStat = await lstat(projectDirectory)
    if (fileStat.isSymbolicLink()) {
      let cloudPath = await readlink(projectDirectory)
      if (cloudPath.startsWith('\\\\?\\')) cloudPath = cloudPath.slice(4)
      return { isShared: true, cloudPath }
    }
  } catch { /* not a junction */ }

  // 3. Legacy .ccm-link (will be migrated to junction on next initCloudSync)
  try {
    const cloudPath = (await readFile(join(projectDirectory, APP.cloudLinkFile), 'utf8')).trim()
    if (cloudPath) return { isShared: true, cloudPath }
  } catch { /* no marker file */ }

  return { isShared: false }
}

/**
 * Reads device names from {cloudDir}/device-presence/.
 * Files are written by unlinked devices following CLAUDE.md instructions.
 * Returns undefined (not an empty array) when the directory is absent or empty.
 */
async function readUnlinkedDevices(cloudDir: string): Promise<string[] | undefined> {
  try {
    const entries = await readdir(join(cloudDir, 'device-presence'))
    const devices = entries
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -5))
    return devices.length > 0 ? devices : undefined
  } catch {
    return undefined
  }
}

/**
 * Returns true when a path is accessible (following junctions/symlinks).
 * Used to detect offline cloud drives whose junction target can't be reached.
 */
async function isAccessible(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
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
