# ccm Architecture

This document describes the architecture implemented in the current codebase.
Product plans belong in [`ROADMAP.md`](../ROADMAP.md); user instructions belong
in [`README.md`](../README.md). Native installer behavior is specified in
[`INSTALLATION.md`](INSTALLATION.md).

## Design Constraints

- Local-first: session data stays on the user's machine.
- Lightweight: Node.js 20+, TypeScript, Ink, Hono, and vanilla browser assets.
- Zero required configuration.
- No database, daemon, cloud service, authentication, telemetry, or bundler.
- Claude-owned transcripts are read but never renamed or rewritten.

## Runtime Surfaces

The executable entry point is `src/index.ts`.

| Command                  | Behavior                                              |
| ------------------------ | ----------------------------------------------------- |
| `ccm`                    | Starts the Ink terminal UI                            |
| `ccm web`                | Starts the local Hono server and opens the browser UI |
| `ccm list [query]`       | Prints a filtered table; `--json` emits full records  |
| `ccm inbox`              | Prints active and actionable sessions                 |
| `ccm doctor`             | Runs non-destructive local-data diagnostics           |
| `ccm handoff <session>`  | Prints a transcript-supported continuation packet     |
| `ccm resume [session]`   | Opens a picker, or resumes a full ID/unique prefix    |
| `ccm usage [action]`     | Reads observed usage or configures its local feed     |
| `ccm config`             | Opens the configuration TUI or manages preferences    |
| `ccm completion <shell>` | Prints opt-in shell completion registration           |
| `ccm sync [action]`      | Manages experimental shared session storage           |
| `ccm help [command]`     | Prints general or command-specific help               |
| `ccm --help`             | Prints supported commands                             |
| `ccm --version`          | Prints the current version                            |

The `repair` command is reserved but not implemented.

Machine-readable commands reserve stdout exclusively for their result. Debug,
warning, and error logs use stderr so piping JSON into tools such as `jq`
remains safe even when `CCM_DEBUG=1`.

`ccm list` parses free-text and structured filters once, then applies the same
selection pipeline to its human table and JSON output. Archived sessions are
excluded unless `--archived` is requested. Colour is emitted only for a TTY,
and state text/symbols keep redirected output understandable without colour.
Its human table calculates ID prefixes against every discovered session, so a
prefix remains safe to use even when filters hide a colliding session.

`ccm resume` and `ccm handoff` share the same global prefix-selection rules:
prefixes must contain at least eight characters and resolve to exactly one
session. Without a selector, interactive `ccm resume` opens a compact global
picker. The picker and shell completion share one relevance ranking: sessions
associated with the current working directory first, then active sessions and
recent activity. Shell completion is opt-in because CCM does not modify shell
profiles automatically; its internal completion endpoint returns IDs only.

## Source Layout

```text
src/
  cli/           Script-friendly command implementations and output schemas
  config/        Shared application and theme constants
  core/          Claude paths, session model, discovery, parsing, metadata, launchers
  tui/           Ink controller, pure view helpers, and presentation components
  web/           Hono API helpers, grouped routes, server, and browser application
  utils/         Small logging and time-formatting utilities
tests/
  cli/           Pure command output and schema tests
  core/          Loading, signal, active-session, and lock tests
  tui/           Pure terminal view-model tests
  utils/         Shared utility tests
  web/           Route smoke tests and browser-client regression guards
scripts/
  copy-assets.mjs
```

The build uses `tsc`. `scripts/copy-assets.mjs` copies the three browser source
assets into `dist/web/` after compilation.

## Session Data

Core responsibilities are intentionally separated:

