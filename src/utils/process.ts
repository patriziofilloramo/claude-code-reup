import { log } from './logger.js'

/** Returns the current working directory, or undefined if it no longer exists. */
export function readCurrentWorkingDirectory(): string | undefined {
  try {
    return process.cwd()
  } catch {
    return undefined
  }
}

/**
 * Moves the process into a session's recorded project directory.
 *
 * Recorded paths outlive the directories they name — Reup surfaces that as the
 * `path-missing` status — so a launch the user already confirmed must degrade
 * to the current directory instead of aborting. Returns whether the move
 * happened, for callers that want to say so.
 */
export function tryChangeWorkingDirectory(projectPath: string | undefined): boolean {
  if (!projectPath) return false

  try {
    process.chdir(projectPath)
    return true
  } catch (error) {
    log.warn(`recorded project path is unavailable; resuming from ${process.cwd()}: ${projectPath}`)
    log.debug('resume: failed to change working directory:', error)
    return false
  }
}
