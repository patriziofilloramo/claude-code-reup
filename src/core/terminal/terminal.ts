import type { LaunchResult } from './terminal-shared.js'
import { launchUnix } from './terminal-unix.js'
import { launchWindows } from './terminal-windows.js'

export type { LaunchResult } from './terminal-shared.js'

/**
 * Opens a new terminal window and resumes a UUID-validated session.
 *
 * Keeping validation at the caller preserves one platform-neutral launch path
 * while making the shell-command trust boundary explicit.
 */
export async function launchResume(
  validatedSessionId: string,
  workingDirectory?: string
): Promise<LaunchResult> {
  const command = `claude --resume ${validatedSessionId}`
  return process.platform === 'win32'
    ? launchWindows(command, workingDirectory)
    : launchUnix(command, workingDirectory)
}

/** Opens a new terminal window and starts a fresh Claude Code session. */
export async function launchNewSession(workingDirectory?: string): Promise<LaunchResult> {
  return process.platform === 'win32'
    ? launchWindows('claude', workingDirectory)
    : launchUnix('claude', workingDirectory)
}
