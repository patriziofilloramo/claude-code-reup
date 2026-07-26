import { PREF_SPECS } from '../core/user-prefs.js'
import { failCommand, writeStyledOutput } from './output.js'

const CONFIG_KEYS = Object.entries(PREF_SPECS)
  .map(([key, spec]) => `  ${key.padEnd(20)} ${spec.description} (${spec.values.join(', ')})`)
  .join('\n')

const MAIN_HELP_FULL_MIN_WIDTH = 64

interface MainHelpRow {
  command: string
  description: string
  note?: string
}

interface MainHelpSection {
  title: string
  rows: MainHelpRow[]
}

const MAIN_HELP_SECTIONS: MainHelpSection[] = [
  {
    title: 'Interfaces',
    rows: [
      { command: 'reup', description: 'Open terminal UI', note: 'default' },
      { command: 'reup web', description: 'Open browser UI' },
    ],
  },
  {
    title: 'Sessions',
    rows: [
      { command: 'reup resume [id]', description: 'Resume a session' },
      {
        command: 'reup list [query]',
        description: 'List sessions',
        note: '--json for machine-readable',
      },
      { command: 'reup search <query>', description: 'Search session metadata or content' },
      { command: 'reup touched [path]', description: 'Find sessions that edited a file' },
      { command: 'reup inbox', description: 'Show sessions needing attention' },
      { command: 'reup handoff [id]', description: 'Create a continuation packet' },
    ],
  },
  {
    title: 'Maintenance',
    rows: [
      { command: 'reup cleanup', description: 'Review stale or empty sessions' },
      { command: 'reup doctor', description: 'Diagnose local session data' },
      { command: 'reup usage [action]', description: 'Monitor Claude usage limits' },
      { command: 'reup attention [action]', description: 'Alerts when a session needs input' },
    ],
  },
  {
    title: 'Configuration',
    rows: [
      { command: 'reup config', description: 'Open configuration panel' },
      { command: 'reup completion <shell>', description: 'Print shell completion setup' },
    ],
  },
  {
    title: 'Options',
    rows: [
      { command: '-h, --help', description: 'Show help' },
      { command: '-v, --version', description: 'Show version' },
    ],
  },
]

const COMMAND_HELP: Readonly<Record<string, string>> = {
  cleanup: `reup cleanup - review and archive stale sessions

Usage:
  reup cleanup
  reup cleanup --dry-run

Candidate rules:
  empty       No messages
  trivial     Two messages or fewer
  orphaned    Project path no longer exists
  expired     More than 30 days old
  stale       Inactive more than 90 days and short

Options:
  --dry-run  Preview candidates without archiving

Interactive cleanup never archives a session without confirmation.`,

  completion: `reup completion - configure shell completion

Usage:
  reup completion <shell>

Shells:
  powershell
  bash
  zsh

Prints session-ID completion for reup resume and reup handoff.
Run without a shell in an interactive terminal to open the Integrations panel.`,

  config: `reup config - manage persistent settings

Usage:
  reup config
  reup config get [key]
  reup config set <key> <value>
  reup config reset [key]

Keys:
${CONFIG_KEYS}

Run without arguments to open the interactive configuration panel.
The compatibility shortcut reup --theme <dark|light|terminal> remains supported.`,

  doctor: `reup doctor - diagnose local session data

Usage:
  reup doctor

Runs non-destructive health checks for broken indices, stale locks,
orphaned transcripts, missing paths, and sessions nearing Claude cleanup.
Every finding includes why it matters and the suggested next step.`,

  handoff: `reup handoff - create a continuation packet

Usage:
  reup handoff [session-id-or-prefix]

Prints a compact Markdown summary grounded in the selected session transcript.`,

  inbox: `reup inbox - show sessions needing attention

Usage:
  reup inbox

Lists active sessions and non-archived sessions with actionable signals.`,

  list: `reup list - list sessions across projects

Usage:
  reup list [query] [options]

Options:
  --active             Show active sessions only
  --archived           Show archived sessions only
  --attention          Show sessions needing attention
  --json               Emit machine-readable JSON
  --limit <count>      Limit the number of results
  --project <query>    Filter by project
  --status <status>    Filter by derived status
  --tag <name>         Filter by session or project tag
  --group <name>       Filter by project group
  --stack <name>       Filter by work stack`,

  resume: `reup resume - resume a Claude Code session

Usage:
  reup resume [session-id-or-prefix]

Run without a selector in an interactive terminal to open the ranked session picker.`,

  search: `reup search - search and resume sessions

Usage:
  reup search [--deep] <query>

Options:
  --deep  Search transcript content instead of session metadata`,

  touched: `reup touched - find sessions that edited a file

Usage:
  reup touched [path] [options]

With a path, lists which sessions wrote or edited a file whose path matches it,
reading the write events Claude Code already recorded in each transcript.
Matching is case-insensitive and ignores path-separator style, so a fragment
like "session-query" or "core/session" both work.

With no path, opens an interactive picker of files edited in the current
project; pick one to see the sessions that touched it and resume.

Options:
  --archived       Include archived sessions in the lookup
  --json           Emit machine-readable JSON
  --limit <count>  Limit the number of results`,

  attention: `reup attention - alerts when a session waits for your input

Usage:
  reup attention [status]
  reup attention setup
  reup attention remove

setup registers reversible Claude Code hooks (Notification, UserPromptSubmit,
Stop) so Reup hears the moment a session needs a permission decision or sits
waiting for input, and knows exactly when turns start and finish - including
for VS Code sessions whose lock files carry no status. The web live strip pins
waiting sessions in red and can raise desktop notifications; the TUI marks
them and rings the terminal bell. remove restores the previous hook
configuration exactly and clears stored alerts.`,

  usage: `reup usage - monitor Claude usage limits

Usage:
  reup usage
  reup usage --json
  reup usage setup [--replace]
  reup usage remove

Usage is shown by default where available. setup/remove manage the optional
Claude Code status-line capture hook; --json emits the same summary for tools.`,

  web: `reup web - open the local browser interface

Usage:
  reup web [--port <port>]

The web server listens on localhost only.`,
}

