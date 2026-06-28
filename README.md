# Reup

Reup is local state and resume control for Claude Code work.

It gives terminal-heavy developers one fast way to see which Claude Code
sessions are active, risky, stale, archived, or ready to resume. Everything
runs locally against Claude Code's existing files. There is no Reup account,
backend, telemetry, or transcript upload.

## Install From Source

Reup requires Node.js 20 or newer, Git, and the `claude` command on `PATH`.

```bash
git clone <repository-url> reup
cd reup
npm install
npm run build
npm link
reup
```

On Windows, `npm link` also creates `reup.cmd`. Use it when PowerShell blocks
the npm-generated `reup.ps1` shim:

```powershell
reup.cmd
```

The npm package identity for publishing is `@patriziofilloramo/reup`. The only
public executable is `reup`.

## Daily Commands

| Command                   | What it does                                        |
| ------------------------- | --------------------------------------------------- |
| `reup`                    | Open the terminal UI                                |
| `reup web`                | Open the local browser dashboard                    |
| `reup resume [session]`   | Resume by ID/prefix, or pick interactively          |
| `reup search <query>`     | Search session metadata                             |
| `reup search --deep <q>`  | Search transcript content on demand                 |
| `reup list [query]`       | Print a scriptable session list                     |
| `reup inbox`              | Show active sessions and sessions needing attention |
| `reup handoff [session]`  | Copy a compact continuation packet                  |
| `reup usage`              | Show observed usage and collector freshness         |
| `reup doctor`             | Diagnose local Claude Code session data             |
| `reup config`             | Open the configuration TUI                          |
| `reup completion <shell>` | Print shell completion setup                        |
| `reup sync`               | Manage shared session storage                       |
| `reup help [command]`     | Show CLI help                                       |

`reup list`, `reup resume`, and `reup handoff` accept globally unambiguous
session ID prefixes with a minimum length of eight characters.

## What Reup Shows

- Active Claude Code processes and recently touched sessions.
- Resume safety: missing paths, branch drift, interrupted work, expiry, and
  heavy compaction signals.
- Session titles, aliases, tags, groups, work stacks, branches, model/context
  facts, and message counts.
- Archived sessions when requested. Archiving hides sessions in Reup only; it
  does not rename or delete Claude Code transcripts.
- Optional usage visibility for local status-line observations plus account
  limit percentages where Claude Code exposes them locally.
- A compact handoff packet for continuing work without reopening every
  transcript.

Signals are inferred from local files and should be treated as guidance, not a
guarantee that a session is safe or complete.

## Interfaces

The terminal UI is the default surface. It is keyboard-first and optimized for
quick scanning, filtering, and resuming.

The local web dashboard runs on `127.0.0.1`:

```bash
reup web
reup web --port 4000
```

The VS Code extension adds a Reup Activity Bar view, full dashboard, session
inspector, workspace-first resume picker, and resume through either the Claude
Code extension or the integrated terminal:

```bash
npm run install:extension
```

## Shell Completion

Completion is opt-in and prints exact session IDs only.

PowerShell:

```powershell
reup.cmd completion powershell | Out-String | Invoke-Expression
```

Bash:

```bash
source <(reup completion bash)
```

Zsh:

```bash
source <(reup completion zsh)
```

Append the generated output to your shell profile if you want completion in new
terminals.

## Configuration

| Variable            | Default     | Description                           |
| ------------------- | ----------- | ------------------------------------- |
| `CLAUDE_CONFIG_DIR` | `~/.claude` | Claude Code data directory            |
| `REUP_PORT`         | `3333`      | Preferred local web port              |
| `REUP_NO_OPEN`      | unset       | Do not open the browser automatically |
| `REUP_DEBUG`        | unset       | Enable debug logging                  |
| `REUP_THEME`        | stored pref | Override the active theme             |

Old pre-production environment variables are read only as silent migration
fallbacks. New writes and documentation use `REUP_*`.

## Local Data

Claude Code owns transcript storage under:

```text
~/.claude/projects/
```

Reup stores its own user-level data under:

```text
~/.claude/reup/
```

Per-project Reup metadata lives beside Claude Code transcripts as:

```text
~/.claude/projects/<project-id>/reup.json
```

Existing pre-production Reup users are migrated automatically:

- `~/.claude/reup/` is created from the old private app directory when needed.
- `reup.json` is copied from the old sidecar file if the new file is absent.
- `.reup-link`, `.reup-conflicts`, and `<!-- reup:sync:start/end -->` are the
  current sync artifacts, with old artifact names recognized during migration.
- Browser storage and VS Code settings are rewritten under `reup:*` and
  `reup.*` keys.

Legacy files are left in place for rollback. Reup writes new state to the new
paths.

## Shared Session Storage

`reup sync` can link a project so Claude Code sessions travel with that
project through your existing cloud provider.

```bash
reup sync
reup sync link
reup sync link ~/projects/my-app
reup sync unlink
```

The linked project stores session data in `<project>/.claude-memory/`. Reup
uses a junction or symlink from Claude Code's local project directory to that
folder, maintains a local backup under `~/.claude/reup/sync/`, and restores
local writeability when the cloud folder goes offline.

`.claude-memory/` contains session transcripts. Keep it out of Git unless you
explicitly want that data versioned.

## Safety

- Reup reads local Claude Code data and writes only Reup-owned metadata.
- The web server binds to `127.0.0.1`.
- Resume launches the local `claude` command or the Claude Code VS Code
  extension.
- Usage refresh keeps credentials in memory and stores only aggregate results.
- No telemetry, hosted service, or remote sync backend is included.

## Development

```bash
npm install
npm run build:client
npm run build
npm run build:extension
npm test
npm run lint
npm run format:check
```

Useful documents:

- [Architecture](Documents/ARCHITECTURE.md)
- [Features](Documents/FEATURES.md)
- [Installation and distribution](Documents/INSTALLATION.md)
- [Cross-device Project Memory](Documents/CROSS_DEVICE_PROJECT_MEMORY.md)
- [Usage visibility](Documents/USAGE_VISIBILITY.md)
- [Product direction](Documents/PRODUCT_DIRECTION.md)
- [VS Code extension](extension/README.md)
- [Roadmap](ROADMAP.md)

## Disclaimer

Reup is an independent open-source project. It is not affiliated with,
endorsed by, or maintained by Anthropic.

Claude and Claude Code are trademarks of Anthropic. Claude Code's local storage
format is not a stable public API and may change between releases. Keep backups
of important work and review release notes before upgrading.

## License

[MIT](LICENSE)