| Module                            | Responsibility                                            |
| --------------------------------- | --------------------------------------------------------- |
| `session-model.ts`                | Shared session types and session-ID validation            |
| `claude-paths.ts`                 | Claude data locations and encoded project-path resolution |
| `project-discovery.ts`            | Project/session discovery and filesystem annotations      |
| `session-transcript.ts`           | JSONL metadata extraction                                 |
| `session-signals.ts`              | Transcript-derived signals and display status             |
| `session-metadata.ts`             | CCM sidecar reads, merges, and queued writes              |
| `project-sidecar-lock.ts`         | Cross-process sidecar lock protocol                       |
| `active-sessions.ts`              | Live Claude process detection                             |
| `diagnostics.ts`                  | Shared non-destructive data-health checks                 |
| `session-handoff.ts`              | Conservative transcript continuation-fact extraction      |
| `live-usage.ts`                   | Aggregate status-line snapshot parsing and persistence    |
| `usage-statusline-integration.ts` | Reversible Claude settings integration                    |
| `sessions.ts`                     | Compatibility re-exports only                             |

Internal consumers import the module that owns a responsibility. `sessions.ts`
also re-exports the original public surface so existing callers remain
compatible.

Claude Code data is read from:

```text
${CLAUDE_CONFIG_DIR:-~/.claude}/
  projects/<project-id>/
    sessions-index.json
    <session-id>.jsonl
  sessions/*.json
```

For each project:

1. Use `sessions-index.json` when it exists and contains sessions.
2. Otherwise scan root session JSONL files and derive metadata.
3. Resolve the canonical path from transcript metadata where available.
4. Check every unique session path for existence.
5. Merge local CCM metadata from `ccm.json`.
6. Sort sessions and projects by most recent update.

The index fast path avoids JSONL analysis. Signals requiring transcript analysis
are therefore `null`, not falsely reported as clean.

## Session Context Metrics

Transcript discovery also records the latest observed Claude model, distinct
model history, context-input tokens, and response-output tokens. These values
live under `Session.context` and are serialized consistently to the web API and
`ccm list --json`.

`latestContextTokens` sums input, cache-creation, and cache-read tokens from the
latest assistant response. It excludes output tokens to match Claude Code's
documented context-percentage semantics. `latestOutputTokens` stores that
response's output separately.

The values are historical transcript facts, not live account limits. On the
index fast path they are `null`, following the same unknown-data rule used by
transcript-derived signals. Live usage architecture and source boundaries are
documented in [`USAGE_VISIBILITY.md`](USAGE_VISIBILITY.md).

## Live Usage

`ccm usage setup` installs a user-level Claude Code status-line command only
after an explicit request. Existing status lines require `--replace`; their exact
JSON value is saved under `~/.claude/ccm/statusline-integration.json` and
restored by `ccm usage remove`.

After explicit setup, account limits are refreshed from Claude Code's
authenticated read-only account usage endpoint at most once every 30 seconds.
CCM reads the locally managed OAuth token only in memory and atomically caches
only aggregate percentages, reset times, and the usage-credit flag under
`~/.claude/ccm/account-usage.json`.

The status-line collector separately receives Claude Code's documented session
JSON over stdin, keeps only aggregate model/agent/context/rate-limit fields, and
atomically writes one hashed per-session snapshot under `~/.claude/ccm/usage/`.
Separate files avoid cross-session write contention. These sources feed:

- `ccm usage` and `ccm usage --json`
- TUI header polling
- Web `/api/usage` and filesystem-backed live refresh

TUI and web read usage independently from heavier project discovery, immediately
on startup and every five seconds afterward. Summaries expose account-limit and
session-payload freshness independently. Recent account data may be served from
cache after a failed refresh; status-line limits are a last-resort fallback.

CCM validates the installed refresh configuration and records one privacy-safe
last error so a stopped collector cannot silently freeze the UI. Claude for VS
Code does not currently execute the terminal status-line integration. Removal
restores prior settings and deletes snapshots and capture diagnostics.

## Session Signals

`SessionSignals` stores independent facts because multiple conditions may apply
to one session simultaneously:

- `archived`
- `interrupted`
- `lastToolFailed`
- `compactionCount`
- `expiresInDays`
- `pathExists`
- `analysisComplete`

`primaryStatus()` derives a single display-priority badge. It is never stored.

JSONL analysis detects unresolved tool calls, the latest failed tool-result
batch, `compact_boundary` events, titles, recorded branch, cwd, timestamps, and
message count. The current git branch is resolved independently for each unique
session path so worktrees do not produce false drift warnings. Malformed lines
are skipped.

## CCM Sidecar

