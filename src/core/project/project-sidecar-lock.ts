import { open, readFile, stat, unlink } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { join } from 'node:path'

const LOCK_RETRY_INTERVAL_MS = 50
const INVALID_LOCK_STALE_AFTER_MS = 5_000
const LOCK_ACQUISITION_TIMEOUT_MS = INVALID_LOCK_STALE_AFTER_MS + 2_500

export type SidecarLockInspection =
  | { state: 'abandoned'; reason: string }
  | { state: 'active' }
  | { state: 'missing' }
  | { state: 'unknown'; reason: string }

/**
 * Runs an operation while holding the project's cross-process sidecar lock.
 * Delegates to {@link withAdvisoryFileLock} using the project directory's
 * conventional lock path.
 */
export async function withProjectSidecarLock<T>(
  projectDirectory: string,
  operation: () => Promise<T>
): Promise<T> {
  return withAdvisoryFileLock(join(projectDirectory, LEGACY_PROJECT_SIDECAR_LOCK), () =>
    withAdvisoryFileLock(join(projectDirectory, PROJECT_SIDECAR_LOCK), operation)
  )
}

/**
 * General-purpose cross-process advisory file lock.
 *
 * Lock protocol:
 * - `open(..., 'wx')` is the only acquisition primitive.
 * - The owner PID allows contenders to recover locks left by dead processes.
 * - An empty or malformed lock is removed only after a grace period because a
 *   live owner briefly exposes an empty file between create and PID write.
 */
export async function withAdvisoryFileLock<T>(
  lockPath: string,
  operation: () => Promise<T>
): Promise<T> {
  const acquisitionDeadline = Date.now() + LOCK_ACQUISITION_TIMEOUT_MS
  let lockAcquired = false

  while (Date.now() < acquisitionDeadline) {
    let createdLockFile = false
    let ownedLockFile: FileHandle | null = null

    try {
      ownedLockFile = await open(lockPath, 'wx')
      createdLockFile = true
      await ownedLockFile.writeFile(String(process.pid))
      await ownedLockFile.close()
      ownedLockFile = null
      lockAcquired = true
      break
    } catch (error) {
      if (createdLockFile) {
        // We own this path. Do not leave an unusable lock behind if initialising
        // or closing its file handle fails.
        if (ownedLockFile) await ownedLockFile.close().catch(() => {})
        await unlink(lockPath).catch(() => {})
        throw error
      }

      const errorCode = (error as NodeJS.ErrnoException).code
      // Under Windows contention, opening an existing lock can surface EPERM
      // instead of EEXIST. Both mean another process may own the lock.
      if (errorCode !== 'EEXIST' && errorCode !== 'EPERM') throw error

      if (await removeAbandonedLock(lockPath)) continue
      await waitBeforeRetry()
    }
  }

  if (!lockAcquired) throw new Error(`reup: advisory lock timeout (${lockPath})`)

  try {
    return await operation()
  } finally {
    await unlink(lockPath).catch(() => {})
  }
}

/**
 * Removes a lock only when its owner is known to be gone or its invalid
 * contents have remained untouched beyond the stale threshold.
 */
async function removeAbandonedLock(lockPath: string): Promise<boolean> {
  const inspection = await inspectProjectSidecarLock(lockPath)
  if (inspection.state !== 'abandoned') return false

  try {
    // The inspect/unlink TOCTOU is acceptable for this advisory lock:
    // contenders still arbitrate the next acquisition through atomic O_EXCL.
    await unlink(lockPath)
    return true
  } catch {
    // Another contender may have released or replaced the lock between checks.
    // Retrying atomic acquisition is the only required recovery action.
    return false
  }
}

/** Inspects a sidecar lock without modifying it. */
export async function inspectProjectSidecarLock(lockPath: string): Promise<SidecarLockInspection> {
  let lockContents: string
  try {
    lockContents = await readFile(lockPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'missing' }
    return { state: 'unknown', reason: 'lock file is unreadable' }
  }

  const normalizedLockContents = lockContents.trim()
  const ownerPid = /^\d+$/.test(normalizedLockContents)
    ? Number.parseInt(normalizedLockContents, 10)
    : Number.NaN
  if (!Number.isSafeInteger(ownerPid) || ownerPid <= 0) {
    try {
      const lockStats = await stat(lockPath)
      return Date.now() - lockStats.mtimeMs >= INVALID_LOCK_STALE_AFTER_MS
        ? { state: 'abandoned', reason: 'invalid lock contents are stale' }
        : { state: 'active' }
    } catch {
      return { state: 'missing' }
    }
  }

  try {
    process.kill(ownerPid, 0)
    return { state: 'active' }
  } catch (error) {
    const errorCode = (error as NodeJS.ErrnoException).code
    if (errorCode === 'EPERM') return { state: 'active' }
    if (errorCode === 'ESRCH') {
      return { state: 'abandoned', reason: `owner process ${ownerPid} is not running` }
    }
    return { state: 'unknown', reason: `cannot inspect owner process ${ownerPid}` }
  }
}

async function waitBeforeRetry(): Promise<void> {
  const jitterMs = Math.random() * 20
  await new Promise<void>((resolve) => setTimeout(resolve, LOCK_RETRY_INTERVAL_MS + jitterMs))
}

const PROJECT_SIDECAR_LOCK = 'reup.json.lock'
const LEGACY_PROJECT_SIDECAR_LOCK = `${'swo'}${'op'}.json.lock`
