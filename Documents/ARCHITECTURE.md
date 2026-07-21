# reup Architecture

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

| Command                   | Behavior                                                                |
| ------------------------- | ----------------------------------------------------------------------- |
| `reup`                    | Starts the Ink terminal UI                                              |
| `reup web`                | Starts the local Hono server and opens the browser UI                   |
| `reup list [query]`       | Prints a filtered table; `--json` emits full records                    |
| `reup search <query>`     | Opens the ranked picker pre-filtered; `--deep` scans transcript content |
| `reup touched [path]`     | Lists sessions that edited a matching file, or opens a file picker      |
| `reup inbox`              | Prints active and actionable sessions                                   |
| `reup cleanup`            | Reviews stale or empty sessions for reversible archiving                |
| `reup doctor`             | Runs non-destructive local-data diagnostics                             |
| `reup handoff <session>`  | Prints a transcript-supported continuation packet                       |
| `reup resume [session]`   | Opens a picker, or resumes a full ID/unique prefix                      |
| `reup usage [action]`     | Reads observed usage or configures its local feed                       |
| `reup attention [action]` | Manages needs-input alerts or captures Notification hooks               |
| `reup config`             | Opens the configuration TUI or manages preferences                      |
| `reup completion <shell>` | Prints opt-in shell completion registration                             |
| `reup help [command]`     | Prints general or command-specific help                                 |
| `reup --help`             | Prints supported commands                                               |
| `reup --version`          | Prints the current version                                              |

The `repair` command is reserved but not implemented.

Machine-readable commands reserve stdout exclusively for their result. Debug,
warning, and error logs use stderr so piping JSON into tools such as `jq`
remains safe even when `REUP_DEBUG=1`.

`reup list` parses free-text and structured filters once, then applies the same
selection pipeline to its human table and JSON output. Archived sessions are
excluded unless `--archived` is requested. Colour is emitted only for a TTY,
and state text/symbols keep redirected output understandable without colour.
Its human table calculates ID prefixes against every discovered session, so a
prefix remains safe to use even when filters hide a colliding session.

`reup resume` and `reup handoff` share the same global prefix-selection rules:
prefixes must contain at least eight characters and resolve to exactly one
session. Without a selector, interactive `reup resume` opens a compact global
picker. The picker and shell completion share one relevance ranking: sessions
associated with the current working directory first, then active sessions and
recent activity. Shell completion is opt-in because Reup does not modify shell
profiles automatically; its internal completion endpoint returns IDs only.

## Source Layout

```text
src/
  cli/             Script-friendly command implementations and output schemas
  config/          Shared application constants, labels, and theme tokens
  core/
    health/        Non-destructive data-health diagnostics
    org/           Organization layer: groups, stacks, tags, org.json persistence
    project/       Claude paths, project discovery, caching, and the sidecar lock
    session/       Session model, transcripts, signals, search, previews, handoff
    terminal/      Platform-specific terminal launchers
    usage/         Live usage, account limits, and status-line integration
  tui/             Ink controller, pure view helpers, and presentation components
  web/             Hono server, grouped routes, API model, and browser client segments
  utils/           Small logging and time-formatting utilities
tests/
  branding/        Public naming and identity guards
  cli/             Pure command output and schema tests
  core/            Loading, signal, active-session, org, and lock tests
  extension/       VS Code cockpit model and adapter tests
  tui/             Pure terminal view-model tests
  utils/           Shared utility tests
  web/             Route smoke tests and browser-client regression guards
scripts/
  build-client.mjs           Concatenates src/web/client/ segments into client.js
  check-extension-version.mjs
  check-version-sync.mjs
  copy-assets.mjs            Copies browser assets into dist/web/
  install-hooks.mjs
  sync-version.mjs
```

The build uses `tsc`. The `postbuild` hook regenerates `client.js` from the
client segments and copies the browser assets into `dist/web/`.

## Session Data

Core responsibilities are intentionally separated:

