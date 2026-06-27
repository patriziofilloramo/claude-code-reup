import { execFile } from 'node:child_process'
import { access, lstat, readdir, readFile, readlink } from 'node:fs/promises'
import { dirname, isAbsolute, join, normalize, resolve } from 'node:path'
import { promisify } from 'node:util'

import { APP } from '../../config/app.js'
import { log } from '../../utils/logger.js'
import {
  encodeProjectPath,
  getClaudeProjectsDirectory,
  resolveProjectPath,
} from './claude-paths.js'
import { normalizePathForComparison, pathsReferToSameLocation } from './path-comparison.js'
import { getCachedProjects, setCachedProjects } from './project-cache.js'
import { getLiveSessionRecords, type SessionLockRecord } from '../session/active-sessions.js'
import type {
  Project,
  Session,
  SessionContextMetrics,
  SessionSignals,
} from '../session/session-model.js'
import { isValidSessionId } from '../session/session-model.js'
import { mergeProjectSidecarMetadata } from '../session/session-metadata.js'
import { calculateExpiryDays } from '../session/session-signals.js'
import { parseSessionTranscript } from '../session/session-transcript.js'
import { syncRegistry } from '../sync/sync-registry.js'
import { readUserPrefsSync } from '../user-prefs.js'
import { readOrgData } from '../org/org-prefs.js'
import { applyOrgMetadata } from '../org/org-filters.js'

const execFileAsync = promisify(execFile)

const SESSION_TRANSCRIPT_FILE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i

/**
 * Lock-only sessions are valid during Claude Code's startup/first-flush window.
 * After that, a missing transcript is not a resumable Swoop session; the live
 * panel may still surface the process, but project/session discovery should not.
 */
const LOCK_FILE_GRACE_PERIOD_MS = 2 * 60 * 1000

// -----------------------------------------------------------------------------
// Public discovery API
// -----------------------------------------------------------------------------

/** Loads every project containing sessions, newest project activity first. */
export async function loadProjects(): Promise<Project[]> {
  const projectsDirectory = getClaudeProjectsDirectory()
  const prefs = readUserPrefsSync()
  const syncEnabled = APP.enableProjectMemorySync && prefs.crossDeviceSessionStorage === 'on'
  const cacheKey = `${projectsDirectory}\0sync:${syncEnabled ? 'on' : 'off'}`
  const cached = getCachedProjects(cacheKey)
  if (cached) return cached

  log.debug('loadProjects: scanning', projectsDirectory)

  const [projectDirectoryNames, liveSessions, orgData] = await Promise.all([
    listProjectDirectoryNames(projectsDirectory),
    getLiveSessionRecords(),
    readOrgData(),
  ])

  const discoveredProjects = await Promise.all(
    projectDirectoryNames.map((directoryName) =>
      loadProjectDirectory(directoryName, projectsDirectory, liveSessions, syncEnabled)
    )
  )

  const projects = discoveredProjects
    .filter(
      (project): project is Project =>
        project !== null &&
        (project.sessions.length > 0 || project.cloudOffline === true || project.isShared)
    )
    .sort(compareProjectsByRecentActivity)

  // Handle very fresh lock records whose cwd doesn't match any scanned project.
  // Older lock-only records are live processes, not necessarily resumable sessions.
  const now = Date.now()
  const knownPaths = new Set(projects.map((project) => normalizePathForComparison(project.path)))
  const orphanedRecords = liveSessions.filter(
    (record): record is SessionLockRecord & { cwd: string } =>
      record.cwd !== null &&
      !knownPaths.has(normalizePathForComparison(record.cwd)) &&
      isRecentLockRecord(record.startedAt, now)
  )

  const assembled =
    orphanedRecords.length === 0
      ? projects
      : [...projects, ...buildOrphanProjects(orphanedRecords)].sort(compareProjectsByRecentActivity)

  // Merge group assignments from org.json into project objects.
  const finalProjects = applyOrgMetadata(assembled, orgData)

  setCachedProjects(cacheKey, finalProjects)
  return finalProjects
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
  projectsDirectory: string,
  liveSessions: SessionLockRecord[],
  syncEnabled: boolean
): Promise<Project | null> {
  try {
    const projectDirectory = join(projectsDirectory, directoryName)
    const decodedProjectPath = await resolveProjectPath(directoryName)
    const linkState = await readLinkState(projectDirectory)
    const fallbackProjectPath =
      resolveLinkedProjectPath(projectDirectory, linkState.cloudPath) ?? decodedProjectPath

    // Detect offline cloud storage before attempting to read sessions.
    // An inaccessible junction target means the drive is unmounted; surfacing
    // the project with cloudOffline=true lets the UI warn the user rather
    // than silently hiding the project.
    if (linkState.isShared && !(await isAccessible(projectDirectory))) {
      return {
        id: directoryName,
        isShared: true,
        cloudOffline: true,
        path: fallbackProjectPath,
        sessions: [],
      }
    }

    const sessions =
      (await loadIndexedSessions(projectDirectory)) ??
      (await loadTranscriptSessions(projectDirectory, fallbackProjectPath))

    const sessionsWithGhosts = await addGhostSessions(
      sessions,
      projectDirectory,
      fallbackProjectPath,
      liveSessions
    )
    const sessionsWithPathStatus = await annotatePathExistence(sessionsWithGhosts)
    const sessionsWithCurrentBranches = await annotateCurrentGitBranches(sessionsWithPathStatus)
    const canonicalProjectPath = sessionsWithCurrentBranches[0]?.projectPath ?? fallbackProjectPath
    const sharedMemoryState = syncEnabled
      ? await readProjectMemoryState(canonicalProjectPath, linkState.cloudPath)
      : null

    return mergeProjectSidecarMetadata(projectDirectory, {
      id: directoryName,
      isShared: linkState.isShared,
      cloudPath: linkState.cloudPath ?? sharedMemoryState?.cloudPath,
      cloudOffline: linkState.cloudOffline,
      linkedDevices: sharedMemoryState?.linkedDevices,
      unlinkedDevices: sharedMemoryState?.unlinkedDevices,
      path: canonicalProjectPath,
      sessions: sessionsWithCurrentBranches,
    })
  } catch {
    // One unreadable or malformed project must not hide the remaining projects.
    return null
  }
}

