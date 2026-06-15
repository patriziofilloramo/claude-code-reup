/**
 * Cloud sync — junction-first architecture.
 *
 * When a project is linked via `ccm link`, its Claude Code session directory
 * (~/.claude/projects/<id>/) is replaced with an NTFS junction (Windows) or
 * symlink (Unix) pointing directly at the cloud storage directory inside the
 * project (e.g. P:\Projects\...\.claude-memory\). Claude Code writes through
 * the junction into cloud storage; the cloud provider (pCloud, Dropbox, …)
 * replicates those writes to every other device automatically — no ccm
 * required on the other device.
 *
 * Offline resilience: ccm maintains a local backup at ~/.claude/ccm/sync/<id>/
 * that mirrors the cloud dir. When the junction target goes offline, ccm:
 *   1. Removes the junction and creates a real local directory from the backup.
 *   2. Claude Code continues writing sessions normally (no data loss).
 *   3. When the cloud comes back, ccm merges the offline sessions into the cloud
 *      dir and restores the junction.
 *
 * The syncRegistry (src/core/sync-registry.ts) is updated on every transition
 * so project-discovery can annotate projects with their online/offline status
 * without importing this module directly (which would create a circular dep).
 */

import {
  copyFile,
  lstat,
  mkdir,
  readdir,
  readlink,
  rm,
  stat,
} from 'node:fs/promises'
import { join } from 'node:path'

import { APP } from '../config/app.js'
import { getCcmDirectory, getClaudeProjectsDirectory } from './claude-paths.js'
import { log } from '../utils/logger.js'
import { syncRegistry } from './sync-registry.js'
import type { ProjectSyncInfo } from './sync-registry.js'

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

interface SyncState extends ProjectSyncInfo {
  junctionPath: string
  backupDir: string
}

const syncStates = new Map<string, SyncState>()
let syncTimer: ReturnType<typeof setInterval> | null = null

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
 * Discovers all linked projects, migrates any .ccm-link files to junctions,
 * initialises the local backup for every linked project, and starts the
 * background offline-guard loop.
 *
 * Awaiting this guarantees the caller has up-to-date data before showing UI.
 *
 * @returns Number of cloud-linked projects initialised.
 */