| Module                                    | Responsibility                                            |
| ----------------------------------------- | --------------------------------------------------------- |
| `session/session-model.ts`                | Shared session types and session-ID validation            |
| `project/claude-paths.ts`                 | Claude data locations and encoded project-path resolution |
| `project/project-discovery.ts`            | Project/session discovery and filesystem annotations      |
| `project/project-cache.ts`                | Short-lived in-process discovery cache and invalidation   |
| `project/project-sidecar-lock.ts`         | Cross-process sidecar lock protocol                       |
| `session/session-transcript.ts`           | JSONL metadata extraction                                 |
| `session/session-signals.ts`              | Transcript-derived signals and display status             |
| `session/session-tail.ts`                 | Transcript-tail live-activity state and latest tool name  |
| `session/session-metadata.ts`             | Reup sidecar reads, merges, and queued writes             |
| `session/session-query.ts`                | Structured search-query parsing shared by all surfaces    |
| `session/session-search.ts`               | Metadata and deep transcript search                       |
| `session/session-file-search.ts`          | Reverse touched-file → session lookup                     |
| `session/session-smart-view.ts`           | Exclusive priority-ordered Inbox bucket assignment        |
| `session/resume-advice.ts`                | Deterministic pre-resume recommendation from signals      |
| `session/cleanup.ts`                      | Heuristic stale/empty-session scoring for `reup cleanup`  |
| `session/session-handoff.ts`              | Conservative transcript continuation-fact extraction      |
| `session/active-sessions.ts`              | Live Claude process and lock-file detection               |
| `health/diagnostics.ts`                   | Shared non-destructive data-health checks                 |
| `org/org-model.ts` + `org/org-filters.ts` | Groups, stacks, tags schema and shared org filtering      |
| `usage/live-usage.ts`                     | Aggregate status-line snapshot parsing and persistence    |
| `usage/account-usage.ts`                  | Opt-in account-limit refresh and freshness states         |
| `usage/usage-statusline-integration.ts`   | Reversible Claude settings integration                    |
| `sessions.ts`                             | Compatibility re-exports only                             |

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
5. Merge local Reup metadata from `reup.json`.
6. Sort sessions and projects by most recent update.

The index fast path avoids JSONL analysis. Signals requiring transcript analysis
are therefore `null`, not falsely reported as clean.

## Session Context Metrics

Transcript discovery also records the latest observed Claude model, distinct
model history, context-input tokens, and response-output tokens. These values
live under `Session.context` and are serialized consistently to the web API and
`reup list --json`.

`latestContextTokens` sums input, cache-creation, and cache-read tokens from the
latest assistant response. It excludes output tokens to match Claude Code's
documented context-percentage semantics. `latestOutputTokens` stores that
response's output separately.

The values are historical transcript facts, not live account limits. On the
index fast path they are `null`, following the same unknown-data rule used by
transcript-derived signals. Live usage architecture and source boundaries are
documented in [`USAGE_VISIBILITY.md`](USAGE_VISIBILITY.md).

## Live Usage

`reup usage setup` installs a user-level Claude Code status-line command only
after an explicit request. Existing status lines require `--replace`; their exact
JSON value is saved under `~/.claude/reup/statusline-integration.json` and
restored by `reup usage remove`.

After explicit setup, account limits are refreshed from Claude Code's
authenticated read-only account usage endpoint at most once every 30 seconds.
Reup reads the locally managed OAuth token only in memory and atomically caches
only aggregate percentages, reset times, and the usage-credit flag under
`~/.claude/reup/account-usage.json`.

The status-line collector separately receives Claude Code's documented session
JSON over stdin, keeps only aggregate model/agent/context/rate-limit fields, and
atomically writes one hashed per-session snapshot under `~/.claude/reup/usage/`.
Separate files avoid cross-session write contention. These sources feed:

- `reup usage` and `reup usage --json`
- TUI header polling
- Web `/api/usage` and filesystem-backed live refresh

TUI and web read usage independently from heavier project discovery, immediately
on startup and every five seconds afterward. Summaries expose account-limit and
session-payload freshness independently. Recent account data may be served from
cache after a failed refresh; status-line limits are a last-resort fallback.

Reup validates the installed refresh configuration and records one privacy-safe
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
It is a raw, liveness-unaware read of the signals — `reup doctor`/`cleanup`
need that. The web API layer (`serializeSession` in `src/web/api-model.ts`)
applies one further, display-only correction on top: a live session's
transcript very often ends on a dangling tool call (a tool in flight), which
is the same condition `interrupted` reads — but for an attached session that
is normal mid-turn state, not an abandoned one. `serializeSession` recomputes
the displayed status with `interrupted` forced false for live sessions,
falling through to whatever status would otherwise apply. `lastToolFailed` is
not corrected — a real tool failure still shows regardless of liveness.

JSONL analysis detects unresolved tool calls, the latest failed tool-result
batch, `compact_boundary` events, titles, recorded branch, cwd, timestamps, and
message count. The current git branch is resolved independently for each unique
session path so worktrees do not produce false drift warnings. Malformed lines
are skipped.

## Reup Sidecar

Aliases and local archive state are stored per Claude project:

```text
~/.claude/projects/<project-id>/reup.json
```

Writes are coordinated at two levels:

- A per-process promise queue serializes writes in one Reup process.
- An advisory `reup.json.lock` created with `O_EXCL` serializes separate Reup
  processes.

The lock detects dead owners and stale invalid lock files. The updated sidecar
is written to a PID-specific temporary file and atomically renamed into place.

Archiving only hides a session in Reup. It is not a transcript backup.

