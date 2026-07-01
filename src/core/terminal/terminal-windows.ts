import { execFile as execFileCallback, spawn } from 'node:child_process'
import { promisify } from 'node:util'

import { copyLaunchCommand, executableExists, successfulLaunch } from './terminal-shared.js'
import type { LaunchResult } from './terminal-shared.js'

const execFile = promisify(execFileCallback)

/**
 * Opens a Windows terminal using Windows Terminal, PowerShell, or a detached cmd.
 *
 * Launchers pass the working directory and command as structured process
 * options or argv elements. No user-controlled path is passed through `cmd /c`.
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
  // The command and working directory are passed as environment variables and
  // referenced as $env:… inside a fully static -Command script. PowerShell
  // expands the variable values as data, never as code, so there is no string
  // interpolation, no manual quote-escaping, and no injection surface.
  try {
    const psScript = workingDirectory
      ? "Start-Process cmd.exe -ArgumentList ('/k ' + $env:REUP_LAUNCH_CMD) -WorkingDirectory $env:REUP_LAUNCH_CWD"
      : "Start-Process cmd.exe -ArgumentList ('/k ' + $env:REUP_LAUNCH_CMD)"
    await execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], {
      env: {
        ...process.env,
        REUP_LAUNCH_CMD: commandParts.join(' '),
        REUP_LAUNCH_CWD: workingDirectory ?? '',
      },
    })
    return successfulLaunch()
  } catch (error) {
    launchErrors.push(`ps5: ${String(error)}`)
  }

  // Spawn cmd directly so workingDirectory never passes through cmd /c parsing.
  try {
    await spawnDetachedCommandPrompt(commandParts, workingDirectory)
    return successfulLaunch()
  } catch (error) {
    launchErrors.push(`cmd: ${String(error)}`)
  }

  const fallbackCommand = workingDirectory ? `cd /d "${workingDirectory}" && ${command}` : command
  return copyLaunchCommand(fallbackCommand, launchErrors)
}

function spawnDetachedCommandPrompt(
  commandParts: string[],
  workingDirectory?: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('cmd.exe', ['/k', ...commandParts], {
      cwd: workingDirectory,
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    })

    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}
