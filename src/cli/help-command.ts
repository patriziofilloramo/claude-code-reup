import { PREF_SPECS } from '../core/user-prefs.js'
import { failCommand, writeOutput } from './output.js'

const CONFIG_KEYS = Object.entries(PREF_SPECS)
  .map(([key, spec]) => `  ${key.padEnd(20)} ${spec.description} (${spec.values.join(', ')})`)
  .join('\n')

const COMMAND_HELP: Readonly<Record<string, string>> = {
  cleanup: `swoop cleanup - review and archive stale sessions

Usage:
  swoop cleanup
  swoop cleanup --dry-run

Candidate rules:
  empty       No messages
  trivial     Two messages or fewer
  orphaned    Project path no longer exists
  expired     More than 30 days old
  stale       Inactive more than 90 days and short

Options:
  --dry-run  Preview candidates without archiving

Interactive cleanup never archives a session without confirmation.`,

  completion: `swoop completion - configure shell completion

Usage:
  swoop completion <shell>

Shells:
  powershell
  bash
  zsh

Prints session-ID completion for swoop resume and swoop handoff.
Run without a shell in an interactive terminal to open the Integrations panel.`,

  config: `swoop config - manage persistent settings

Usage:
  swoop config
  swoop config get [key]
  swoop config set <key> <value>
  swoop config reset [key]

Keys:
${CONFIG_KEYS}

Run without arguments to open the interactive configuration panel.
The compatibility shortcut swoop --theme <dark|light|terminal> remains supported.`,

  doctor: `swoop doctor - diagnose local session data

Usage:
  swoop doctor

Runs non-destructive health checks. Swoop never repairs Claude-owned files automatically.`,

  handoff: `swoop handoff - create a continuation packet

Usage:
  swoop handoff [session-id-or-prefix]

Prints a compact Markdown summary grounded in the selected session transcript.`,

  inbox: `swoop inbox - show sessions needing attention

Usage:
  swoop inbox

Lists active sessions and non-archived sessions with actionable signals.`,

  list: `swoop list - list sessions across projects

Usage:
  swoop list [query] [options]

Options:
  --active             Show active sessions only
  --archived           Show archived sessions only
  --attention          Show sessions needing attention
  --json               Emit machine-readable JSON
  --limit <count>      Limit the number of results
  --project <query>    Filter by project
  --status <status>    Filter by derived status`,

  resume: `swoop resume - resume a Claude Code session

Usage:
  swoop resume [session-id-or-prefix]

Run without a selector in an interactive terminal to open the ranked session picker.`,

  search: `swoop search - search and resume sessions

Usage:
  swoop search [--deep] <query>

Options:
  --deep  Search transcript content instead of session metadata`,

  sync: `swoop sync - manage shared session storage (experimental)

Usage:
  swoop sync
  swoop sync link [project-path]
  swoop sync link --all-cloud
  swoop sync unlink [project-path]
  swoop sync unlink --all
  swoop sync status

Moves session storage into the project and links Claude Code to it, allowing an
existing file-sync provider to carry sessions across devices. Back up session
data before enabling this experimental feature.`,

  usage: `swoop usage - monitor Claude usage limits

Usage:
  swoop usage
  swoop usage --json
  swoop usage toggle
  swoop usage setup [--replace]
  swoop usage remove

Usage capture is local, optional, and reversible.`,

  web: `swoop web - open the local browser interface

Usage:
  swoop web [--port <port>]

The web server listens on localhost only.`,
}

/** Returns true only for a conventional, standalone help flag. */
export function isHelpRequest(commandArguments: string[]): boolean {
  return commandArguments.length === 1 && ['--help', '-h'].includes(commandArguments[0]!)
}

/** Builds the concise product-level command map shown by `swoop --help`. */
export function renderMainHelp(useColor = process.stdout.isTTY === true): string {
  const bold = (text: string) => (useColor ? `\x1b[1m${text}\x1b[0m` : text)
  const dim = (text: string) => (useColor ? `\x1b[2m${text}\x1b[0m` : text)

  function row(command: string, description: string, note?: string): string {
    return `  ${command.padEnd(28)}  ${description}${note ? dim(`  (${note})`) : ''}`
  }

  return [
    `${bold('swoop')} - session manager for Claude Code`,
    '',
    bold('Interfaces'),
    row('swoop', 'Open terminal UI', 'default'),
    row('swoop web', 'Open browser UI'),
    '',
    bold('Sessions'),
    row('swoop resume [id]', 'Resume a session'),
    row('swoop list [query]', 'List sessions', '--json for machine-readable'),
    row('swoop search <query>', 'Search session metadata or content'),
    row('swoop inbox', 'Show sessions needing attention'),
    row('swoop handoff [id]', 'Create a continuation packet'),
    '',
    bold('Maintenance'),
    row('swoop cleanup', 'Review stale or empty sessions'),
    row('swoop doctor', 'Diagnose local session data'),
    row('swoop usage [action]', 'Monitor Claude usage limits'),
    '',
    bold('Configuration'),
    row('swoop config', 'Open configuration panel'),
    row('swoop completion <shell>', 'Print shell completion setup'),
    '',
    bold('Experimental'),
    row('swoop sync [link|unlink|status] [path]', 'Manage shared session storage'),
    '',
    bold('Options'),
    row('-h, --help', 'Show help'),
    row('-v, --version', 'Show version'),
    '',
    dim('Run `swoop help <command>` or `swoop <command> --help` for details.'),
  ].join('\n')
}

/** Handles the public `swoop help [command]` interface. */
export function runHelpCommand(commandArguments: string[]): void {
  if (commandArguments.length === 0 || isHelpRequest(commandArguments)) {
    writeOutput(renderMainHelp())
    return
  }

  if (commandArguments.length !== 1) {
    failCommand('usage: swoop help [command]')
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