## Active Sessions

`active-sessions.ts` reads Claude Code session process records under
`~/.claude/sessions/` and verifies their PIDs. The TUI polls this state; the web
client requests it independently. This allows separate Reup processes to observe
the same active Claude sessions.

## Organization Layer

`src/core/org/` owns the optional organization metadata: named project groups,
work stacks (projects and sessions grouped by intent), and a recency-ordered
tag palette. That state persists to `~/.claude/reup/org.json` behind a
schema version, an advisory lock, and atomic writes; per-session and
per-project tags live in each project's `reup.json` sidecar instead. Shared
filtering (`org-filters.ts`) applies group, stack, and tag selection
identically across web, TUI, and CLI, and `session-smart-view.ts` assigns each
session to exactly one priority-ordered Inbox bucket.

Surfaces build on the same core: the web UI adds `/api/org/**` CRUD routes, a
collapsible organization rail (Inbox, Stacks, Groups), and tag/group pickers;
the TUI shows chips and cycles focus; `reup list` exposes `--tag`, `--group`,
and `--stack` filters without requiring the web server.

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

The browser application is maintained as `src/web/ui.html`,
`src/web/styles.css`, and numbered responsibility segments under
`src/web/client/`. `scripts/build-client.mjs` concatenates the segments into
the committed `src/web/client.js` — a single IIFE with no bundler — and the
`postbuild` and `pretest` hooks keep that output in sync. `src/web/ui.ts`
assembles HTML, styles, and script into one response at startup. There is no
browser framework and no frontend build step beyond that concatenation.

Implemented API routes include:

- Project/session discovery and metadata search
- Active-session IDs
- Validated resume launch
- Alias, tag, and local archive updates
- Organization CRUD (groups, stacks, stack items, project-group assignments)
  and org-filtered project queries
- Touched-file reverse lookup
- Usage summary and live refresh
- Theme persistence
- Session transcript event loading
- Server-resolved CLAUDE.md read/write
- SSE change notifications
- Shared Lost & Found diagnostics, including broken indices, stale locks, and
  read-only legacy Project Memory artifact warnings

State-changing routes validate localhost Origin/Host values. Project and session
identifiers are resolved against known server-side data before filesystem or
launch operations.

## VS Code Workspace Cockpit

The optional extension bundles selected `src/core` modules directly; it does
not require the Reup CLI binary or web server. Its adapter builds one
workspace-first cockpit model from shared project discovery, active-session
state, health signals, Resume Advice, previews, and metadata.

The full-screen dashboard is the primary discovery and resume surface. It loads
metadata first, requests previews only for the selected session, uses the shared
core query parser for structured search, and performs transcript search only on
explicit request. The Activity Bar tree remains a compact companion that
separates current-workspace sessions, attention elsewhere, and recent global
history. Refresh watchers exist only while either the dashboard or tree is
visible and observe
Claude project data, live-session locks, workspace changes, active editors, and
normal/worktree Git metadata.

Refresh is focus-neutral: tree nodes retain stable object identity and VS Code
IDs instead of being programmatically reselected, while the dashboard captures
and restores its focused control, input caret, and panel scroll positions
around DOM updates. The Inspector skips semantically identical renders and
rejects stale asynchronous preview results.

Watch mode is event-driven rather than polling: filesystem bursts are
coalesced and rate-limited, hidden Tree Views are not invalidated, and
structurally unchanged cockpit models produce no UI refresh. Periodic
20-second scanning is reserved for explicit interval mode.

The Session Inspector is a CSP-restricted Webview. Transcript previews are
loaded lazily and cached by transcript modification time. Every action is
revalidated in the extension host; only reversible metadata mutations are
available. Resume destination is centralized across dashboard, Inspector, tree,
and Quick Picks, with an optional remembered choice between Anthropic's Claude
Code extension and the integrated terminal. The status bar uses
transcript-backed context and active/attention counts; the dashboard separately
shows the shared live-usage cache with freshness handling.

## Web Server and Live Updates

Web server responsibilities are split between route registration, grouped route
modules under `web/routes/`, API serialization, local-request security, and
CLAUDE.md filesystem handling. `routes.ts` remains the single readable map of
the HTTP surface.

SSE invalidates the short-lived metadata cache before notifying clients about
relevant transcript, index, active-session, and Reup sidecar changes. A slow
periodic refresh also keeps external git branch changes and missed filesystem
events eventually consistent. The TUI uses the same slow project refresh.

The SSE connection lifecycle has three invariants (2026-07-01):

- Client disconnects surface as `stream.aborted`/`onAbort` in Hono, never as
  `stream.closed`; the event loop must observe both or it leaks one recursive
  filesystem watcher per disconnected client.
- Filesystem watchers always carry an `error` listener. Watcher failure closes
  the watcher and degrades to the periodic refresh instead of crashing the
  server.
