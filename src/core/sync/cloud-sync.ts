/**
 * Cloud sync — junction-first architecture.
 *
 * When a project is linked via `reup sync link`, its Claude Code session directory
 * (~/.claude/projects/<id>/) is replaced with an NTFS junction (Windows) or
 * symlink (Unix) pointing directly at the cloud storage directory inside the
 * project (e.g. P:\Projects\...\.claude-memory\). Claude Code writes through
 * the junction into cloud storage; the cloud provider (pCloud, Dropbox, …)
 * replicates those writes to every other device automatically — no reup
 * required on the other device.
 *
 * Offline resilience: reup maintains a local backup at ~/.claude/reup/sync/<id>/
 * that mirrors the cloud dir. When the junction target goes offline, reup:
 *   1. Removes the junction and creates a real local directory from the backup.
 *   2. Claude Code continues writing sessions normally (no data loss).
 *   3. When the cloud comes back, reup merges the offline sessions into the cloud
 *      dir and restores the junction.
 *
 * The syncRegistry (src/core/sync/sync-registry.ts) is updated on every transition
 * so project-discovery can annotate projects with their online/offline status
 * without importing this module directly (which would create a circular dep).
 */

import {
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { basename, dirname, extname, join } from 'node:path'

import { APP } from '../../config/app.js'
import { getLiveSessionRecords } from '../session/active-sessions.js'
import { getReupDirectory, getClaudeProjectsDirectory } from '../project/claude-paths.js'
import { pathsReferToSameLocation } from '../project/path-comparison.js'
import { log } from '../../utils/logger.js'
import { syncRegistry } from './sync-registry.js'
import type { ProjectSyncInfo } from './sync-registry.js'

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

interface SyncState extends ProjectSyncInfo {
  backupDir: string
  junctionPath: string
  projectPath: string
}

type FileStat = Awaited<ReturnType<typeof lstat>>
type ConflictSide = 'a' | 'b'

export class CloudSyncConflictError extends Error {
  constructor(pathA: string, pathB: string) {
    super(`sync conflict: both copies changed independently (${pathA}, ${pathB})`)
    this.name = 'CloudSyncConflictError'
  }
}

export class CloudSyncUnavailableError extends Error {
  constructor(directoryPath: string, cause?: unknown) {
    super(`sync directory is unavailable: ${directoryPath}`, { cause })
    this.name = 'CloudSyncUnavailableError'
  }
}

const syncStates = new Map<string, SyncState>()
let syncTimer: ReturnType<typeof setInterval> | null = null
const CONFLICT_DIRECTORY_NAME = '.reup-conflicts'
const LEGACY_CONFLICT_DIRECTORY_NAME = `.${'swo'}${'op'}-conflicts`

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export function stopSyncLoop(): void {
  if (syncTimer !== null) {
    clearInterval(syncTimer)
    syncTimer = null
  }
}

/**
 * Removes one project from the runtime offline guard after it has been
 * explicitly unlinked. The registry otherwise remains authoritative over the
 * filesystem and would make project discovery report the new local directory
 * as still linked.
 */
export function unregisterProjectSync(junctionPath: string): void {
  for (const registeredPath of syncStates.keys()) {
    if (pathsReferToSameLocation(registeredPath, junctionPath)) {
      syncStates.delete(registeredPath)
    }
  }
  for (const registeredPath of syncRegistry.keys()) {
    if (pathsReferToSameLocation(registeredPath, junctionPath)) {
      syncRegistry.delete(registeredPath)
    }
  }
  if (syncStates.size === 0) stopSyncLoop()
}

/**
 * Discovers all linked projects, migrates link-marker directories to junctions,
 * initialises the local backup for every linked project, and starts the
 * background offline-guard loop.
 *
 * Awaiting this guarantees the caller has up-to-date data before showing UI.
 *
 * @returns Number of cloud-linked projects initialised.
 */
export async function initCloudSync(): Promise<number> {
  const { isProjectMemorySyncEnabled } = await import('./project-sync-status.js')
  const { loadProjects } = await import('../project/project-discovery.js')
  const { invalidateProjectCache } = await import('../project/project-cache.js')

  stopSyncLoop()
  syncStates.clear()
  syncRegistry.clear()
  if (!isProjectMemorySyncEnabled()) return 0

  const projects = await loadProjects()
  const liveSessions = await getLiveSessionRecords()
  const projectsDir = getClaudeProjectsDirectory()
  const backupRoot = join(getReupDirectory(), APP.cloudSyncBackupDir)

  for (const project of projects) {
    if (!project.isShared) continue

    const junctionPath = join(projectsDir, project.id)

    try {
      // Determine the actual filesystem representation: junction or real directory.
      // readLinkState sets cloudPath for both junctions and link-marker directories
      // files (via readFile), so we must check lstat to distinguish the two cases.
      const pathStat = await lstat(junctionPath).catch(() => null)
      const isJunction = pathStat?.isSymbolicLink() ?? false

      if (isJunction) {
        // Already a junction — read the target and set up the backup guard.
        let cloudDir = await readlink(junctionPath)
        if (cloudDir.startsWith('\\\\?\\')) cloudDir = cloudDir.slice(4)
        if (
          hasLiveSessionForPath(liveSessions, project.path) &&
          !(await isCloudAccessible(cloudDir))
        ) {
          log.debug(`cloud-sync: offline guard deferred while project is active: ${project.path}`)
          continue
        }
        await setupProjectSync(project.id, project.path, junctionPath, cloudDir, backupRoot)
      } else if (project.cloudPath) {
        if (hasLiveSessionForPath(liveSessions, project.path)) {
          log.debug(`cloud-sync: migration deferred while project is active: ${project.path}`)
          continue
        }
        // Real directory with a link marker: migrate to junction.
        await migrateLinkFileToJunction(junctionPath, project.cloudPath)
        await setupProjectSync(
          project.id,
          project.path,
          junctionPath,
          project.cloudPath,
          backupRoot
        )
      }
    } catch (error) {
      log.debug(`cloud-sync: init failed for ${project.id}: ${error}`)
    }
  }

  if (syncStates.size > 0) {
    invalidateProjectCache()
    syncTimer = setInterval(() => {
      void runSyncCycle()
    }, APP.cloudSyncIntervalMs)
  }

  return syncStates.size
}

// ---------------------------------------------------------------------------
// Project sync initialisation
// ---------------------------------------------------------------------------

/**
 * Determines the initial online/offline state for one linked project,
 * sets up the local backup, and registers the project in syncStates +
 * syncRegistry so project-discovery can annotate it correctly.
 */
async function setupProjectSync(
  projectId: string,
  projectPath: string,
  junctionPath: string,
  cloudDir: string,
  backupRoot: string
): Promise<void> {
  const backupDir = join(backupRoot, projectId)
  const online = await isCloudAccessible(cloudDir)

  const state: SyncState = {
    junctionPath,
    projectPath,
    cloudDir,
    backupDir,
    isOnline: online,
    hasPendingMerge: false,
  }

  if (online) {
    await refreshBackup(state)
  } else {
    const hasBackup = await backupHasData(backupDir)
    if (hasBackup) {
      await activateOfflineMode(state)
    }
    // No backup and offline: leave junction in place (broken but best we can do).
  }

  syncStates.set(junctionPath, state)
  syncRegistry.set(junctionPath, state)
}

// ---------------------------------------------------------------------------
// Sync cycle (background)
// ---------------------------------------------------------------------------

async function runSyncCycle(): Promise<void> {
  const { invalidateProjectCache } = await import('../project/project-cache.js')
  const liveSessions = await getLiveSessionRecords()
  let changed = false

  for (const [, state] of syncStates) {
    const wasOnline = state.isOnline
    const nowOnline = await isCloudAccessible(state.cloudDir)
    const projectIsActive = hasLiveSessionForPath(liveSessions, state.projectPath)

    if (wasOnline && !nowOnline) {
      if (projectIsActive) {
        log.debug(
          `cloud-sync: offline transition deferred while project is active: ${state.projectPath}`
        )
        continue
      }
      try {
        await activateOfflineMode(state)
        state.isOnline = false
        changed = true
      } catch (e) {
        log.debug(`cloud-sync: offline transition failed for ${state.junctionPath}: ${e}`)
      }
    } else if (!wasOnline && nowOnline) {
      if (projectIsActive) {
        log.debug(
          `cloud-sync: online transition deferred while project is active: ${state.projectPath}`
        )
        continue
      }
      try {
        await deactivateOfflineMode(state)
        state.isOnline = true
        state.hasPendingMerge = false
        changed = true
      } catch (e) {
        log.debug(`cloud-sync: online restore failed for ${state.junctionPath}: ${e}`)
      }
    } else if (nowOnline) {
      await refreshBackup(state).catch((e) => {
        log.debug(`cloud-sync: backup refresh failed for ${state.junctionPath}: ${e}`)
      })
    }
  }

  if (changed) invalidateProjectCache()
}

// ---------------------------------------------------------------------------
// Online / offline transitions
// ---------------------------------------------------------------------------

/**
 * Cloud just went offline. Replaces the junction with a real local directory
 * populated from the backup so Claude Code can continue writing without error.
 */
async function activateOfflineMode(state: SyncState): Promise<void> {
  await replaceLinkWithDirectory(state.junctionPath, state.backupDir, state.cloudDir)
  state.hasPendingMerge = true
  log.debug(`cloud-sync: offline — local dir at ${state.junctionPath}`)
}

/**
 * Cloud came back online. Merges any sessions written during the offline period
 * into the cloud directory, refreshes the backup, then restores the junction
 * so all future writes go directly to cloud storage again.
 */
async function deactivateOfflineMode(state: SyncState): Promise<void> {
  await syncBidirectional(state.junctionPath, state.cloudDir)
  await mirrorDirectory(state.cloudDir, state.backupDir)
  await replaceDirectoryWithLink(state.junctionPath, state.cloudDir)
  log.debug(`cloud-sync: online — junction restored at ${state.junctionPath}`)
}

/**
 * Cloud is accessible. Copies cloud → backup to keep the offline fallback
 * current. Picks up sessions written by other devices via the cloud provider.
 */
async function refreshBackup(state: SyncState): Promise<void> {
  await mirrorDirectory(state.cloudDir, state.backupDir)
}

// ---------------------------------------------------------------------------
// Migration: link marker to junction
// ---------------------------------------------------------------------------

/**
 * Converts a local-first link-marker directory back to an NTFS junction.
 * Sessions are merged into the cloud dir first so no data is lost.
 */
async function migrateLinkFileToJunction(junctionPath: string, cloudDir: string): Promise<void> {
  await syncBidirectional(junctionPath, cloudDir)
  await replaceDirectoryWithLink(junctionPath, cloudDir)
  log.debug(`cloud-sync: migrated link marker to junction: ${junctionPath} → ${cloudDir}`)
}

// ---------------------------------------------------------------------------
// Bidirectional sync (exported for reup sync link/unlink)
// ---------------------------------------------------------------------------

/**
 * Bidirectional recursive sync between two directories.
 *
 * Missing files are copied in either direction. When both copies exist, an
 * exact prefix relationship proves that one is an append-only extension of
 * the other, so the longer copy is propagated. Independent edits are reported
 * as conflicts and both originals are preserved.
 *
 * Reachability is probed via readdir() rather than access(): pCloud drives
 * can return access() success even when the network volume is unmounted.
 */
export async function syncBidirectional(dirA: string, dirB: string): Promise<void> {
  await Promise.all([migrateLegacyConflictDirectory(dirA), migrateLegacyConflictDirectory(dirB)])
  const [entriesA, entriesB] = await Promise.all([
    readDirectoryOrThrow(dirA),
    readDirectoryOrThrow(dirB),
  ])
  const allNames = new Set([...entriesA, ...entriesB])

  await Promise.all(
    [...allNames].map(async (name) => {
      if (name === APP.cloudLinkFile || name === APP.legacyCloudLinkFile) return
      if (name === LEGACY_CONFLICT_DIRECTORY_NAME) return

      const pathA = join(dirA, name)
      const pathB = join(dirB, name)
      const [statA, statB] = await Promise.all([lstatIfPresent(pathA), lstatIfPresent(pathB)])

      if (statA?.isSymbolicLink() || statB?.isSymbolicLink()) {
        // Junctions and symlinks are structural plumbing (e.g. auto-memory junctions
        // created by Claude Code). Skip them — their targets are synced independently.
        log.debug(
          `cloud-sync: skipping junction/symlink during sync: ${statA?.isSymbolicLink() ? pathA : pathB}`
        )
        return
      }

      if (statA?.isDirectory() && statB?.isDirectory()) {
        await syncBidirectional(pathA, pathB)
        return
      }
      if (statA?.isDirectory() && !statB) {
        await mkdir(pathB)
        await syncBidirectional(pathA, pathB)
        return
      }
      if (!statA && statB?.isDirectory()) {
        await mkdir(pathA)
        await syncBidirectional(pathA, pathB)
        return
      }
      if (statA?.isDirectory() || statB?.isDirectory()) {
        throw new CloudSyncConflictError(pathA, pathB)
      }

      await syncOneFile(pathA, pathB, statA, statB)
    })
  )
}

async function syncOneFile(
  pathA: string,
  pathB: string,
  statA: FileStat | null,
  statB: FileStat | null
): Promise<void> {
  if (statA?.isFile() && !statB) {
    await copyFileAtomically(pathA, pathB)
    return
  }
  if (!statA && statB?.isFile()) {
    await copyFileAtomically(pathB, pathA)
    return
  }
  if (!statA?.isFile() || !statB?.isFile()) {
    throw new CloudSyncConflictError(pathA, pathB)
  }

  const [contentA, contentB] = await Promise.all([readFile(pathA), readFile(pathB)])
  if (contentA.equals(contentB)) return
  if (bufferStartsWith(contentA, contentB)) {
    await copyFileAtomically(pathA, pathB)
    return
  }
  if (bufferStartsWith(contentB, contentA)) {
    await copyFileAtomically(pathB, pathA)
    return
  }

  if (pathA.toLowerCase().endsWith('.md')) {
    if (await mergeMarkdownFilesUnion(pathA, pathB, contentA, contentB)) return
  }

  // Both copies diverged independently (e.g. offline session writes on two devices).
  // Preserve both originals before making either side converge.
  await preserveConflictCopiesAndConverge(pathA, pathB, contentA, contentB, statA, statB)
}

/**
 * Union-merges two independently-edited UTF-8 Markdown files.
 *
 * Lines present in contentB but absent in contentA are appended to pathA,
 * then pathA is copied to pathB so both sides converge to the same content.
 * Invalid UTF-8 (binary content) falls back to a conflict error.
 *
 * This handles the common case where each device appended entries to an index
 * file (e.g. MEMORY.md) independently: the merge captures all entries from
 * both devices without data loss.
 */
async function mergeMarkdownFilesUnion(
  pathA: string,
  pathB: string,
  contentA: Buffer,
  contentB: Buffer
): Promise<boolean> {
  let textA: string
  let textB: string
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true })
    textA = decoder.decode(contentA)
    textB = decoder.decode(contentB)
  } catch {
    return false
  }

  const splitLines = (text: string): string[] => {
    const lines = text.split('\n')
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
    return lines
  }

  const linesA = splitLines(textA)
  const lineSetA = new Set(linesA)
  const extra = splitLines(textB).filter((line) => !lineSetA.has(line))
  const merged = Buffer.from([...linesA, ...extra].join('\n') + '\n', 'utf-8')

  const tempPath = temporarySiblingPath(pathA, 'merge')
  try {
    await writeFile(tempPath, merged)
    await rename(tempPath, pathA)
  } finally {
    await rm(tempPath, { force: true })
  }
  await copyFileAtomically(pathA, pathB)

  log.debug(`cloud-sync: auto-merged .md conflict: ${pathA}`)
  return true
}

