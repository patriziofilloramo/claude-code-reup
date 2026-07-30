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
- `interrupted` — _inferred_ from an unanswered tool call
- `interruptedByUser` — _recorded_: the user stopped Claude mid-turn
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
falling through to whatever status would otherwise apply. `lastToolFailed` and
`interruptedByUser` are not corrected — a real tool failure and a recorded stop
are both facts about the session, true regardless of liveness afterward. The
correction exists for the inference, not for the record.

Interruption therefore has two independent sources, and conflating them was a
bug (2026-07-28). `interrupted` is inferred from a tool call left without a
result. `interruptedByUser` comes from the marker turn Claude Code writes when
the user stops it — `[Request interrupted by user]` or
`[Request interrupted by user for tool use]`, always a user turn whose sole
text block equals the marker. Matching must be exact: the same strings appear
inside compaction summaries quoting earlier turns and in ordinary messages
discussing interruptions, so a substring test flags those sessions forever.
Because the marker _is_ a user turn, it used to clear the pending tool calls
`interrupted` reads — meaning an explicit stop erased its own evidence and read
as a clean session. New instructions from the user clear the flag; a stop with
no follow-up keeps it.

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

Reading the sidecar reports three outcomes, and the distinction is load-bearing
(2026-07-26):

- `absent` — the file does not exist; the project genuinely has no metadata.
- `loaded` — parsed into an object.
- `unreadable` — the file exists but could not be read or parsed (`EACCES`,
  `EBUSY`, truncation, a non-object root).

Only `absent` means "empty". Update paths refuse an `unreadable` sidecar with
`ProjectSidecarUnreadableError`, naming the file to repair and leaving it
untouched; the HTTP layer maps that to 409. Read paths still degrade to "no
metadata" so one damaged file cannot hide a project from discovery. Collapsing
`unreadable` into `absent` is what previously let a single archive toggle
rewrite the file from empty and discard every other session's alias, tags, and
archive state while reporting success.

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
per-project tags live in each project's `reup.json` sidecar instead. The write
path applies the same coercion as the read path, so a file missing collections
is completed in place instead of failing deep inside a mutation, and refuses an
unparseable file with `OrgDataUnreadableError` rather than overwriting it —
the same "unreadable is not empty" rule as the sidecar. Shared
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

### Server link state (2026-07-26)

`web/client/15-connection.js` owns one question: is the server still there? It
exists because the page previously had no answer — stopping `reup web` left the
last known active-session set on screen indefinitely while a silent reconnect
loop retried, so the dashboard kept asserting sessions were running after the
process tracking them had exited.

The rule is that only a reachability probe may declare an outage. A dropped SSE
stream and a failed data refresh both merely call `noteServerUnreachable()`,
which schedules a probe after a grace period — a server restart drops the
stream for well under a second and recovers on its own, and the overlay must
not flash for blips nobody noticed. `probeServerReachability()` treats a
network-level failure as "gone" and any HTTP response as "alive".

A confirmed outage clears `activeSessionIds` and the activity strip before
anything else: the page cannot know what is running, so it must stop implying
it does. Recovery reopens the stream and reloads projects, activity, and usage.
The overlay is presentation on top of that state — dismissing it leaves the
outage, and the footer, intact.

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

Two access controls sit in front of that surface (2026-07-26):

- `localHostOnly()` is registered as `app.use('*', …)` in `buildApp` and
  rejects any request whose `Host` is not loopback, reads included. Binding
  127.0.0.1 only stops remote sockets, not a browser: DNS rebinding points an
  attacker's domain at 127.0.0.1, making its page same-origin with Reup, and
  every read endpoint returns transcripts, project paths, and CLAUDE.md
  contents. The `Host` header still names the attacker's domain, which is why
  it is the discriminator. Global registration is deliberate — a per-route
  opt-in only protects the routes someone remembered to annotate.
- `guardedRoute` adds the `Origin` check and stays mandatory for every
  mutating route; `tests/web/route-security.test.ts` enforces that statically,
  so error-mapping decorators compose _inside_ it rather than wrapping it.

The served page carries a Content-Security-Policy with a per-render nonce on
`script-src`. `style-src` intentionally keeps `'unsafe-inline'` with no nonce,
because the UI renders `style=""` attributes and a nonce would make the browser
ignore `'unsafe-inline'`. The CSP is defence in depth: values read from
transcripts (project paths, session names, branches, tool output) are untrusted
and must still be escaped where they are rendered.

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

### Live State Confidence (2026-07-28)

`activityState` has three possible sources, and they are not equally reliable:
a lock `status` field, a hook work marker, or — when a session has neither —
transcript recency. VS Code peer locks omit `status`, so recency is routinely
the only source, and it cannot distinguish a long tool call from a finished
turn: a quiet stretch mid-turn reads the same as a completed one.

