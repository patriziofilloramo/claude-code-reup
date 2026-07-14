# Reup

Local state and resume control for Claude Code work.

Reup shows what is active, stale, risky, archived, or ready to resume across
your local Claude Code sessions. It runs against Claude Code files on your
machine: no Reup account, no hosted backend, no telemetry, and no transcript
upload.

## Install

The first public release is distributed from GitHub Releases. Pick the artifact
for your platform, verify it, install it, then run `reup`.

| Platform | Artifact                      | Notes                                                          |
| -------- | ----------------------------- | -------------------------------------------------------------- |
| Windows  | `reup-setup-windows-x64.exe`  | Signed installer, per-user install, adds `reup` to PATH        |
| macOS    | `reup-macos-universal.tar.gz` | Signed and notarized archive                                   |
| Linux    | `.deb`, `.rpm`, `.tar.gz`     | Package install where possible; tarball for portable use       |
| VS Code  | `reup-vscode-<version>.vsix`  | Install from the Extensions view or `code --install-extension` |

Each release should include:

- SHA-256 checksums for every artifact.
- Detached signatures for release assets.
- SBOM and provenance attestations.
- Release notes with upgrade and rollback notes.

Verify a download before installing:

```bash
sha256sum -c SHA256SUMS.txt
```

Power users and contributors can still build from source:

```bash
git clone <repository-url> reup
cd reup
npm install
npm run build
npm link
reup
```

## Daily Commands

| Command                   | What it does                                        |
| ------------------------- | --------------------------------------------------- |
| `reup`                    | Open the terminal UI                                |
| `reup web`                | Open the local browser dashboard                    |
| `reup resume [session]`   | Resume by ID/prefix, or pick interactively          |
| `reup search <query>`     | Search session metadata                             |
| `reup search --deep <q>`  | Search transcript content on demand                 |
| `reup touched [path]`     | Find sessions that edited a file                    |
| `reup list [query]`       | Print a scriptable session list                     |
| `reup inbox`              | Show active sessions and sessions needing attention |
| `reup handoff [session]`  | Copy a compact continuation packet                  |
| `reup usage`              | Show observed usage and collector freshness         |
| `reup attention [action]` | Desktop/terminal alerts when a session needs input  |
| `reup cleanup`            | Review stale or empty sessions for archiving        |
| `reup doctor`             | Diagnose local Claude Code session data             |
| `reup config`             | Open the configuration TUI                          |
| `reup completion <shell>` | Print shell completion setup                        |
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
Code extension or the integrated terminal.

## Shell Completion

Completion is opt-in and prints exact session IDs only.

PowerShell:

```powershell
reup completion powershell | Out-String | Invoke-Expression
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

Reup reads local Claude Code data and writes Reup-owned metadata only. It does
not manage cloud folders, move transcript storage, or synchronize sessions
between machines in this release.

## Safety

- The web server binds to `127.0.0.1`.
- Resume launches the local `claude` command or the Claude Code VS Code
  extension.
- Usage refresh keeps credentials in memory and stores only aggregate results.
- No telemetry, hosted service, remote sync backend, or account is included.
- Keep your own backups of important projects and transcripts.
- Do not put secrets in handoff packets or shared logs without review.

See also [`DISCLAIMER.md`](DISCLAIMER.md), [`PRIVACY.md`](PRIVACY.md),
[`SECURITY.md`](SECURITY.md), and [`SUPPORT.md`](SUPPORT.md).

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

Local release-candidate artifacts, without official publishing:

```bash
npm run release:local
```

Useful documents:

- [Architecture](Documents/ARCHITECTURE.md)
- [Features](Documents/FEATURES.md)
- [Installation and distribution](Documents/INSTALLATION.md)
- [Deferred Project Memory Sync](Documents/DEFERRED_PROJECT_MEMORY_SYNC.md)
- [Usage visibility](Documents/USAGE_VISIBILITY.md)
- [Product direction](Documents/PRODUCT_DIRECTION.md)
- [VS Code extension](extension/README.md)
- [Roadmap](ROADMAP.md)

## Disclaimer

Reup is an independent open-source project. It is not affiliated with,
endorsed by, or maintained by Anthropic.

Reup is provided as-is, without warranty or SLA. Claude and Claude Code are
trademarks of Anthropic. Claude Code's local storage format is not a stable
public API and may change between releases.

## License

[MIT](LICENSE)
