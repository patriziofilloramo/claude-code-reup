import { PREF_SPECS } from '../core/user-prefs.js'
import { failCommand, writeOutput } from './output.js'

const CONFIG_KEYS = Object.entries(PREF_SPECS)
  .map(([key, spec]) => `  ${key.padEnd(20)} ${spec.description} (${spec.values.join(', ')})`)
  .join('\n')

const COMMAND_HELP: Readonly<Record<string, string>> = {
  cleanup: `ccm cleanup - review and archive stale sessions

Usage:
  ccm cleanup
  ccm cleanup --dry-run

Candidate rules:
  empty       No messages
  trivial     Two messages or fewer
  orphaned    Project path no longer exists
  expired     More than 30 days old
  stale       Inactive more than 90 days and short

Options:
  --dry-run  Preview candidates without archiving

Interactive cleanup never archives a session without confirmation.`,

  completion: `ccm completion - configure shell completion

Usage:
  ccm completion <shell>

Shells:
  powershell
  bash
  zsh

Prints session-ID completion for ccm resume and ccm handoff.
Run without a shell in an interactive terminal to open the Integrations panel.`,

  config: `ccm config - manage persistent settings

Usage:
  ccm config
  ccm config get [key]
  ccm config set <key> <value>
  ccm config reset [key]

Keys:
${CONFIG_KEYS}

Run without arguments to open the interactive configuration panel.
The compatibility shortcut ccm --theme <dark|light|terminal> remains supported.`,

  doctor: `ccm doctor - diagnose local session data

Usage:
  ccm doctor

Runs non-destructive health checks. CCM never repairs Claude-owned files automatically.`,

  handoff: `ccm handoff - create a continuation packet

Usage:
  ccm handoff [session-id-or-prefix]

Prints a compact Markdown summary grounded in the selected session transcript.`,

  inbox: `ccm inbox - show sessions needing attention

Usage:
  ccm inbox

Lists active sessions and non-archived sessions with actionable signals.`,

  list: `ccm list - list sessions across projects

Usage:
  ccm list [query] [options]

Options:
  --active             Show active sessions only
  --archived           Show archived sessions only
  --attention          Show sessions needing attention
  --json               Emit machine-readable JSON
  --limit <count>      Limit the number of results
  --project <query>    Filter by project
  --status <status>    Filter by derived status`,

  resume: `ccm resume - resume a Claude Code session

Usage:
  ccm resume [session-id-or-prefix]

Run without a selector in an interactive terminal to open the ranked session picker.`,

  search: `ccm search - search and resume sessions

Usage:
  ccm search [--deep] <query>

Options:
  --deep  Search transcript content instead of session metadata`,

  sync: `ccm sync - manage shared session storage (experimental)

Usage:
  ccm sync
  ccm sync link [project-path]
  ccm sync unlink [project-path]

Moves session storage into the project and links Claude Code to it, allowing an
existing file-sync provider to carry sessions across devices. Back up session
data before enabling this experimental feature.`,

  usage: `ccm usage - monitor Claude usage limits

Usage:
  ccm usage
  ccm usage --json
  ccm usage toggle
  ccm usage setup [--replace]
  ccm usage remove

Usage capture is local, optional, and reversible.`,

  web: `ccm web - open the local browser interface

Usage:
  ccm web [--port <port>]

The web server listens on localhost only.`,
}

/** Returns true only for a conventional, standalone help flag. */
export function isHelpRequest(commandArguments: string[]): boolean {
  return commandArguments.length === 1 && ['--help', '-h'].includes(commandArguments[0]!)
}

/** Builds the concise product-level command map shown by `ccm --help`. */
export function renderMainHelp(useColor = process.stdout.isTTY === true): string {
  const bold = (text: string) => (useColor ? `\x1b[1m${text}\x1b[0m` : text)
  const dim = (text: string) => (useColor ? `\x1b[2m${text}\x1b[0m` : text)

  function row(command: string, description: string, note?: string): string {
    return `  ${command.padEnd(28)}  ${description}${note ? dim(`  (${note})`) : ''}`
  }

  return [
    `${bold('ccm')} - session manager for Claude Code`,
    '',
    bold('Interfaces'),
    row('ccm', 'Open terminal UI', 'default'),
    row('ccm web', 'Open browser UI'),
    '',
    bold('Sessions'),
    row('ccm resume [id]', 'Resume a session'),
    row('ccm list [query]', 'List sessions', '--json for machine-readable'),
    row('ccm search <query>', 'Search session metadata or content'),
    row('ccm inbox', 'Show sessions needing attention'),
    row('ccm handoff [id]', 'Create a continuation packet'),
    '',
    bold('Maintenance'),
    row('ccm cleanup', 'Review stale or empty sessions'),
    row('ccm doctor', 'Diagnose local session data'),
    row('ccm usage [action]', 'Monitor Claude usage limits'),
    '',
    bold('Configuration'),
    row('ccm config', 'Open configuration panel'),
    row('ccm completion <shell>', 'Print shell completion setup'),
    '',
    bold('Experimental'),
    row('ccm sync [link|unlink] [path]', 'Manage shared session storage'),
    '',
    bold('Options'),
    row('-h, --help', 'Show help'),
    row('-v, --version', 'Show version'),
    '',
    dim('Run `ccm help <command>` or `ccm <command> --help` for details.'),
  ].join('\n')
}

/** Handles the public `ccm help [command]` interface. */
export function runHelpCommand(commandArguments: string[]): void {
  if (commandArguments.length === 0 || isHelpRequest(commandArguments)) {
    writeOutput(renderMainHelp())
    return
  }

  if (commandArguments.length !== 1) {
    failCommand('usage: ccm help [command]')
    return
  }

  const command = commandArguments[0]!
  const help = COMMAND_HELP[command]
  if (!help) {
    failCommand(`no help topic for: ${command}`)
    return
  }

  writeOutput(help)
}
