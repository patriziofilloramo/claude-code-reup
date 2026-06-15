import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'

import { copyLaunchCommand, executableExists, successfulLaunch } from './terminal-shared.js'
import type { LaunchResult } from './terminal-shared.js'

const execFile = promisify(execFileCallback)

/**
 * Opens a Windows terminal using Windows Terminal, PowerShell, or cmd.
 *
 * All three launchers use execFile (not exec) so arguments are passed as argv
 * elements rather than interpolated into a shell string. This eliminates the
 * intermediate cmd.exe shell layer and means workingDirectory and command parts
 * are never subject to shell metacharacter interpretation.
 *
 * command is always "claude" or "claude --resume <hex-uuid>" — word-splitting
 * it is safe because neither part contains spaces or special characters.
 */
export async function launchWindows(
  command: string,
  workingDirectory?: string
): Promise<LaunchResult> {
  const launchErrors: string[] = []
  const commandParts = command.split(' ')

  // Windows Terminal provides the cleanest experience when available.
  if (process.env['WT_SESSION'] || (await executableExists('wt'))) {
    try {
      const wtArgs = ['new-tab']
      if (workingDirectory) wtArgs.push('--startingDirectory', workingDirectory)
      wtArgs.push('--', 'cmd', '/k', ...commandParts)
      await execFile('wt', wtArgs)
      return successfulLaunch()
    } catch (error) {
      launchErrors.push(`wt: ${String(error)}`)
    }
  }

  // Windows PowerShell 5.1 is present on all supported Windows versions.
  // execFile passes -Command as a direct argv element — no intermediate shell.
  // The only remaining string interpolation is inside PowerShell's own -Command
  // argument, where single-quote doubling ('') is the correct PS escape.
  try {
    const escapedCommand = commandParts.join(' ').replace(/'/g, "''")
    const workDirFlag = workingDirectory
      ? ` -WorkingDirectory '${workingDirectory.replace(/'/g, "''")}'`
      : ''
    await execFile('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Start-Process cmd.exe -ArgumentList '/k ${escapedCommand}'${workDirFlag}`,
    ])
    return successfulLaunch()
  } catch (error) {
    launchErrors.push(`ps5: ${String(error)}`)
  }

  // `start` is the universal final launcher before clipboard fallback.
  try {
    const startArgs = ['/c', 'start', '']
    if (workingDirectory) startArgs.push('/d', workingDirectory)
    startArgs.push('cmd', '/k', ...commandParts)
    await execFile('cmd', startArgs)
    return successfulLaunch()
  } catch (error) {
    launchErrors.push(`start: ${String(error)}`)
  }

  const fallbackCommand = workingDirectory ? `cd /d "${workingDirectory}" && ${command}` : command
  return copyLaunchCommand(fallbackCommand, launchErrors)
}
