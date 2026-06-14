import { spawn } from 'node:child_process'

import { APP } from '../config/app.js'
import type { ResumeTarget } from '../tui/App.js'
import { releaseTerminalInput } from '../tui/terminal-input.js'
import { failCommand } from './output.js'

const CLI_HELP = `
ccm — session manager for Claude Code

Usage:
  ccm                   Open terminal UI (default)
  ccm web               Open browser UI
  ccm list [query]      List sessions; use --json for machine-readable output
  ccm inbox             Show sessions needing attention
  ccm doctor            Diagnose local session-data issues
  ccm handoff [session] Print a compact continuation packet (picker if no session given)
  ccm resume [session]  Pick a session, or resume by full ID or unambiguous prefix
  ccm search <query>    Search sessions by metadata; add --deep to search content
  ccm usage [action]    Show observed usage or configure its feed; toggle on/off
  ccm link [path]       Link a project to shared session storage (picker if no path)
  ccm unlink [path]     Restore a project to local session storage
  ccm memory [action]   Manage shared session storage across devices
  ccm config [cmd]      Read or write user preferences
  ccm completion <shell> Print shell completion setup
  ccm --version         Print version
  ccm --help            Show this help
`.trim()

// -----------------------------------------------------------------------------
// Command dispatch
// -----------------------------------------------------------------------------

export async function runCli(commandLineArguments = process.argv.slice(2)): Promise<void> {
  const [command, ...commandArguments] = commandLineArguments

  switch (command) {
    case '--version':
    case '-v':
      console.log(APP.version)
      return

    case '--help':
    case '-h':
      console.log(CLI_HELP)
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

    case 'link': {
      const { runMemoryCommand } = await import('./memory-command.js')
      await runMemoryCommand(['link', ...commandArguments])
      return
    }

    case 'unlink': {
      const { runMemoryCommand } = await import('./memory-command.js')
      await runMemoryCommand(['unlink', ...commandArguments])
      return
    }

    case 'memory': {
      const { runMemoryCommand } = await import('./memory-command.js')
      await runMemoryCommand(commandArguments)
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
  const { guardOfflineLinks } = await import('./memory-command.js')
  await guardOfflineLinks()
  const { runTUI } = await import('../tui/App.js')
  const resumeTarget = await runTUI()
  if (!resumeTarget) return

  process.chdir(resumeTarget.projectPath)
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