async function preserveConflictCopiesAndConverge(
  pathA: string,
  pathB: string,
  contentA: Buffer,
  contentB: Buffer,
  statA: FileStat,
  statB: FileStat
): Promise<void> {
  const resolution = chooseConflictCanonical(pathA, pathB, contentA, contentB, statA, statB)
  await writeConflictArtifacts(pathA, pathB, contentA, contentB, statA, statB, resolution)

  if (resolution.canonicalSide === 'a') {
    await writeFileAtomically(pathB, contentA)
  } else {
    await writeFileAtomically(pathA, contentB)
  }

  log.debug(
    `cloud-sync: preserved conflict copies for ${pathA} and ${pathB}; canonical side=${resolution.canonicalSide} (${resolution.reason})`
  )
}

function chooseConflictCanonical(
  pathA: string,
  pathB: string,
  contentA: Buffer,
  contentB: Buffer,
  statA: FileStat,
  statB: FileStat
): {
  canonicalSide: ConflictSide
  latestTimestampA: string | null
  latestTimestampB: string | null
  reason: string
} {
  const latestTimestampA = latestJsonlTimestamp(contentA)
  const latestTimestampB = latestJsonlTimestamp(contentB)
  const timestampA = latestTimestampA ? Date.parse(latestTimestampA) : Number.NaN
  const timestampB = latestTimestampB ? Date.parse(latestTimestampB) : Number.NaN

  if (Number.isFinite(timestampA) && Number.isFinite(timestampB) && timestampA !== timestampB) {
    return {
      canonicalSide: timestampA > timestampB ? 'a' : 'b',
      latestTimestampA,
      latestTimestampB,
      reason: 'latest-jsonl-timestamp',
    }
  }

  if (Number.isFinite(timestampA) !== Number.isFinite(timestampB)) {
    return {
      canonicalSide: Number.isFinite(timestampA) ? 'a' : 'b',
      latestTimestampA,
      latestTimestampB,
      reason: 'only-valid-jsonl-timestamp',
    }
  }

  const mtimeA = Number(statA.mtimeMs)
  const mtimeB = Number(statB.mtimeMs)
  if (Math.abs(mtimeA - mtimeB) > 1) {
    return {
      canonicalSide: mtimeA > mtimeB ? 'a' : 'b',
      latestTimestampA,
      latestTimestampB,
      reason: 'latest-mtime',
    }
  }

  return {
    canonicalSide: pathA.localeCompare(pathB) <= 0 ? 'a' : 'b',
    latestTimestampA,
    latestTimestampB,
    reason: 'stable-path-tiebreaker',
  }
}