- Change notifications are debounced with an upper bound
  (`APP.sseChangeMaxWaitMs`) so sustained transcript writes cannot postpone
  updates indefinitely.
- Live "working" state comes primarily from Claude Code's own lock-file
  `status` field (`busy`/`idle`, v2.1.197+), merged across a session's multiple
  locks (CLI + editor peers) with busy winning. Transcript tail parsing is the
  fallback for older versions and still supplies the last tool name; it is not
  trusted over the lock because transcript appends can pause beyond any
  freshness threshold while a long tool call or response is in flight.
  Conversely, `busy` is only trusted with fresh evidence (a recent status
  transition or recent transcript activity, `BUSY_STATUS_TRUST_WINDOW_MS`):
  Claude Code rewrites the lock only on transitions, so a session that died or
  was interrupted mid-turn leaves a zombie `busy` flag behind. A stale flag
  falls back to transcript-derived state, which still reports genuinely
  long-running tools via their pending tool_use blocks.
- SSE events are typed by what changed: session-lock flips push a
  server-computed `activity` snapshot (entries plus active session IDs, no
  client refetch, no project-cache invalidation), usage-file writes emit a
  targeted `usage` event, and only transcript/metadata changes emit the generic
  `change` event that triggers a full project refetch. Transcript writes also
  ride the activity push so tool state reaches the strip within
  `APP.sseActivityPushDebounceMs`. The client's 3-second poll remains solely as
  reconciliation (missed pushes, waiting→idle age-outs), and a 1-second client
  tick keeps the strip's relative ages honest between events. The shared model
  lives in `web/live-activity-model.ts`, used by both the REST route and the
  SSE push.

### Attention System

`reup attention setup` registers Reup's capture command as a Claude Code
`Notification` hook. Hooks are additive lists, so setup only appends Reup's
own entry and removal filters exactly that entry back out - hooks the user
configured are never touched. The hook payload is validated at runtime and
stored as one atomic marker per session under `reup/attention/`.

A marker means "this session is waiting on the user" and resolves itself: any
lock status transition or transcript event after the marker's timestamp, or
the death of the session's process, deactivates it (and the live-activity
model deletes it in the background). The watcher classifies marker writes as
`activity`, so a needs-input state reaches connected browsers on the same
~150 ms push path as busy/idle flips. Turn completion needs no hook at all:
clients detect running-to-idle transitions from consecutive snapshots.
Desktop notifications are browser-local and opt-in; the TUI pulses a red
marker and rings the terminal bell once per new attention event.

The same setup also registers `UserPromptSubmit` and `Stop` hooks pointing at
the same capture command. These provide Reup-owned turn boundaries
(busy from prompt submit until Stop) stored as one work marker per session
under `reup/activity/`. Detection combines lock status and work marker by
newest transition (`combineWorkEvidence`), which covers the sessions whose
locks omit the status field entirely - every observed VS Code entrypoint
lock. A busy marker is corroborated by the same evidence-freshness rule as
lock status, so a crashed turn cannot pulse forever. A submitted prompt also
clears the session's attention marker. In the web live strip, attached
sessions never vanish: quiet ones render dimmed as Idle instead of being
filtered out.

In the web client, `refreshLiveActivity()` gates on `activeSessionIds`, which
only `refreshProjectData()` updates — both the bootstrap and SSE-triggered
refresh run project data first and chain the activity fetch after it.

## Terminal Launching

Direct TUI resume stays in the current terminal. Web resume delegates to
platform-specific launchers:

- Unix/macOS: tmux, known terminal applications, detected emulators, then
  clipboard fallback.
- Windows: Windows Terminal, PowerShell, `cmd`, then clipboard fallback.

Session IDs are UUID-validated. Unix paths are shell-quoted. The Windows
launcher passes working directories and command tokens through structured
`execFile()` / `spawn()` arguments, with clipboard fallback only after launch
attempts fail. Clean Windows manual smoke is still required before official
public release.

## Configuration

Shared TypeScript runtime configuration lives in `src/config/app.ts`.
Browser-only timings stay in the standalone client to avoid a frontend build
step; domain thresholds remain next to the logic they govern.

| Variable            | Purpose                               |
| ------------------- | ------------------------------------- |
| `CLAUDE_CONFIG_DIR` | Override Claude Code's data directory |
| `REUP_PORT`         | Preferred web port                    |
| `REUP_NO_OPEN`      | Prevent automatic browser opening     |
| `REUP_DEBUG`        | Enable debug logging                  |

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

Before release, also run `npm run release:local` for a local release-candidate
bundle and `npm run release:installers` for installable RC packages, or at
minimum run `node --check src/web/client.js`, `npm audit`, and
`npm pack --dry-run`.
