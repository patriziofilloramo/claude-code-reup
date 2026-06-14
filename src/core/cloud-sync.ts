import { copyFile, mkdir, readdir, readlink, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { APP } from '../config/app.js'
import { log } from '../utils/logger.js'

// localDir → cloudDir
const syncRegistry = new Map<string, string>()
let syncTimer: ReturnType<typeof setInterval> | null = null

// -----------------------------------------------------------------------------
// Sync loop lifecycle
// -----------------------------------------------------------------------------

/**
 * Registers a local↔cloud directory pair for background sync.
 * Idempotent — re-registering the same localDir updates its cloud target.
 */
export function registerSync(localDir: string, cloudDir: string): void {
  syncRegistry.set(localDir, cloudDir)
}

export function unregisterSync(localDir: string): void {
  syncRegistry.delete(localDir)
}

/**
 * Starts the periodic sync loop. Does nothing if already running.
 * Fires an immediate first sync so the UI is up-to-date on launch.
 */
export function startSyncLoop(): void {
  if (syncTimer !== null) return
  syncTimer = setInterval(() => { void runAllSyncs() }, APP.cloudSyncIntervalMs)
  void runAllSyncs()
}

export function stopSyncLoop(): void {
  if (syncTimer !== null) {
    clearInterval(syncTimer)
    syncTimer = null
  }
}

// -----------------------------------------------------------------------------
// Startup helper
// -----------------------------------------------------------------------------

/**
 * Reads all discovered projects, registers cloud syncs for any that have a
 * .ccm-link file, auto-migrates legacy NTFS junctions to the .ccm-link model,
 * and starts the sync loop. Call once on TUI/web startup.
 */
export async function initCloudSync(): Promise<void> {
  const { loadProjects } = await import('./project-discovery.js')
  const { getClaudeProjectsDirectory } = await import('./claude-paths.js')
  const { join: pathJoin } = await import('node:path')

  const projects = await loadProjects()
  const projectsDir = getClaudeProjectsDirectory()

  for (const project of projects) {
    const localDir = pathJoin(projectsDir, project.id)
    if (project.isShared && !project.cloudPath) {
      const cloudDir = await migrateLegacyJunction(localDir).catch(() => null)
      if (cloudDir) registerSync(localDir, cloudDir)
    } else if (project.cloudPath) {
      registerSync(localDir, project.cloudPath)
    }
  }

  startSyncLoop()
}

// -----------------------------------------------------------------------------
// Sync engine
// -----------------------------------------------------------------------------

async function runAllSyncs(): Promise<void> {
  for (const [localDir, cloudDir] of syncRegistry) {
    await syncBidirectional(localDir, cloudDir).catch((error) => {
      log.debug(`cloud-sync: error syncing ${localDir} ↔ ${cloudDir}: ${error}`)
    })
  }
}

/**
 * Bidirectional recursive sync between a local directory and a cloud directory.
 *
 * For every regular file present in either location, the larger copy wins.
 * Larger = more appended entries — correct for Claude Code's append-only JSONL
 * transcripts; safe for the metadata files (sessions-index.json, ccm.json) since
 * a longer file means a more recent write.
 *
 * Subdirectories (e.g. memory/) are synced recursively with the same rules.
 *
 * Reachability is tested via readdir() rather than access(): pCloud drives can
 * report access() success even when the network drive is unmounted.
 */
export async function syncBidirectional(localDir: string, cloudDir: string): Promise<void> {
  let cloudEntries: string[]
  try {
    cloudEntries = await readdir(cloudDir)
  } catch {
    log.debug(`cloud-sync: cloud dir unreachable, skipping sync: ${cloudDir}`)
    return
  }

  await mkdir(localDir, { recursive: true })

  const localEntries = await readdir(localDir).catch((): string[] => [])
  const allNames = new Set([...localEntries, ...cloudEntries])

  await Promise.all(
    [...allNames].map(async (name) => {
      if (name === APP.cloudLinkFile) return

      const localPath = join(localDir, name)
      const cloudPath = join(cloudDir, name)

      const [localStat, cloudStat] = await Promise.all([
        stat(localPath).catch(() => null),
        stat(cloudPath).catch(() => null),
      ])

      const isDir = localStat?.isDirectory() || cloudStat?.isDirectory()
      if (isDir) {
        await syncBidirectional(localPath, cloudPath)
      } else {
        await syncOneFile(name, localDir, cloudDir, localStat, cloudStat)
      }
    })
  )
}

async function syncOneFile(
  name: string,
  localDir: string,
  cloudDir: string,
  localStat: Awaited<ReturnType<typeof stat>> | null,
  cloudStat: Awaited<ReturnType<typeof stat>> | null,
): Promise<void> {
  const localPath = join(localDir, name)
  const cloudPath = join(cloudDir, name)

  if (localStat?.isFile() && !cloudStat) {
    await copyFile(localPath, cloudPath).catch((err) => {
      log.debug(`cloud-sync: local→cloud ${name}: ${err}`)
    })
    return
  }

  if (!localStat && cloudStat?.isFile()) {
    await copyFile(cloudPath, localPath).catch((err) => {
      log.debug(`cloud-sync: cloud→local ${name}: ${err}`)
    })
    return
  }

  if (localStat?.isFile() && cloudStat?.isFile() && localStat.size !== cloudStat.size) {
    const [srcPath, destPath] =
      localStat.size > cloudStat.size ? [localPath, cloudPath] : [cloudPath, localPath]
    await copyFile(srcPath, destPath).catch((err) => {
      log.debug(`cloud-sync: sync ${name}: ${err}`)
    })
  }
}

// -----------------------------------------------------------------------------
// Legacy junction migration
// -----------------------------------------------------------------------------

/**
 * Converts a legacy NTFS junction or Unix symlink at junctionPath into a real
 * local directory with a .ccm-link file pointing to the junction target.
 *
 * After migration the project directory is local-first: Claude Code always
 * writes locally, and the sync loop keeps the cloud copy up-to-date.
 *
 * @returns The cloud directory path so the caller can register it for sync.
 * @throws  When the junction cannot be read or the migration fails.
 */
export async function migrateLegacyJunction(junctionPath: string): Promise<string> {
  let cloudDir = await readlink(junctionPath)
  // Node.js on Windows may return the NT namespace prefix — strip it.
  if (cloudDir.startsWith('\\\\?\\')) cloudDir = cloudDir.slice(4)

  await removeLinkAt(junctionPath)
  await mkdir(junctionPath, { recursive: true })
  await writeFile(join(junctionPath, APP.cloudLinkFile), cloudDir, 'utf8')
  await syncBidirectional(junctionPath, cloudDir)

  log.debug(`cloud-sync: migrated legacy junction to .ccm-link: ${junctionPath} → ${cloudDir}`)
  return cloudDir
}

/**
 * Removes a junction (Windows) or symlink (Unix) without touching its target.
 * Uses `rmdir` on Windows because junctions are directory reparse points and
 * neither `unlink` nor `rm --recursive` work safely on them.
 */
async function removeLinkAt(linkPath: string): Promise<void> {
  if (process.platform === 'win32') {
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    await promisify(execFile)('cmd', ['/c', 'rmdir', linkPath])
  } else {
    const { unlink } = await import('node:fs/promises')
    await unlink(linkPath)
  }
}
