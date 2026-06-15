import { spawn } from 'node:child_process'

import { APP } from '../config/app.js'
import type { ResumeTarget } from '../tui/App.js'
import { releaseTerminalInput } from '../tui/terminal-input.js'
import { failCommand } from './output.js'

function buildCliHelp(): string {
  const tty = process.stdout.isTTY
  const b = (s: string) => (tty ? `\x1b[1m${s}\x1b[0m` : s)
  const d = (s: string) => (tty ? `\x1b[2m${s}\x1b[0m` : s)

  const CMD = 22 // width of the command column

  function row(cmd: string, desc: string, note?: string): string {
    const padded = cmd.padEnd(CMD)
    return `  ${padded}  ${desc}${note ? d(`  (${note})`) : ''}`
  }

  return [
    b('ccm') + ' — session manager for Claude Code',
    '',
    b('  Interfaces'),
    row('ccm', 'Open terminal UI', 'default'),
    row('ccm web', 'Open browser UI'),
    '',
    b('  Sessions'),
    row('ccm list [query]', 'List sessions', '--json for machine-readable'),
    row('ccm resume [id]', 'Resume by ID or prefix, or pick interactively'),
    row('ccm search <query>', 'Search by metadata', '--deep to search content'),
    row('ccm inbox', 'Sessions needing attention'),
    row('ccm handoff [id]', 'Print a continuation packet for handoff'),
    '',
    b('  Health'),
    row('ccm doctor', 'Diagnose local session-data issues'),
    row('ccm cleanup', 'Review and archive stale / empty sessions', '--dry-run to preview'),
    '',
    b('  Setup & Config'),
    row('ccm config', 'Open configuration panel'),
    row('ccm usage [action]', 'Usage monitoring', 'on / off / status'),
    row('ccm sync', 'Manage cross-device session sync', 'link / unlink [path]'),
    row('ccm --theme <name>', 'Set active theme', 'dark / light / terminal'),
    row('ccm completion <sh>', 'Print shell completion script'),
    '',
    b('  Meta'),
    row('ccm --version', 'Print version'),
    row('ccm --help', 'This help'),
    '',
    d('Run ccm <command> --help for per-command options.'),
  ].join('\n')
}

const VALID_THEMES = new Set(['dark', 'light', 'terminal'])

// -----------------------------------------------------------------------------
// Command dispatch
// -----------------------------------------------------------------------------

export async function runCli(commandLineArguments = process.argv.slice(2)): Promise<void> {
  // Handle --theme <name> before command dispatch: save preference and set env var.
  let args = commandLineArguments
  const themeIdx = args.indexOf('--theme')
  if (themeIdx !== -1) {
    const themeName = args[themeIdx + 1]
    if (!themeName || !VALID_THEMES.has(themeName)) {
      failCommand(`invalid or missing theme — valid values: ${[...VALID_THEMES].join(', ')}`)
      return
    }
    const { saveThemeName } = await import('../core/theme-preference.js')
    await saveThemeName(themeName as 'dark' | 'light' | 'terminal')
    process.env['CCM_THEME'] = themeName
    args = [...args.slice(0, themeIdx), ...args.slice(themeIdx + 2)]
    if (args.length === 0) {
      console.log(`Theme set to: ${themeName}`)
      return
    }
  }

  const [command, ...commandArguments] = args

  switch (command) {
    case '--version':
    case '-v':
      console.log(APP.version)
      return

    case '--help':
    case '-h':
      console.log(buildCliHelp())
      return

    case 'list':
      await listSessions(commandArguments)
      return

    case 'inbox':
      await showInbox(commandArguments)
      return

    case 'doctor':
      await runDoctor(commandArguments)
      return

    case 'handoff':
      await createHandoff(commandArguments)
      return

    case 'sync': {
      const { runSyncCommand } = await import('./sync-command.js')
      await runSyncCommand(commandArguments)
      return
    }

    case 'resume':
      await resumeSession(commandArguments)
      return

    case 'search': {
      const { runSearchCommand } = await import('./search-command.js')
      await runSearchCommand(commandArguments)
      return
    }

    case 'usage': {
      const { runUsageCommand } = await import('./usage-command.js')
      await runUsageCommand(commandArguments)
      return
    }

    case 'config': {
      const { runConfigCommand } = await import('./config-command.js')
      await runConfigCommand(commandArguments)
      return
    }

    case 'cleanup': {
      const { runCleanupCommand } = await import('./cleanup-command.js')
      await runCleanupCommand(commandArguments)
      return
    }

    case 'completion': {
      const { printCompletionScript } = await import('./completion-command.js')
      printCompletionScript(commandArguments)
      return
    }

    case '__complete-session-ids': {
      const { printSessionIdCompletions } = await import('./completion-command.js')
      await printSessionIdCompletions(commandArguments)
      return
    }

    case 'web': {
      const { startWeb } = await import('../web/server.js')
      await startWeb(commandArguments)
      return
    }

    case 'repair':
      failCommand('repair is not yet implemented')
      return

    case undefined:
      await runTerminalInterface()
      return

    default:
      failCommand(`unknown command: ${command}`)
  }
}