export async function initCloudSync(): Promise<number> {
  const { loadProjects } = await import('./project-discovery.js')
  const { invalidateProjectCache } = await import('./project-cache.js')

  const projects = await loadProjects()
  const projectsDir = getClaudeProjectsDirectory()
  const backupRoot = join(getCcmDirectory(), APP.cloudSyncBackupDir)

  for (const project of projects) {
    if (!project.isShared) continue

    const junctionPath = join(projectsDir, project.id)

    try {
      // Determine the actual filesystem representation: junction or real directory.
      // readLinkState sets cloudPath for both junctions (via readlink) and .ccm-link
      // files (via readFile), so we must check lstat to distinguish the two cases.
      const pathStat = await lstat(junctionPath).catch(() => null)
      const isJunction = pathStat?.isSymbolicLink() ?? false

      if (isJunction) {
        // Already a junction — read the target and set up the backup guard.
        let cloudDir = await readlink(junctionPath)
        if (cloudDir.startsWith('\\\\?\\')) cloudDir = cloudDir.slice(4)
        await setupProjectSync(project.id, junctionPath, cloudDir, backupRoot)
      } else if (project.cloudPath) {
        // Real directory with a .ccm-link file: migrate to junction.
        await migrateLinkFileToJunction(junctionPath, project.cloudPath)
        await setupProjectSync(project.id, junctionPath, project.cloudPath, backupRoot)
      }
    } catch (error) {
      log.debug(`cloud-sync: init failed for ${project.id}: ${error}`)
    }
  }

  if (syncStates.size > 0) {
    invalidateProjectCache()
    syncTimer = setInterval(() => { void runSyncCycle() }, APP.cloudSyncIntervalMs)
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
  junctionPath: string,
  cloudDir: string,
  backupRoot: string,
): Promise<void> {
  const backupDir = join(backupRoot, projectId)
  const online = await isCloudAccessible(cloudDir)

  const state: SyncState = {
    junctionPath,
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
  const { invalidateProjectCache } = await import('./project-cache.js')
  let changed = false

  for (const [, state] of syncStates) {
    const wasOnline = state.isOnline
    const nowOnline = await isCloudAccessible(state.cloudDir)

    if (wasOnline && !nowOnline) {
      await activateOfflineMode(state).catch((e) => {
        log.debug(`cloud-sync: offline transition failed for ${state.junctionPath}: ${e}`)
      })
      state.isOnline = false
      changed = true
    } else if (!wasOnline && nowOnline) {
      await deactivateOfflineMode(state).catch((e) => {
        log.debug(`cloud-sync: online restore failed for ${state.junctionPath}: ${e}`)
      })
      state.isOnline = true
      state.hasPendingMerge = false
      changed = true
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
  await removeLinkAt(state.junctionPath)
  await mkdir(state.junctionPath, { recursive: true })
  await copyDir(state.backupDir, state.junctionPath)
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
  await mkdir(state.backupDir, { recursive: true })
  await copyDir(state.cloudDir, state.backupDir)
  await rm(state.junctionPath, { recursive: true, force: true })
  await createLinkAt(state.junctionPath, state.cloudDir)
  log.debug(`cloud-sync: online — junction restored at ${state.junctionPath}`)
}

/**
 * Cloud is accessible. Copies cloud → backup to keep the offline fallback
 * current. Picks up sessions written by other devices via the cloud provider.
 */
async function refreshBackup(state: SyncState): Promise<void> {
  await mkdir(state.backupDir, { recursive: true })
  await copyDir(state.cloudDir, state.backupDir)
}

// ---------------------------------------------------------------------------
// Migration: .ccm-link → junction
// ---------------------------------------------------------------------------

/**
 * Converts a .ccm-link local-first directory back to an NTFS junction.
 * Sessions are merged into the cloud dir first so no data is lost.
 */
async function migrateLinkFileToJunction(junctionPath: string, cloudDir: string): Promise<void> {
  await syncBidirectional(junctionPath, cloudDir)
  await rm(junctionPath, { recursive: true, force: true })
  await createLinkAt(junctionPath, cloudDir)
  log.debug(`cloud-sync: migrated .ccm-link → junction: ${junctionPath} → ${cloudDir}`)
}

// ---------------------------------------------------------------------------
// Bidirectional sync (exported for ccm link/unlink)
// ---------------------------------------------------------------------------

/**
 * Bidirectional recursive sync between two directories.
 *
 * For each file present in either location the larger copy wins — safe for
 * Claude Code's append-only JSONL transcripts and conservative for memory
 * markdown files (more content = more Claude writes). Subdirectories are
 * synced recursively (covers memory/, etc.).
 *
 * Reachability is probed via readdir() rather than access(): pCloud drives
 * can return access() success even when the network volume is unmounted.
 */
export async function syncBidirectional(dirA: string, dirB: string): Promise<void> {
  let entriesB: string[]
  try {
    await mkdir(dirB, { recursive: true })
    entriesB = await readdir(dirB)
  } catch {
    log.debug(`cloud-sync: unreachable: ${dirB}`)
    return
  }

  await mkdir(dirA, { recursive: true })
  const entriesA = await readdir(dirA).catch((): string[] => [])
  const allNames = new Set([...entriesA, ...entriesB])

  await Promise.all(
    [...allNames].map(async (name) => {
      if (name === APP.cloudLinkFile) return  // skip legacy marker if still present

      const pathA = join(dirA, name)
      const pathB = join(dirB, name)
      const [statA, statB] = await Promise.all([
        stat(pathA).catch(() => null),
        stat(pathB).catch(() => null),
      ])

      if (statA?.isDirectory() || statB?.isDirectory()) {
        await syncBidirectional(pathA, pathB)
      } else {
        await syncOneFile(pathA, pathB, statA, statB)
      }
    })
  )
}

async function syncOneFile(
  pathA: string,
  pathB: string,
  statA: Awaited<ReturnType<typeof stat>> | null,
  statB: Awaited<ReturnType<typeof stat>> | null,
): Promise<void> {
  if (statA?.isFile() && !statB) {
    await copyFile(pathA, pathB).catch((e) => log.debug(`cloud-sync: A→B ${pathA}: ${e}`))
    return
  }
  if (!statA && statB?.isFile()) {
    await copyFile(pathB, pathA).catch((e) => log.debug(`cloud-sync: B→A ${pathB}: ${e}`))
    return
  }
  if (statA?.isFile() && statB?.isFile() && statA.size !== statB.size) {
    const [src, dst] = statA.size > statB.size ? [pathA, pathB] : [pathB, pathA]
    await copyFile(src, dst).catch((e) => log.debug(`cloud-sync: sync ${src}: ${e}`))
  }
}

// ---------------------------------------------------------------------------
// Filesystem helpers (exported for memory-command)
// ---------------------------------------------------------------------------

/**
 * Creates a directory junction (Windows) or symlink (Unix) at linkPath
 * pointing at target. On Windows this requires no elevated privileges.
 */
export async function createLinkAt(linkPath: string, target: string): Promise<void> {
  if (process.platform === 'win32') {
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    await promisify(execFile)('cmd', ['/c', 'mklink', '/J', linkPath, target])
  } else {
    const { symlink } = await import('node:fs/promises')
    await symlink(target, linkPath)
  }
}

/**
 * Removes a junction (Windows) or symlink (Unix) without deleting the target.
 * Uses `rmdir` on Windows because junctions are directory reparse points —
 * `unlink` and recursive `rm` do not work on them correctly.
 */
export async function removeLinkAt(linkPath: string): Promise<void> {
  if (process.platform === 'win32') {
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    await promisify(execFile)('cmd', ['/c', 'rmdir', linkPath])
  } else {
    const { unlink } = await import('node:fs/promises')
    await unlink(linkPath)
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

async function copyDir(src: string, dst: string): Promise<void> {
  let entries: string[]
  try {
    entries = await readdir(src)
  } catch {
    return
  }
  await mkdir(dst, { recursive: true })
  await Promise.all(
    entries.map(async (name) => {
      const srcPath = join(src, name)
      const dstPath = join(dst, name)
      const s = await stat(srcPath).catch(() => null)
      if (!s) return
      if (s.isDirectory()) {
        await copyDir(srcPath, dstPath)
      } else if (s.isFile()) {
        await copyFile(srcPath, dstPath).catch((e) => {
          log.debug(`cloud-sync: copyDir ${srcPath}: ${e}`)
        })
      }
    })
  )
}
