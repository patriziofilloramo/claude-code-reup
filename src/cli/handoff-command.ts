import { join } from 'node:path'

import { getActiveSessions } from '../core/session/active-sessions.js'
import { getProjectDirectory } from '../core/project/claude-paths.js'
import { loadProjects } from '../core/project/project-discovery.js'
import type { Project, Session } from '../core/session/session-model.js'
import { formatHandoff, readTranscriptHandoffContext } from '../core/session/session-handoff.js'
import { rankSessionCandidates } from '../core/session/session-ranking.js'
import { releaseTerminalInput } from '../tui/terminal-input.js'
import { log } from '../utils/logger.js'
import { readCurrentWorkingDirectory } from '../utils/process.js'
import { failCommand, writeOutput } from './output.js'
import { selectSession } from './session-selector.js'

/**
 * Prints a compact continuation packet for a session.
 * When selector is omitted, shows an interactive picker (requires a TTY).
 */
export async function createHandoff(selector: string | undefined): Promise<void> {
  let project: Project
  let session: Session

  if (selector === undefined) {
    const picked = await pickSessionInteractively()
    if (!picked) return
    project = picked.project
    session = picked.session
  } else {
    const selection = selectSession(await loadProjects(), selector)
    if ('error' in selection) {
      failCommand(selection.error)
      return
    }
    project = selection.result.project
    session = selection.result.session
  }

  const transcriptPath = join(getProjectDirectory(project.id), `${session.id}.jsonl`)
  try {
    const context = await readTranscriptHandoffContext(transcriptPath)
    writeOutput(formatHandoff(session, context))
  } catch (error) {
    log.debug('handoff: failed to read transcript:', transcriptPath, error)
    const errorCode = (error as NodeJS.ErrnoException).code
    failCommand(
      errorCode === 'ENOENT'
        ? `transcript not found for session ${session.id}`
        : `cannot read transcript for session ${session.id}`
    )
  }
}

async function pickSessionInteractively(): Promise<{ project: Project; session: Session } | null> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    failCommand('a session selector is required outside an interactive terminal')
    return null
  }

  const cwd = readCurrentWorkingDirectory()
  const [projects, activeSessionIds] = await Promise.all([loadProjects(), getActiveSessions()])
  const candidates = rankSessionCandidates(projects, activeSessionIds, cwd)

  if (candidates.length === 0) {
    failCommand('no sessions found')
    return null
  }

  const { runResumePicker } = await import('../tui/ResumePicker.js')
  const picked = await runResumePicker(candidates, cwd)
  releaseTerminalInput()
  if (!picked) return null

  const selection = selectSession(projects, picked.sessionId)
  if ('error' in selection) {
    failCommand(selection.error)
    return null
  }
  return selection.result
}
