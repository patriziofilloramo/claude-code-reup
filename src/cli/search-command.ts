import { spawnSync } from 'node:child_process'

import { getActiveSessions } from '../core/session/active-sessions.js'
import { loadProjects } from '../core/project/project-discovery.js'
import { releaseTerminalInput } from '../tui/terminal-input.js'
import { log } from '../utils/logger.js'
import { failCommand } from './output.js'
import { createListedSessions, filterListedSessions } from './list-command.js'

export async function runSearchCommand(args: string[]): Promise<void> {
  const isDeep = args.includes('--deep')
  const query = args
    .filter((a) => !a.startsWith('--'))
    .join(' ')
    .trim()

  if (!query) {
    failCommand('usage: swoop search [--deep] <query>')
    return
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    failCommand('swoop search requires an interactive terminal')
    return
  }

  try {
    const [projects, activeSessionIds] = await Promise.all([loadProjects(), getActiveSessions()])

    if (isDeep) {
      const { runDeepSearchPicker } = await import('../tui/DeepSearchPicker.js')
      const match = await runDeepSearchPicker(query, projects)
      releaseTerminalInput()
      if (!match) return
      tryChdir(match.session.projectPath)
      launchClaude(match.session.id)
    } else {
      const allSessions = createListedSessions(projects, activeSessionIds)
      const matchingSessions = filterListedSessions(allSessions, {
        query,
        activeOnly: false,
        archivedOnly: false,
        attentionOnly: false,
        json: false,
      })
      const { runSearchPicker } = await import('../tui/SearchPicker.js')
      const result = await runSearchPicker(matchingSessions, projects, query)
      releaseTerminalInput()
      if (!result) return
      if (result.kind === 'resume') {
        tryChdir(result.session.projectPath)
        launchClaude(result.session.id)
      } else {
        tryChdir(result.match.session.projectPath)
        launchClaude(result.match.session.id)
      }
    }
  } catch (error) {
    log.debug('search: failed:', error)
    failCommand('search failed — run with SWOOP_DEBUG=1 for details')
  }
}

function tryChdir(projectPath: string | undefined): void {
  if (!projectPath) return
  try {
    process.chdir(projectPath)
  } catch {
    /* best-effort */
  }
}

function launchClaude(sessionId: string): void {
  const result = spawnSync('claude', ['--resume', sessionId], {
    shell: process.platform === 'win32',
    stdio: 'inherit',
  })
  if (result.error) failCommand(`failed to launch claude: ${result.error.message}`)
  else if (result.status && result.status !== 0) process.exitCode = result.status
}