/**
 * Linked project directories point at `<project-root>/.claude-memory`.
 * Recover the project root from that authoritative target instead of decoding
 * Claude's directory name, whose hyphen encoding is inherently ambiguous.
 */
function resolveLinkedProjectPath(
  projectDirectory: string,
  linkedCloudPath?: string
): string | undefined {
  if (!linkedCloudPath) return undefined
  const absoluteCloudPath = isAbsolute(linkedCloudPath)
    ? normalize(linkedCloudPath)
    : resolve(dirname(projectDirectory), linkedCloudPath)
  return dirname(absoluteCloudPath)
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
 *   3. Legacy .swoop-link file: projects not yet migrated to junction model.
 */
async function readLinkState(
  projectDirectory: string
): Promise<{ isShared: boolean; cloudPath?: string; cloudOffline?: boolean }> {
  // 1. Registry — always wins when populated (swoop is running)
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
  } catch {
    /* not a junction */
  }

  // 3. Legacy .swoop-link (will be migrated to junction on next initCloudSync)
  try {
    const cloudPath = (await readFile(join(projectDirectory, APP.cloudLinkFile), 'utf8')).trim()
    if (cloudPath) return { isShared: true, cloudPath }
  } catch {
    /* no marker file */
  }

  return { isShared: false }
}

/**
 * Reads device names from {cloudDir}/device-presence/.
 * Files are written by unlinked devices following CLAUDE.md instructions.
 * Returns undefined (not an empty array) when the directory is absent or empty.
 */