`LiveActivityEntry.stateIsReported` records which kind of evidence produced the
state. The rule it exists to enforce: **a claim about an event requires
reported evidence; presentation may use the guess.** The desktop "turn
finished" alert is such a claim, and firing it on recency meant an alert every
time Claude paused to think.

The same reasoning shapes the web live dot: `waiting` is applied only when
something reported the turn boundary. Before this, an actively working session
turned amber and then grey while the TUI showed it correctly as live, because
the transcript had simply gone quiet.

### Shared Live State (2026-07-29)

> The undocumented Claude Code semantics this design rests on — and the wrong
> assumptions that repeatedly broke it — are in
> [`CLAUDE_CODE_DATA_MODEL.md`](CLAUDE_CODE_DATA_MODEL.md). Read it before
> changing live-state logic.

`core/session/session-live-state.ts` holds the one reading of "what is this
session doing" that every surface draws. It is a pure function of evidence the
callers already poll, so the TUI can call it at render time and the web can
call it while building a snapshot.

The vocabulary is four states, ordered by urgency:

| state         | meaning                                           |
| ------------- | ------------------------------------------------- |
| `needs-input` | blocked on the user (permission or input prompt)  |
| `working`     | producing output or running a tool right now      |
| `attached`    | a live process holds the session, currently quiet |
| `detached`    | no live process                                   |

`working` is deliberately the only state derived from activity; everything
quieter collapses into `attached`. Distinguishing a pausing session from a
finished one is exactly the judgement that proved unreliable for locks that
report no turn boundaries, so a surface wanting it must opt in explicitly.

**Core versus special.** A surface may choose how to draw a state and may add
detail on top, but may not add a value to the vocabulary or reinterpret one —
that is what made the surfaces disagree. The split as it stands:

- **Core** — the four states, resolved once. The TUI reads them in `App.tsx`,
  the web in `live-activity-model.ts` (`LiveActivityEntry.liveState`), and the
  extension in `live-attention.ts` (`LiveSessionSignals.liveStateBySession`).
- **Special, web** — it splits `attached` into `waiting` and plain quiet, gated
  on `stateIsReported`, because it has room for a label explaining which. This
  is the only sanctioned refinement, and it sits in one client function,
  `dotActivityState()`.
- **Special, presentation** — each surface renders in its own idiom: the TUI
  dims Ink's colour rather than picking a second green (so it survives
  16-colour terminals), the web lowers opacity, and VS Code splits by medium.
  Its tree icons have no intensity, so they carry the distinction by fill —
  `circle-filled` against `circle-outline` on one shared green. Its dashboard
  and inspector are HTML and match the web exactly, pulsing while working and
  held back when attached. All three of those places must read the shared
  state: converting only the tree icon left the other two on a binary flag, and
  the same session read busier there than anywhere else.
- **Special, per-surface states** — bulk selection and the `reup cleanup` /
  `doctor` triage statuses exist only in the TUI and never entered the core.

`TRANSCRIPT_RUNNING_WINDOW_MS` is intentionally not exported: a surface
applying that window itself is precisely what made the TUI call a session busy
that the web already called idle. `tests/core/session-live-state.test.ts`
guards both the resolver and the boundary — it fails if a surface starts
deriving liveness on its own again.

### Turn-End Alerts (2026-07-29)

Reup's monitoring surface is the web page: with many sessions to watch, it is
normally open and in front of the user, and that is where everything is seen.
A notification is only for the moments it is not.

That framing decides the division of labour, which took two wrong turns to
find:

- **The server reports what happened.** `event-stream-route.ts` tracks the last
  working state per session and emits a `turn-finished` SSE event when one
  leaves `working` with `stateIsReported` true. The page cannot find this
  alone — it derives state from snapshots it only receives while awake, so a
  throttled tab misses one side of the transition and stays silent.
- **The page decides whether the user needs telling.** `document.hidden` is the
  one signal only the browser has, and it answers exactly the right question:
  are you looking at this? If the page is visible, you already saw it.

Both wrong turns are worth recording. Deriving the boundary in the browser by
diffing snapshots failed because it required witnessing both sides. Moving the
whole alert to a local process — a detached check that notified unless a new
prompt arrived within thirty seconds — failed worse: nothing local can observe
attention, and "no reply yet" mistakes reading a long answer for walking away.
It also spawned a Node runtime per turn to ask one question.

The remaining gap is honest and small: a tab frozen for several minutes runs no
JavaScript, so a very long absence raises nothing. By then the user has been
away long enough to simply read the state on return.

There is no separate preference. The page's existing notification toggle is the
control, and the browser's own permission prompt is the consent.