// -----------------------------------------------------------------------------
// Script-friendly commands
// -----------------------------------------------------------------------------

async function listSessions(commandArguments: string[]): Promise<void> {
  const { runListCommand } = await import('./list-command.js')
  await runListCommand(commandArguments)
}

async function showInbox(commandArguments: string[]): Promise<void> {
  if (!acceptsNoArguments('inbox', commandArguments)) return
  const { showInbox } = await import('./inbox-command.js')
  await showInbox()
}

async function runDoctor(commandArguments: string[]): Promise<void> {
  if (!acceptsNoArguments('doctor', commandArguments)) return
  const { runDoctor } = await import('./doctor-command.js')
  await runDoctor()
}

async function createHandoff(commandArguments: string[]): Promise<void> {
  if (commandArguments.length > 1) {
    failCommand('usage: ccm handoff [session-id-or-prefix]')
    return
  }
  const { createHandoff } = await import('./handoff-command.js')
  await createHandoff(commandArguments[0])
}

async function resumeSession(commandArguments: string[]): Promise<void> {
  const { runResumeCommand } = await import('./resume-command.js')
  await runResumeCommand(commandArguments)
}

function acceptsNoArguments(command: string, commandArguments: string[]): boolean {
  if (commandArguments.length === 0) return true
  failCommand(`usage: ccm ${command}`)
  return false
}

// -----------------------------------------------------------------------------
// Interactive TUI resume
// -----------------------------------------------------------------------------

async function runTerminalInterface(): Promise<void> {
  const { initCloudSync, stopSyncLoop } = await import('../core/sync/cloud-sync.js')
  await runWithSyncSpinner(initCloudSync)

  const { readUserPrefsSync } = await import('../core/user-prefs.js')
  const { autoCleanupOnStart } = readUserPrefsSync()
  if (autoCleanupOnStart !== 'off') {
    const { getActiveSessions } = await import('../core/session/active-sessions.js')
    const { findAutoArchiveCandidates, findCleanupCandidates } = await import('../core/session/cleanup.js')
    const { loadProjects } = await import('../core/project/project-discovery.js')
    const { setSessionArchived } = await import('../core/session/session-metadata.js')

    const [projects, activeSessionIds] = await Promise.all([loadProjects(), getActiveSessions()])
    const candidates = findCleanupCandidates(projects, activeSessionIds)
    if (candidates.length > 0) {
      if (autoCleanupOnStart === 'auto') {
        const safeCandidates = findAutoArchiveCandidates(candidates)
        await Promise.all(
          safeCandidates.map((candidate) =>
            setSessionArchived(candidate.projectId, candidate.session.id, true)
          )
        )
      } else {
        // 'on' mode — show picker, user selects
        const { runCleanupPicker } = await import('../tui/CleanupPicker.js')
        const chosen = await runCleanupPicker(candidates)
        releaseTerminalInput()
        if (chosen && chosen.length > 0) {
          await Promise.all(
            candidates
              .filter((c) => chosen.some((ch) => ch.session.id === c.session.id))
              .map((c) => setSessionArchived(c.projectId, c.session.id, true))
          )
        }
      }
    }
  }

  const { runTUI } = await import('../tui/App.js')
  const resumeTarget = await runTUI()
  stopSyncLoop()
  if (!resumeTarget) return

  process.chdir(resumeTarget.projectPath)
  releaseTerminalInput()
  await launchClaudeInCurrentTerminal(resumeTarget)
}

/**
 * Runs the initial cloud sync while showing a terminal spinner.
 * The spinner only appears if sync takes longer than 120 ms — fast or
 * empty syncs complete silently with no visual noise.
 */
async function runWithSyncSpinner(fn: () => Promise<number>): Promise<void> {
  const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
  let frame = 0
  let visible = false

  const showTimer = setTimeout(() => {
    visible = true
    process.stderr.write(`${FRAMES[0]} syncing linked projects...`)
  }, 120)

  const spinTimer = setInterval(() => {
    if (!visible) return
    frame = (frame + 1) % FRAMES.length
    process.stderr.write(`\r${FRAMES[frame]} syncing linked projects...`)
  }, 80)

  await fn()

  clearTimeout(showTimer)
  clearInterval(spinTimer)
  if (visible) {
    process.stderr.write(`\r\x1b[K`) // erase the spinner line
  }
}

function launchClaudeInCurrentTerminal(resumeTarget: ResumeTarget): Promise<void> {
  const args = resumeTarget.sessionId ? ['--resume', resumeTarget.sessionId] : []
  return new Promise((resolve) => {
    const claudeProcess = spawn('claude', args, {
      shell: process.platform === 'win32',
      stdio: 'inherit',
    })
    claudeProcess.on('close', (exitCode) => {
      if (exitCode) process.exitCode = exitCode
      resolve()
    })
    claudeProcess.on('error', (error) => {
      failCommand(`failed to launch claude: ${error.message}`)
      resolve()
    })
  })
}
