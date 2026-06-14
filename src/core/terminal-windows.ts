import {
  copyLaunchCommand,
  executableExists,
  executeShellCommand,
  successfulLaunch,
} from './terminal-shared.js'
import type { LaunchResult } from './terminal-shared.js'

/**
 * Opens a Windows terminal using Windows Terminal, PowerShell, or cmd.
 *
 * The launcher currently requires shell command strings. Callers must pass only
 * validated session commands; path escaping is handled for each launcher.
 * Failures are retained so clipboard fallback can explain what was attempted.
 */
export async function launchWindows(
  command: string,
  workingDirectory?: string
): Promise<LaunchResult> {
  const launchErrors: string[] = []

  // Windows Terminal provides the cleanest experience when available.
  if (process.env['WT_SESSION'] || (await executableExists('wt'))) {
    try {
      const workingDirectoryFlag = workingDirectory
        ? `--startingDirectory "${workingDirectory}"`
        : ''
      await executeShellCommand(`wt new-tab ${workingDirectoryFlag} -- cmd /k ${command}`)
      return successfulLaunch()
    } catch (error) {
      launchErrors.push(`wt: ${String(error)}`)
    }
  }

  // Windows PowerShell 5.1 is present on supported Windows versions.
  try {
    const escapedCommand = command.replace(/'/g, "''")
    const workingDirectoryArgument = workingDirectory
      ? ` -WorkingDirectory '${workingDirectory.replace(/'/g, "''")}'`
      : ''
    await executeShellCommand(
      `powershell.exe -NoProfile -NonInteractive -Command "Start-Process cmd.exe -ArgumentList '/k ${escapedCommand}'${workingDirectoryArgument}"`
    )
    return successfulLaunch()
  } catch (error) {
    launchErrors.push(`ps5: ${String(error)}`)
  }

  // `start` is the universal final launcher before clipboard fallback.
  try {
    const workingDirectoryArgument = workingDirectory ? `/d "${workingDirectory}"` : ''
    await executeShellCommand(`cmd /c start "" ${workingDirectoryArgument} cmd /k ${command}`)
    return successfulLaunch()
  } catch (error) {
    launchErrors.push(`start: ${String(error)}`)
  }

  const fallbackCommand = workingDirectory ? `cd /d "${workingDirectory}" && ${command}` : command
  return copyLaunchCommand(fallbackCommand, launchErrors)
}
