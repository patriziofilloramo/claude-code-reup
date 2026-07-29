import { spawn } from 'node:child_process'

import { APP } from '../config/app.js'
import type { ResumeTarget } from '../tui/App.js'
import { releaseTerminalInput } from '../tui/terminal-input.js'
import { tryChangeWorkingDirectory } from '../utils/process.js'
import { isHelpRequest, runHelpCommand } from './help-command.js'
import { failCommand } from './output.js'

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
    process.env[APP.themeEnvVar] = themeName
    args = [...args.slice(0, themeIdx), ...args.slice(themeIdx + 2)]
    if (args.length === 0) {
      console.log(`Theme set to: ${themeName}`)
      return
    }
  }

  const [command, ...commandArguments] = args

  if (command && command !== 'help' && isHelpRequest(commandArguments)) {
    runHelpCommand([command])
    return
  }

  // A hook entry names an absolute path, which goes stale for ordinary reasons
  // (a Node version manager moves the npm global root, an installer relocates)
  // and then fails silently. Repair from the surfaces the user lives in, which
  // stay alive long enough for the write to land. Deliberately not `doctor`,
  // whose job is to report the problem, nor `attention`, which owns this
  // integration itself.
  if (command === undefined || command === 'web' || command === 'config') {
    const { repairAttentionHookIfBroken } =
      await import('../core/session/attention-hooks-integration.js')
    void repairAttentionHookIfBroken()
  }

  switch (command) {
    case '--version':
    case '-v':
      console.log(APP.version)
      return

    case '--help':
    case '-h':
      runHelpCommand([])
      return

    case 'help':
      runHelpCommand(commandArguments)
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

    case 'resume':
      await resumeSession(commandArguments)
      return

    case 'search': {
      const { runSearchCommand } = await import('./search-command.js')
      await runSearchCommand(commandArguments)
      return
    }

    case 'touched': {
      const { runTouchedCommand } = await import('./touched-command.js')
      await runTouchedCommand(commandArguments)
      return
    }

    case 'usage': {
      const { runUsageCommand } = await import('./usage-command.js')
      await runUsageCommand(commandArguments)
      return
    }

    case 'attention': {
      const { runAttentionCommand } = await import('./attention-command.js')
      await runAttentionCommand(commandArguments)
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
      if (commandArguments.length === 0) {
        const { openConfigInterface } = await import('./open-config-interface.js')
        await openConfigInterface({
          commandName: 'reup completion',
          initialTab: 'Integrations',
          nonInteractiveAlternative: 'pass `powershell`, `bash`, or `zsh` explicitly',
        })
        return
      }
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
    failCommand('usage: reup handoff [session-id-or-prefix]')
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
  failCommand(`usage: reup ${command}`)
  return false
}

// -----------------------------------------------------------------------------
// Interactive TUI resume
// -----------------------------------------------------------------------------

async function runTerminalInterface(): Promise<void> {
  const { runTUI } = await import('../tui/App.js')
  const resumeTarget = await runTUI()
  if (!resumeTarget) return

  // The picker lists sessions whose project directory is gone. Launching from
  // the current directory beats aborting a resume the user just confirmed.
  tryChangeWorkingDirectory(resumeTarget.projectPath)
  releaseTerminalInput()
  await launchClaudeInCurrentTerminal(resumeTarget)
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
