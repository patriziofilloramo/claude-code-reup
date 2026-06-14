import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import which from 'which'

import { copyLaunchCommand, executeShellCommand, successfulLaunch } from './terminal.shared.js'
import type { LaunchResult } from './terminal.shared.js'

const executeFile = promisify(execFile)

interface TerminalEmulator {
  buildLaunchCommand: (command: string, workingDirectory?: string) => string
  executable: string
}

// -----------------------------------------------------------------------------
// Shell escaping
// -----------------------------------------------------------------------------

/**
 * Quotes arbitrary text as one POSIX shell argument. Characters such as
 * spaces, `$`, backticks, and embedded quotes remain literal.
 */
function quoteForPosixShell(value: string): string {
  return "'" + value.replace(/'/g, "'\"'\"'") + "'"
}

/** Escapes the two special characters inside AppleScript string literals. */
function escapeAppleScriptString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

// -----------------------------------------------------------------------------
// Standalone emulator launch commands
// -----------------------------------------------------------------------------

/**
 * Standalone emulators tried in order when the inherited terminal cannot open
 * a new window. Each command passes dynamic values through POSIX quoting.
 */
const TERMINAL_EMULATORS: TerminalEmulator[] = [
  {
    executable: 'alacritty',
    buildLaunchCommand: (command, workingDirectory) =>
      workingDirectory
        ? `alacritty --working-directory ${quoteForPosixShell(workingDirectory)} -e sh -c ${quoteForPosixShell(command)}`
        : `alacritty -e sh -c ${quoteForPosixShell(command)}`,
  },
  {
    executable: 'ghostty',
    buildLaunchCommand: (command) => `ghostty --command=${quoteForPosixShell(command)}`,
  },
  {
    executable: 'gnome-terminal',
    buildLaunchCommand: (command, workingDirectory) =>
      workingDirectory
        ? `gnome-terminal --working-directory=${quoteForPosixShell(workingDirectory)} -- sh -c ${quoteForPosixShell(command)}`
        : `gnome-terminal -- sh -c ${quoteForPosixShell(command)}`,
  },
  {
    executable: 'kitty',
    buildLaunchCommand: (command) => `kitty -- sh -c ${quoteForPosixShell(command)}`,
  },
  {
    executable: 'wezterm',
    buildLaunchCommand: (command, workingDirectory) =>
      workingDirectory
        ? `wezterm cli spawn --cwd ${quoteForPosixShell(workingDirectory)} -- sh -c ${quoteForPosixShell(command)}`
        : `wezterm cli spawn -- sh -c ${quoteForPosixShell(command)}`,
  },
  {
    executable: 'xterm',
    buildLaunchCommand: (command) => `xterm -e sh -c ${quoteForPosixShell(command)}`,
  },
]

// -----------------------------------------------------------------------------
// Launch strategy
// -----------------------------------------------------------------------------

/**
 * Opens a Unix/macOS terminal using the current terminal context when possible,
 * then known emulator binaries, and finally the clipboard fallback.
 *
 * Strategy: tmux, inherited terminal application, standalone emulator, then
 * clipboard. `command` contains a validated session ID; every filesystem path
 * is quoted before entering a shell command.
 */
export async function launchUnix(
  command: string,
  workingDirectory?: string
): Promise<LaunchResult> {
  const commandWithWorkingDirectory = workingDirectory
    ? `cd ${quoteForPosixShell(workingDirectory)} && ${command}`
    : command

  if (process.env['TMUX']) {
    try {
      await executeShellCommand(
        `tmux new-window ${quoteForPosixShell(commandWithWorkingDirectory)}`
      )
      return successfulLaunch()
    } catch {
      // Try a standalone terminal.
    }
  }

  const detectedTerminalResult = await launchUsingDetectedTerminal(
    command,
    commandWithWorkingDirectory,
    workingDirectory
  )
  if (detectedTerminalResult) return detectedTerminalResult

  for (const emulator of TERMINAL_EMULATORS) {
    try {
      await which(emulator.executable)
      await executeShellCommand(emulator.buildLaunchCommand(command, workingDirectory))
      return successfulLaunch()
    } catch {
      // Try the next installed emulator.
    }
  }

  return copyLaunchCommand(commandWithWorkingDirectory)
}

/** Tries the terminal application identified by the inherited environment. */
async function launchUsingDetectedTerminal(
  command: string,
  commandWithWorkingDirectory: string,
  workingDirectory?: string
): Promise<LaunchResult | null> {
  try {
    switch (process.env['TERM_PROGRAM']) {
      case 'iTerm.app':
        // The AppleScript source is passed as argv, without an intermediary shell.
        await executeFile('osascript', [
          '-e',
          `tell app "iTerm2" to create window with default profile command "${escapeAppleScriptString(commandWithWorkingDirectory)}"`,
        ])
        return successfulLaunch()

      case 'ghostty':
        await executeShellCommand(
          `ghostty --command=${quoteForPosixShell(commandWithWorkingDirectory)}`
        )
        return successfulLaunch()

      case 'WezTerm': {
        const workingDirectoryArgument = workingDirectory
          ? ` --cwd ${quoteForPosixShell(workingDirectory)}`
          : ''
        await executeShellCommand(
          `wezterm cli spawn${workingDirectoryArgument} -- sh -c ${quoteForPosixShell(command)}`
        )
        return successfulLaunch()
      }

      case 'Apple_Terminal':
        // `open -a Terminal` opens files, so Terminal requires `do script`.
        await executeFile('osascript', [
          '-e',
          `tell application "Terminal" to do script "${escapeAppleScriptString(commandWithWorkingDirectory)}"`,
        ])
        return successfulLaunch()

      default:
        return null
    }
  } catch {
    return null
  }
}