async function readProjectMemoryState(
  projectPath: string,
  linkedCloudPath?: string
): Promise<{
  cloudPath: string
  linkedDevices?: string[]
  unlinkedDevices?: string[]
} | null> {
  const cloudPath = linkedCloudPath ?? join(projectPath, APP.sharedMemoryDir)
  if (!(await isAccessible(cloudPath))) return null

  try {
    const [presenceEntries, linkedEntries] = await Promise.all([
      readdir(join(cloudPath, 'device-presence')),
      readdir(join(cloudPath, 'linked')).catch(() => []),
    ])
    const linkedDevices = new Set(linkedEntries)
    const unlinkedDevices = presenceEntries
      .filter((fileName) => fileName.endsWith('.json'))
      .map((fileName) => fileName.slice(0, -5))
      .filter((device) => !linkedDevices.has(device))
    return {
      cloudPath,
      linkedDevices: linkedEntries.length > 0 ? linkedEntries.sort() : undefined,
      unlinkedDevices: unlinkedDevices.length > 0 ? unlinkedDevices.sort() : undefined,
    }
  } catch {
    const linkedEntries = await readdir(join(cloudPath, 'linked')).catch(() => [])
    return {
      cloudPath,
      linkedDevices: linkedEntries.length > 0 ? linkedEntries.sort() : undefined,
    }
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
// Ghost sessions — active lock-file sessions not yet discoverable on disk
// -----------------------------------------------------------------------------

/**
 * Prepends ghost sessions for every live lock-file session that is not already
 * represented by a transcript in this project's directory.
 *
 * Missing transcripts are deliberately limited to Claude Code's short
 * startup/first-flush window. If the transcript file already exists, the live
 * lock is enough evidence to keep the active session visible while the
 * transcript is still too sparse to parse.
 *
 * Ghost sessions pass through annotatePathExistence and annotateCurrentGitBranches
 * alongside regular sessions, so they get correct pathExists and currentBranch values.
 */
async function addGhostSessions(
  sessions: Session[],
  projectDirectory: string,
  projectPath: string,
  liveSessions: SessionLockRecord[]
): Promise<Session[]> {
  const now = Date.now()
  const knownIds = new Set(sessions.map((s) => s.id))

  const candidates = liveSessions.filter(
    (record): record is SessionLockRecord & { cwd: string } =>
      record.cwd !== null &&
      pathsReferToSameLocation(record.cwd, projectPath) &&
      !knownIds.has(record.sessionId)
  )

  if (candidates.length === 0) return sessions

  const ghosts: Session[] = []
  for (const record of candidates) {
    const jsonlPath = join(projectDirectory, `${record.sessionId}.jsonl`)
    const jsonlExists = await access(jsonlPath)
      .then(() => true)
      .catch(() => false)
    if (!jsonlExists && !isRecentLockRecord(record.startedAt, now)) continue
    ghosts.push(buildGhostSession(record))
  }

  if (ghosts.length === 0) return sessions
  return [...ghosts, ...sessions].sort(compareSessionsByRecentActivity)
}

/** Builds a minimal session entry for a live process with no discoverable transcript. */
function buildGhostSession(record: SessionLockRecord & { cwd: string }): Session {
  const startedAt =
    record.startedAt !== null ? new Date(record.startedAt).toISOString() : new Date().toISOString()

  return {
    id: record.sessionId,
    name: 'New session',
    projectPath: record.cwd,
    created: startedAt,
    updated: startedAt,
    messageCount: 0,
    context: {
      latestContextTokens: null,
      latestModel: null,
      latestOutputTokens: null,
      models: null,
    },
    signals: {
      analysisComplete: false,
      archived: false,
      compactionCount: null,
      expiresInDays: null,
      interrupted: null,
      lastToolFailed: null,
      pathExists: true,
    },
  }
}

/**
 * Creates one ghost project per unique cwd for lock records that don't match
 * any already-scanned project directory.
 */
function buildOrphanProjects(records: Array<SessionLockRecord & { cwd: string }>): Project[] {
  const byPath = new Map<string, Array<SessionLockRecord & { cwd: string }>>()
  for (const r of records) {
    const key = normalizePathForComparison(r.cwd)
    const group = byPath.get(key) ?? []
    group.push(r)
    byPath.set(key, group)
  }

  return [...byPath.values()].map((recs) => ({
    id: encodeProjectPath(recs[0].cwd),
    path: recs[0].cwd,
    sessions: recs.map(buildGhostSession).sort(compareSessionsByRecentActivity),
    isShared: false,
  }))
}

function isRecentLockRecord(startedAt: number | null, now: number): boolean {
  return startedAt !== null && now - startedAt < LOCK_FILE_GRACE_PERIOD_MS
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