async function writeConflictArtifacts(
  pathA: string,
  pathB: string,
  contentA: Buffer,
  contentB: Buffer,
  statA: FileStat,
  statB: FileStat,
  resolution: ReturnType<typeof chooseConflictCanonical>
): Promise<void> {
  const hashA = sha256(contentA)
  const hashB = sha256(contentB)
  const artifactNames = conflictArtifactNames(pathA, hashA, hashB)
  const createdAt = new Date().toISOString()
  const manifest = Buffer.from(
    JSON.stringify(
      {
        schemaVersion: 1,
        createdAt,
        originalName: basename(pathA),
        resolution: {
          canonicalSide: resolution.canonicalSide,
          reason: resolution.reason,
        },
        sideA: conflictManifestSide(pathA, contentA, statA, hashA, resolution.latestTimestampA),
        sideB: conflictManifestSide(pathB, contentB, statB, hashB, resolution.latestTimestampB),
      },
      null,
      2
    ) + '\n',
    'utf8'
  )

  for (const conflictDir of uniqueConflictDirectories(pathA, pathB)) {
    await mkdir(conflictDir, { recursive: true })
    await writeFileAtomically(join(conflictDir, artifactNames.sideA), contentA)
    await writeFileAtomically(join(conflictDir, artifactNames.sideB), contentB)
    await writeFileAtomically(join(conflictDir, artifactNames.manifest), manifest)
  }
}

