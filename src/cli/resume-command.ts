import { spawnSync } from 'node:child_process'

import { getActiveSessions } from '../core/session/active-sessions.js'
import { loadProjects } from '../core/project/project-discovery.js'
import type { Project } from '../core/session/session-model.js'
import { isValidSessionId } from '../core/session/session-model.js'
import { rankSessionCandidates } from '../core/session/session-ranking.js'
import { releaseTerminalInput } from '../tui/terminal-input.js'
import { log } from '../utils/logger.js'
import { readCurrentWorkingDirectory } from '../utils/process.js'
import { failCommand } from './output.js'
import { selectSession } from './session-selector.js'

export interface DirectResumeTarget {
  projectPath?: string
  sessionId: string
}

export type DirectResumeSelection = { result: DirectResumeTarget } | { error: string }

/** Resumes a selected session, opening an interactive picker when no selector is provided. */
export async function runResumeCommand(commandArguments: string[]): Promise<void> {
  if (commandArguments.length > 1) {
    failCommand('usage: reup resume [session-id-or-prefix]')
    return
  }

  const selection =
    commandArguments.length === 0
      ? await selectResumeTargetInteractively()
      : await discoverResumeTarget(commandArguments[0])
  if (!selection) return
  if ('error' in selection) {
    failCommand(selection.error)
    return
  }

  const { projectPath, sessionId } = selection.result
  tryChangeWorkingDirectory(projectPath)

  const launchResult = spawnSync('claude', ['--resume', sessionId], {
    shell: process.platform === 'win32',
    stdio: 'inherit',
  })
  if (launchResult.error) {
    failCommand(`failed to launch claude: ${launchResult.error.message}`)
  } else if (launchResult.signal) {
    failCommand(`claude terminated by signal ${launchResult.signal}`)
  } else if (launchResult.status && launchResult.status !== 0) {
    process.exitCode = launchResult.status
  }
}

async function selectResumeTargetInteractively(): Promise<DirectResumeSelection | null> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return { error: 'a session selector is required outside an interactive terminal' }
  }

  try {
    const currentDirectory = readCurrentWorkingDirectory()
    const [projects, activeSessionIds] = await Promise.all([loadProjects(), getActiveSessions()])
    const candidates = rankSessionCandidates(projects, activeSessionIds, currentDirectory)
    if (candidates.length === 0) return { error: 'no resumable sessions found' }

    const { runResumePicker } = await import('../tui/ResumePicker.js')
    const selection = await runResumePicker(candidates, currentDirectory, undefined, projects)
    releaseTerminalInput()
    return selection ? { result: selection } : null
  } catch (error) {
    log.debug('resume: interactive session discovery failed:', error)
    return { error: 'failed to load sessions for interactive resume' }
  }
}

/**
 * Resolves prefixes only through discovered sessions. Full UUIDs remain valid
 * when discovery fails so direct resume keeps working from the current folder.
 */
async function discoverResumeTarget(selector: string): Promise<DirectResumeSelection> {
  try {
    const projects = await loadProjects()
    return selectResumeTarget(projects, selector)
  } catch (error) {
    log.debug('resume: session discovery failed:', error)
    return isValidSessionId(selector)
      ? { result: { sessionId: selector } }
      : { error: 'cannot resolve a session prefix because session discovery failed' }
  }
}

/** Converts a safe session selector into the exact ID passed to Claude Code. */
export function selectResumeTarget(projects: Project[], selector: string): DirectResumeSelection {
  const selection = selectSession(projects, selector)
  if ('result' in selection) {
    return {
      result: {
        projectPath: selection.result.session.projectPath,
        sessionId: selection.result.session.id,
      },
    }
  }

  // Preserve direct resume for a valid full UUID that is absent from Reup's
  // current discovery result. Claude Code remains the authority for that ID.
  return isValidSessionId(selector) ? { result: { sessionId: selector } } : selection
}

function tryChangeWorkingDirectory(projectPath: string | undefined): void {
  if (!projectPath) return
  try {
    process.chdir(projectPath)
  } catch (error) {
    log.warn(`recorded project path is unavailable; resuming from ${process.cwd()}: ${projectPath}`)
    log.debug('resume: failed to change working directory:', error)
  }
}