Aliases and local archive state are stored per Claude project:

```text
~/.claude/projects/<project-id>/ccm.json
```

Writes are coordinated at two levels:

- A per-process promise queue serializes writes in one CCM process.
- An advisory `ccm.json.lock` created with `O_EXCL` serializes separate CCM
  processes.

The lock detects dead owners and stale invalid lock files. The updated sidecar
is written to a PID-specific temporary file and atomically renamed into place.

Archiving only hides a session in CCM. It is not a transcript backup.

## Active Sessions

`active-sessions.ts` reads Claude Code session process records under
`~/.claude/sessions/` and verifies their PIDs. The TUI polls this state; the web
client requests it independently. This allows separate CCM processes to observe
the same active Claude sessions.

## Terminal UI

`src/tui/App.tsx` owns application state and keyboard input. Presentation is
split into small Ink components, while `session-view.ts` contains pure filtering
and viewport-window logic.

The TUI:

- Loads projects and active sessions on startup.
- Provides project-scoped search and archived-session toggling.
- Uses viewport slices so large lists remain navigable.
- Returns a `ResumeTarget` to `src/index.ts`.

For resume, the TUI exits cleanly, changes to the recorded session directory,
and launches `claude --resume <id>` with inherited stdio.

## Web UI

`src/web/server.ts` binds Hono explicitly to `127.0.0.1`. It searches for an
available port and optionally opens the browser.

The browser application is maintained as:

```text
src/web/ui.html
src/web/styles.css
src/web/client.js
```

`src/web/ui.ts` assembles those files into one response at startup. There is no
browser framework or frontend build step.

`client.js` deliberately remains one standalone script. Splitting it without a
browser build step would replace local scope with order-dependent shared
globals. Responsibility-oriented names and section dividers keep that tradeoff
explicit and navigable.

Implemented API routes include:

- Project/session discovery and metadata search
- Active-session IDs
- Validated resume launch
- Alias and local archive updates
- Session transcript event loading
- Server-resolved CLAUDE.md read/write
- SSE change notifications
- Shared Lost & Found diagnostics, including broken indices and stale locks

State-changing routes validate localhost Origin/Host values. Project and session
identifiers are resolved against known server-side data before filesystem or
launch operations.

Web server responsibilities are split between route registration, grouped route
modules under `web/routes/`, API serialization, local-request security, and
CLAUDE.md filesystem handling. `routes.ts` remains the single readable map of
the HTTP surface.

SSE invalidates the short-lived metadata cache before notifying clients about
relevant transcript, index, active-session, and CCM sidecar changes. A slow
periodic refresh also keeps external git branch changes and missed filesystem
events eventually consistent. The TUI uses the same slow project refresh.

## Terminal Launching

Direct TUI resume stays in the current terminal. Web resume delegates to
platform-specific launchers:

- Unix/macOS: tmux, known terminal applications, detected emulators, then
  clipboard fallback.
- Windows: Windows Terminal, PowerShell, `cmd`, then clipboard fallback.

Session IDs are UUID-validated. Unix paths are shell-quoted. The Windows
launcher still uses carefully escaped shell command strings and requires
dedicated clean-environment testing before release.

## Configuration

Shared TypeScript runtime configuration lives in `src/config/app.ts`.
Browser-only timings stay in the standalone client to avoid a frontend build
step; domain thresholds remain next to the logic they govern.

| Variable            | Purpose                               |
| ------------------- | ------------------------------------- |
| `CLAUDE_CONFIG_DIR` | Override Claude Code's data directory |
| `CCM_PORT`          | Preferred web port                    |
| `CCM_NO_OPEN`       | Prevent automatic browser opening     |
| `CCM_DEBUG`         | Enable debug logging                  |

## Verification

CI runs on Ubuntu and Windows with Node.js 20:

```bash
npm run format:check
npm run lint
npm run build
npm test
```

ESLint covers TypeScript, tests, and the standalone browser JavaScript. Prettier
covers source, tests, browser HTML/CSS, scripts, workflow files, and maintained
Markdown.

Before release, also run `node --check src/web/client.js`, `npm audit`, and
`npm pack --dry-run`.