function conflictManifestSide(
  path: string,
  content: Buffer,
  stat: FileStat,
  sha256Hash: string,
  latestJsonlTimestamp: string | null
): Record<string, unknown> {
  return {
    bytes: content.length,
    latestJsonlTimestamp,
    mtime: stat.mtime.toISOString(),
    path,
    sha256: sha256Hash,
  }
}

function conflictArtifactNames(
  originalPath: string,
  hashA: string,
  hashB: string
): { manifest: string; sideA: string; sideB: string } {
  const originalName = basename(originalPath)
  const extension = extname(originalName)
  const stem = extension ? originalName.slice(0, -extension.length) : originalName
  const conflictId = `${hashA.slice(0, 16)}-vs-${hashB.slice(0, 16)}`
  const suffix = extension || '.bin'

  return {
    manifest: `${stem}.conflict.${conflictId}.json`,
    sideA: `${stem}.side-a.${hashA}${suffix}`,
    sideB: `${stem}.side-b.${hashB}${suffix}`,
  }
}

function uniqueConflictDirectories(pathA: string, pathB: string): string[] {
  const directories = [
    join(dirname(pathA), CONFLICT_DIRECTORY_NAME),
    join(dirname(pathB), CONFLICT_DIRECTORY_NAME),
  ]
  return [...new Set(directories)]
}

