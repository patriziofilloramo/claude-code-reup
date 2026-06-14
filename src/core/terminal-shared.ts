import { exec } from 'node:child_process'
import { promisify } from 'node:util'

import clipboardy from 'clipboardy'
import which from 'which'

export interface LaunchResult {
  copied: boolean
  launched: boolean
  /** Error details from failed launch attempts; present only after clipboard fallback. */
  message?: string
}

/** Copies the launch command when no supported terminal can be opened. */
export async function copyLaunchCommand(
  command: string,
  launchErrors: string[] = []
): Promise<LaunchResult> {
  await clipboardy.write(command)
  return { launched: false, copied: true, message: launchErrors.join(' | ') || undefined }
}

export async function executableExists(name: string): Promise<boolean> {
  try {
    await which(name)
    return true
  } catch {
    return false
  }
}

export function successfulLaunch(): LaunchResult {
  return { launched: true, copied: false }
}

/** Executes the small platform-specific shell commands required by terminal launchers. */
export const executeShellCommand = promisify(exec)