/** Returns true only for a conventional, standalone help flag. */
export function isHelpRequest(commandArguments: string[]): boolean {
  return commandArguments.length === 1 && ['--help', '-h'].includes(commandArguments[0]!)
}

/** Builds the concise product-level command map shown by `reup --help`. */
export function renderMainHelp(
  useColor = process.stdout.isTTY === true,
  terminalWidth = process.stdout.columns || 80
): string {
  const bold = (text: string) => (useColor ? `\x1b[1m${text}\x1b[0m` : text)
  const dim = (text: string) => (useColor ? `\x1b[2m${text}\x1b[0m` : text)
  const compact = terminalWidth < MAIN_HELP_FULL_MIN_WIDTH

  function fullRow(row: MainHelpRow): string {
    return `  ${row.command.padEnd(28)}  ${row.description}${row.note ? dim(`  (${row.note})`) : ''}`
  }

  function compactRows(section: MainHelpSection): string[] {
    return [bold(section.title), ...section.rows.map((row) => `  ${row.command}`)]
  }

  if (compact) {
    return [
      bold('reup'),
      '',
      ...MAIN_HELP_SECTIONS.flatMap((section, index) => [
        ...(index === 0 ? [] : ['']),
        ...compactRows(section),
      ]),
      '',
      dim('Run `reup help <command>` for details.'),
    ].join('\n')
  }

  return [
    `${bold('reup')} - session manager for Claude Code`,
    '',
    ...MAIN_HELP_SECTIONS.flatMap((section, index) => [
      ...(index === 0 ? [] : ['']),
      bold(section.title),
      ...section.rows.map(fullRow),
    ]),
    '',
    dim('Run `reup help <command>` or `reup <command> --help` for details.'),
  ].join('\n')
}

/** Handles the public `reup help [command]` interface. */
export function runHelpCommand(commandArguments: string[]): void {
  if (commandArguments.length === 0 || isHelpRequest(commandArguments)) {
    writeStyledOutput(renderMainHelp())
    return
  }

  if (commandArguments.length !== 1) {
    failCommand('usage: reup help [command]')
    return
  }

  const command = commandArguments[0]!
  const help = COMMAND_HELP[command]
  if (!help) {
    failCommand(`no help topic for: ${command}`)
    return
  }

  writeStyledOutput(help)
}