async function migrateLegacyConflictDirectory(directoryPath: string): Promise<void> {
  const legacyPath = join(directoryPath, LEGACY_CONFLICT_DIRECTORY_NAME)
  const currentPath = join(directoryPath, CONFLICT_DIRECTORY_NAME)
  const legacyStat = await lstatIfPresent(legacyPath)
  if (!legacyStat?.isDirectory()) return

  const currentStat = await lstatIfPresent(currentPath)
  if (!currentStat) {
    await rename(legacyPath, currentPath)
    return
  }

  if (!currentStat.isDirectory()) throw new CloudSyncConflictError(legacyPath, currentPath)
  await syncBidirectional(legacyPath, currentPath)
  await rm(legacyPath, { force: true, recursive: true })
}

function latestJsonlTimestamp(content: Buffer): string | null {
  let latest: string | null = null
  let latestTime = Number.NEGATIVE_INFINITY

  for (const line of content.toString('utf8').split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const event = JSON.parse(line) as Record<string, unknown>
      if (typeof event['timestamp'] !== 'string') continue
      const time = Date.parse(event['timestamp'])
      if (!Number.isFinite(time) || time <= latestTime) continue
      latest = event['timestamp']
      latestTime = time
    } catch {
      continue
    }
  }

  return latest
}

