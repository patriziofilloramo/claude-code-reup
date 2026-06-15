<div align="center">

# ccm

**Your continuity inbox for Claude Code.**

Browse every local session, understand what needs attention, and resume the
right thread from any project.

`TUI` · `Local web UI` · `Cross-platform` · `No cloud`

[Quick start](#quick-start) · [Features](#features) ·
[How it works](#how-it-works) · [Safety](#safety--privacy)

</div>

---

<!-- Screenshots: assets/tui.png and assets/web.png not yet captured. -->

## Why ccm?

Claude Code already includes a capable session picker. `ccm` complements it
when you work across many projects and need more context before resuming.

It gives you one local view of your Claude Code sessions, including branch
context, activity state, session health signals, aliases, and locally archived
sessions.

Use it when the question is not only _"Which session was it?"_, but also
_"What happened there, and should I resume it?"_

---

## Features

- **Global local-session view** — browse Claude Code sessions across projects from any directory.
- **Terminal and web interfaces** — use the keyboard-first TUI or the local browser dashboard.
- **Useful session context** — see branch, last activity, message count, and active-session indicators.
- **Model and context visibility** — see the latest recorded model and context-input size per session.
- **Live usage awareness** — optionally surface current context plus 5-hour and 7-day limits.
- **Session health signals** — surface interrupted, expiring, missing-path, and heavily compacted sessions.
- **Aliases and local archive** — rename sessions for display and hide old sessions without modifying transcript filenames.
- **One-action resume** — launch the selected session in its recorded working directory.
- **Deep transcript search** — scan every session transcript for keywords (`ccm search --deep`, TUI `tab`, or the web UI ⌕ button).
- **Composable CLI** — inspect the inbox, diagnose local data, export JSON, and create handoffs.
- **CLAUDE.md editor** — view and edit each project's instruction file from the web UI.
- **Shared session storage** — link any project so sessions travel with the repo via cloud storage.
- **Local-first** — no account, cloud service, or telemetry.

---

## Quick start

### Requirements

- [Node.js](https://nodejs.org/) 20 or newer
- [Claude Code](https://claude.ai/code) installed and available as `claude`
- Git

### macOS and Linux

```bash
git clone <repository-url>
cd claude-sessions-manager
npm install
npm run build
npm link

ccm
```

### Windows (PowerShell)

```powershell
git clone <repository-url>
Set-Location claude-sessions-manager
npm install
npm run build
npm link

ccm
```

Open the browser interface with:

```bash
ccm web
```

---

## Usage

| Command                  | Description                                                                |
| ------------------------ | -------------------------------------------------------------------------- |
| `ccm`                    | Open the terminal interface                                                |
| `ccm web`                | Open the local browser interface                                           |
| `ccm web --port 4000`    | Use a custom port                                                          |
| `ccm resume [session]`   | Pick a session, or resume by ID/prefix                                     |
| `ccm search <query>`     | Interactive session picker with pre-filled query                           |
| `ccm search --deep <q>`  | Full-text search inside transcript content                                 |
| `ccm list [query]`       | Print a compact, globally filtered session list                            |
| `ccm inbox`              | Show active sessions and sessions at risk                                  |
| `ccm handoff [session]`  | Export a compact Markdown continuation packet (picker if no session given) |
| `ccm usage`              | Show observed usage and feed freshness                                     |
| `ccm usage toggle`       | Enable or disable local usage capture                                      |
| `ccm usage setup`        | Enable reversible local usage capture                                      |
| `ccm doctor`             | Diagnose local session-data issues                                         |
| `ccm config`             | Open the interactive configuration panel                                   |
| `ccm completion <shell>` | Print PowerShell, Bash, or Zsh completion setup                            |
| `ccm sync`               | Manage shared session storage _(experimental)_                             |
| `ccm help [command]`     | Show general or command-specific CLI help                                  |
| `ccm --help`             | Show CLI help                                                              |
| `ccm --version`          | Show the installed version                                                 |

`ccm list` prints a compact table and excludes archived sessions by default.
Free text searches globally across project/session names and paths, aliases,
branches, models, statuses, and session IDs. Filters combine with `AND`
semantics:

The `ID PREFIX` column shows the shortest globally unambiguous session-ID
prefix, with a minimum length of eight characters. It may be passed directly to
`ccm resume` or `ccm handoff`; CCM expands it to an exact ID and refuses
ambiguous prefixes.

| List option         | Effect                                  |
| ------------------- | --------------------------------------- |
| `--json`            | Emit the full, versioned JSON document  |
| `--active`          | Show only active sessions               |
| `--attention`       | Show only sessions with a non-OK status |
| `--archived`        | Show only archived sessions             |
| `--project <query>` | Match project name, ID, or path         |
| `--status <status>` | Match one exact session status          |
| `--limit <count>`   | Limit the number of results             |

Examples:

```bash
ccm list
ccm list release --active
ccm list --attention --project claude-ccm
ccm list --archived --limit 20
ccm list --json --status interrupted | jq '.sessions[]'
```

`ccm handoff` accepts a full session ID or an unambiguous prefix of at least
eight characters. It extracts the latest human goal, available transcript
summary, recent assistant context, edited-file paths, and open Claude todos.
Unavailable facts are marked as such rather than inferred.

Run `ccm resume` without an ID to open a compact global picker. Sessions from
the current project appear first, followed by active sessions and recent
activity. Use `/` to search across session and project fields.

### Live usage

Enable CCM's account-limit refresh and session-detail collector explicitly:

```bash
ccm usage setup
```

CCM refreshes account limits at most once every 30 seconds using the same
authenticated read-only usage endpoint as Claude Code. TUI and web read the
local aggregate cache immediately and check it every five seconds. Failed
refreshes are shown as cached rather than live.

The status-line integration separately supplies model, agent, and context
details when a Claude Code terminal emits them. Claude for VS Code may not emit
those session details, but account limits continue to refresh independently.

If a status line already exists, CCM refuses to modify it unless replacement is
explicit:

```bash
ccm usage setup --replace
```

The previous value is preserved exactly and restored with:

```bash
ccm usage remove
```

CCM reads Claude Code's local OAuth access token only in memory for the
authenticated request. It never logs or copies credentials. Stored data is
limited to aggregate account limits in `~/.claude/ccm/account-usage.json` and
one aggregate session snapshot per observed terminal session under
`~/.claude/ccm/usage/`. Removing capture deletes both caches. See
[Usage visibility](Documents/USAGE_VISIBILITY.md) for trust and availability
details.

### Shell completion

Shells do not discover completions from Node.js commands automatically. Enable
session-ID completion for `ccm resume` and `ccm handoff` explicitly:

PowerShell, for the current shell:

```powershell
ccm.cmd completion powershell | Out-String | Invoke-Expression
```

`ccm.cmd` bypasses the npm PowerShell shim when local execution policy blocks
`ccm.ps1`. The registered completer works for both `ccm` and `ccm.cmd`.

PowerShell, persistently:

```powershell
ccm.cmd completion powershell | Add-Content $PROFILE
. $PROFILE
```

Bash or Zsh, for the current shell:

```bash
source <(ccm completion bash)
source <(ccm completion zsh)
```

Append the matching output to `~/.bashrc` or `~/.zshrc` to keep completion
enabled in new shells. Completion returns exact IDs only and prioritizes the
current project, active sessions, and recent activity. It does not expose
session titles or transcript content.

### TUI keys

| Key           | Action                           |
| ------------- | -------------------------------- |
| `↑` `↓`       | Navigate list                    |
| `←` `→` `tab` | Switch panel (normal mode)       |
| `/`           | Search sessions                  |
| `tab`         | Deep search (while searching)    |
| `a`           | Toggle archived sessions         |
| `space`       | Project action menu              |
| `enter`       | Expand project / preview session |
| `esc`         | Back / quit                      |
| `q`           | Quit                             |

### Web UI

Open with `ccm web`. The browser interface mirrors the TUI feature set with a few additions:

| Feature                | How to access                                                          |
| ---------------------- | ---------------------------------------------------------------------- |
| Browse sessions        | Click any project in the left panel                                    |
| Resume session         | Double-click a session row, or select and press `enter`                |
| Deep transcript search | Click **⌕ deep search** in the header                                  |
| Start new session      | Select a project, then click **+ new**                                 |
| Edit CLAUDE.md         | Select a project — click the **CLAUDE.md** tag when it appears         |
| Live usage limits      | Shown in the header; auto-refreshes every 5 seconds                    |
| Keyboard nav           | `/` search · `j`/`k` or `↑`/`↓` sessions · `[`/`]` or `h`/`l` projects |

---

## Advanced

### Shared session storage

By default, Claude Code stores session transcripts in `~/.claude/projects/`, which is local to each machine.
`ccm sync link` moves a project's sessions into `.claude-memory/` inside the project directory itself, then redirects
Claude Code's storage there via a filesystem junction (Windows) or symlink (macOS/Linux). Any cloud folder that
syncs the project — OneDrive, pCloud, Dropbox, Google Drive — will carry the sessions along with it.

```bash
# Link the current project (interactive picker filtered to cloud folders)
ccm sync link

# Link a specific project path
ccm sync link ~/projects/my-app

# Open the interactive sync panel
ccm sync

# Restore a project to local-only storage
ccm sync unlink
```

To use sessions on a second machine:

1. Ensure the project folder is already synced and available locally.
2. Run `ccm sync link <path>` on the new machine — if `~/.claude/projects/` has no entry yet,
   CCM computes the expected ID from the path and creates the redirect automatically.

Linked projects show a `☁` indicator in the TUI and web project list.

> **Note:** `.claude-memory/` contains your full session transcripts. Ensure your cloud
> provider's sync is healthy before switching machines to avoid losing in-progress sessions.
> The folder is created inside the project root, so add `.claude-memory/` to `.gitignore`
> if you do not want session data in version control.
> CCM propagates append-only extensions automatically. If both machines modify the same file
> independently, sync stops and preserves both copies until the conflict is resolved.

---

## Session signals

`ccm` derives health signals from local transcript metadata. Signals are
guidance, not guarantees.

| Signal            | Meaning                                                                  |
| ----------------- | ------------------------------------------------------------------------ |
| Active            | A live Claude Code process currently references the session              |
| Interrupted       | The session appears to have stopped around a failed or pending tool call |
| Expiring          | The transcript is approaching Claude Code's default cleanup window       |
| Path missing      | The recorded working directory no longer exists                          |
| Heavily compacted | The conversation has crossed several compaction boundaries               |

Archiving in `ccm` hides a session locally. It does not back up the
transcript or prevent Claude Code from deleting it.

---

## How it works

`ccm` reads the local session transcripts that Claude Code stores under:

```text
~/.claude/projects/
```

If `CLAUDE_CONFIG_DIR` is set, `ccm` uses that location instead.

The TUI runs directly in your terminal. The web interface starts a local server
bound to `127.0.0.1` and opens it in your browser.

Session aliases and archive preferences are stored as CCM sidecar metadata
(`ccm.json`) alongside each project's transcripts. Original transcript
filenames are never renamed.

Model and context-token facts come from the latest observed assistant response
in each analysed transcript. They are local historical snapshots, not live plan
usage. CCM leaves them unavailable when it uses Claude Code's index fast path.
See [Usage visibility](Documents/USAGE_VISIBILITY.md) for source and privacy
details.

---

## Safety & privacy

- All session analysis happens locally.
- `ccm` has no telemetry and does not send session contents to a remote service.
- Optional live-usage capture stores only supported aggregate status-line fields locally.
- The web server binds to `127.0.0.1`.
- Resuming a session launches the locally installed `claude` command.
- The web `CLAUDE.md` editor writes to the selected project's instruction file.
- Session aliases and archive state are stored locally as CCM metadata.

Before using the web editor, keep project files under version control.

---

## Configuration

| Variable            | Default     | Description                           |
| ------------------- | ----------- | ------------------------------------- |
| `CLAUDE_CONFIG_DIR` | `~/.claude` | Claude Code data directory            |
| `CCM_PORT`          | `3333`      | Preferred local web port              |
| `CCM_NO_OPEN`       | unset       | Do not open the browser automatically |
| `CCM_DEBUG`         | unset       | Enable debug logging                  |

`ccm web --port <port>` overrides the port for that run.

---

## Troubleshooting

**`ccm` command not found**
Run `npm link` again from the project directory, then open a new terminal.

**PowerShell reports that `ccm.ps1` cannot be loaded**
Use `ccm.cmd` instead. This runs the same installed CLI without changing your
PowerShell execution policy.

**No sessions appear**
Confirm that Claude Code has created local sessions and that
`CLAUDE_CONFIG_DIR` points to the correct directory.

**Resume opens no terminal**
Run with `CCM_DEBUG=1` and verify that `claude` is available on `PATH`.
When a new terminal cannot be opened, `ccm` copies the resume command to
the clipboard instead.

On Windows: `$env:CCM_DEBUG = "1"; ccm`

**Web UI does not open**
Run `ccm web --port 4000` or set `CCM_NO_OPEN=1` and open the printed
local URL manually.

---

## Development

```bash
npm install
npm run build   # compile TypeScript + copy static assets
npm test        # Vitest
npm run lint    # ESLint
npm run format  # Prettier
```

See [Architecture](Documents/ARCHITECTURE.md) for the implemented system,
[Product direction](Documents/PRODUCT_DIRECTION.md) for the long-term product
principles, [Usage visibility](Documents/USAGE_VISIBILITY.md) for usage-data
trust boundaries, [Installation and distribution](Documents/INSTALLATION.md) for
the native-installer design, and [ROADMAP.md](ROADMAP.md) for planned work.

---

## Roadmap

`ccm` is evolving from a session browser into a continuity inbox for Claude Code
work. Planned areas include prominent usage visibility and focused interface
polish.

See [ROADMAP.md](ROADMAP.md) for current milestones.

---

## Disclaimer

`ccm` is an independent open-source project. It is not affiliated with,
endorsed by, or maintained by Anthropic.

Claude and Claude Code are trademarks of Anthropic. Claude Code's local storage
format is not a stable public API and may change between releases. Keep backups
of important work and review release notes before upgrading.

Session health signals are inferred from local metadata and should be treated as
guidance rather than proof that a session is safe, complete, or recoverable.

---

## License

[MIT](LICENSE)