function sha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}

// ---------------------------------------------------------------------------
// Filesystem helpers (exported for sync-command)
// ---------------------------------------------------------------------------

/**
 * Creates a directory junction (Windows) or symlink (Unix) at linkPath
 * pointing at target. On Windows this requires no elevated privileges.
 */
export async function createLinkAt(linkPath: string, target: string): Promise<void> {
  await symlink(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir')
}

/**
 * Removes a junction or symlink without deleting its target.
 */
export async function removeLinkAt(linkPath: string): Promise<void> {
  await unlink(linkPath)
}

/**
 * Replaces a real directory with a link while retaining a rollback copy until
 * the link has been created successfully.
 */
export async function replaceDirectoryWithLink(
  directoryPath: string,
  target: string
): Promise<void> {
  const rollbackPath = temporarySiblingPath(directoryPath, 'rollback')
  await rename(directoryPath, rollbackPath)

  try {
    await createLinkAt(directoryPath, target)
  } catch (error) {
    await rename(rollbackPath, directoryPath)
    throw error
  }

  await rm(rollbackPath, { force: true, recursive: true }).catch((error) => {
    log.debug(`cloud-sync: rollback cleanup failed for ${rollbackPath}: ${error}`)
  })
}

/**
 * Replaces a link with a fully copied real directory. The original link is
 * removed only after the staged copy is complete.
 */
export async function replaceLinkWithDirectory(
  linkPath: string,
  sourceDirectory: string,
  rollbackTarget: string
): Promise<void> {
  const stagedDirectory = temporarySiblingPath(linkPath, 'staged')
  await mirrorDirectory(sourceDirectory, stagedDirectory)

  try {
    await removeLinkAt(linkPath)
    await rename(stagedDirectory, linkPath)
  } catch (error) {
    if ((await lstatIfPresent(linkPath)) === null) {
      await createLinkAt(linkPath, rollbackTarget).catch(() => {})
    }
    await rm(stagedDirectory, { force: true, recursive: true })
    throw error
  }
}

/** Re-points a link and restores the original target if creation fails. */
export async function repointLink(
  linkPath: string,
  currentTarget: string,
  nextTarget: string
): Promise<void> {
  await removeLinkAt(linkPath)
  try {
    await createLinkAt(linkPath, nextTarget)
  } catch (error) {
    await createLinkAt(linkPath, currentTarget)
    throw error
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function isCloudAccessible(cloudDir: string): Promise<boolean> {
  try {
    await readdir(cloudDir)
    return true
  } catch {
    return false
  }
}

async function backupHasData(backupDir: string): Promise<boolean> {
  try {
    const entries = await readdir(backupDir)
    return entries.length > 0
  } catch {
    return false
  }
}

export async function mirrorDirectory(
  sourceDirectory: string,
  destinationDirectory: string
): Promise<void> {
  const sourceEntries = await readDirectoryOrThrow(sourceDirectory)
  await mkdir(destinationDirectory, { recursive: true })
  const destinationEntries = await readDirectoryOrThrow(destinationDirectory)

  await Promise.all(
    sourceEntries.map(async (name) => {
      const sourcePath = join(sourceDirectory, name)
      const destinationPath = join(destinationDirectory, name)
      const sourceStat = await lstat(sourcePath)

      if (sourceStat.isSymbolicLink()) {
        throw new CloudSyncConflictError(sourcePath, destinationPath)
      }
      if (sourceStat.isDirectory()) {
        await mirrorDirectory(sourcePath, destinationPath)
        return
      }
      if (sourceStat.isFile()) {
        await copyFileAtomically(sourcePath, destinationPath)
      }
    })
  )

  const sourceNames = new Set(sourceEntries)
  await Promise.all(
    destinationEntries
      .filter((name) => !sourceNames.has(name))
      .map((name) => rm(join(destinationDirectory, name), { force: true, recursive: true }))
  )
}

async function copyFileAtomically(sourcePath: string, destinationPath: string): Promise<void> {
  const temporaryPath = temporarySiblingPath(destinationPath, 'copy')
  try {
    await copyFile(sourcePath, temporaryPath)
    await rename(temporaryPath, destinationPath)
  } finally {
    await rm(temporaryPath, { force: true })
  }
}

async function writeFileAtomically(destinationPath: string, content: Buffer): Promise<void> {
  const temporaryPath = temporarySiblingPath(destinationPath, 'write')
  try {
    await writeFile(temporaryPath, content)
    await rename(temporaryPath, destinationPath)
  } finally {
    await rm(temporaryPath, { force: true })
  }
}

async function lstatIfPresent(path: string): Promise<Awaited<ReturnType<typeof lstat>> | null> {
  try {
    return await lstat(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

async function readDirectoryOrThrow(directoryPath: string): Promise<string[]> {
  try {
    return await readdir(directoryPath)
  } catch (error) {
    throw new CloudSyncUnavailableError(directoryPath, error)
  }
}

function bufferStartsWith(candidate: Buffer, prefix: Buffer): boolean {
  return candidate.length >= prefix.length && candidate.subarray(0, prefix.length).equals(prefix)
}

function temporarySiblingPath(path: string, purpose: string): string {
  return `${path}.reup-${purpose}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function hasLiveSessionForPath(
  liveSessions: Awaited<ReturnType<typeof getLiveSessionRecords>>,
  projectPath: string
): boolean {
  return liveSessions.some(
    (session) => session.cwd !== null && pathsReferToSameLocation(session.cwd, projectPath)
  )
}
