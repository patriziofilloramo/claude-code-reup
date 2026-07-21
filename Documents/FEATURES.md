# Reup — Feature Catalog

Internal reference. Kept up to date as features ship. Use this to inform
marketing copy, competitive comparisons, and prioritisation discussions.

---

## What makes Reup different

Most tools in this space are session _browsers_: they show you a list, let you
pick one, and open it. Claude Code itself also has a capable native picker with
global search in the resume flow. Reup's role is broader: it is a local
continuity control plane. Before you commit to resuming, it tells you what was
happening, whether the context is still valid, whether any session needs
attention right now, and which action is safest next. The intelligence layer -
health signals, branch drift detection, usage awareness, and a recovery path for
corrupt indices - is what no other tool in this space ships.

---

## Feature categories

### Session intelligence

The highest-signal area. No other tool in the Claude Code ecosystem surfaces
session health — they show you titles and dates; Reup shows you _state_.

| Feature                       | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Health signals**            | Six independent signals derived from transcript metadata: `interrupted`, `lastToolFailed`, `compactionCount`, `expiresInDays`, `pathExists`, `analysisComplete`. Each is independently computable at the data layer, which is what `reup doctor`/`cleanup` read. The web session list corrects the display for live sessions: a dangling tool call reads as normal mid-turn work, not an interruption, unless the tool actually failed. |
| **Derived status display**    | `primaryStatus` is computed fresh from signals on every read, never stored. This prevents the stale badges and phantom states that indexed tools show when the transcript changes without an index sync.                                                                                                                                                                                                                                |
| **Branch drift detection**    | Compares the branch recorded in the transcript against the current git HEAD in the session's working directory. Warns before you resume into the wrong branch. Shown in both TUI and web.                                                                                                                                                                                                                                               |
| **Remote-active heuristic**   | Sessions with no local lock file but a transcript written within the last 5 minutes show a hollow dot `◌` instead of `●`. Catches sessions running in another terminal or on another machine — without any network access.                                                                                                                                                                                                              |
| **Lost & Found**              | Automatically surfaces three categories: sessions approaching Claude Code's cleanup window (expiring), sessions whose recorded path no longer exists (path-missing), and transcripts present on disk but absent from any project index (orphaned). Available in the web UI panel and via `reup doctor`.                                                                                                                                 |
| **reup doctor**               | Non-destructive, local-only diagnosis command. Checks for stale sidecar locks, broken or absent indices, orphaned transcripts, missing project paths, and sessions nearing Claude cleanup. Every finding includes an explanation and a suggested action.                                                                                                                                                                                |
| **Index corruption recovery** | When `sessions-index.json` is absent or corrupt, Reup walks the transcript directory and reconstructs session metadata from raw JSONL events. Index corruption does not hide sessions — they surface automatically. _This is a gap across all tools reviewed in the 2026 competitive survey._                                                                                                                                           |

**Unique to Reup:** all of the above. Branch drift detection, the remote-active
heuristic, Lost & Found, and silent index recovery are absent from every
reviewed competitor.

---

### Search and navigation

Global session search itself is not unique: Claude Code's native resume flow can
already search across projects. Reup's advantage is the power-user navigator
around that search: global project/session context, structured filters, deep
transcript search, aliases, adaptive ID prefixes, shell completion, and health
signals shown inline.

| Feature                         | Detail                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Global view and search**      | Search spans all projects from any directory and keeps projects and sessions visible together. No need to know which project a session belongs to before scanning the work.                                                                                                                                                                                                                                             |
| **Scope qualifiers**            | `project:`, `branch:`, `status:`, `is:active`, `is:archived` narrow any free-text query. Qualifiers combine with AND semantics. Plain text queries are unaffected.                                                                                                                                                                                                                                                      |
| **Alias search**                | User-assigned session aliases are indexed alongside the session name, ID, and path. Renaming a session for readability also makes it findable.                                                                                                                                                                                                                                                                          |
| **Deep transcript search**      | Scans the full content of every session transcript, not just metadata. Available via `reup search --deep`, the TUI `tab` key while searching, and the web UI ⌕ button.                                                                                                                                                                                                                                                  |
| **Touched-file reverse lookup** | "Which sessions edited this file?" — a reverse index over the immutable `tool_use` write events each transcript records. Exposed as `reup touched <path>` (CLI), a TUI finder (`t` / command palette), and — almost-hidden — a "touched by N other sessions" link on each touched file in the web inspector and the VS Code inspector + dashboard. Read-only; surfaces only paths and sessions, never diffs or replays. |
| **Ranked shell completion**     | Session-ID completion for `reup resume` and `reup handoff` across PowerShell, Bash, and Zsh. Completions are ranked: current-project sessions first, then active sessions, then recent activity. No session titles or transcript content are exposed to the shell.                                                                                                                                                      |
| **Adaptive ID prefixes**        | `reup list` shows the shortest globally unambiguous session-ID prefix for each session (minimum 8 chars). Any prefix from this column can be passed directly to `reup resume` or `reup handoff`; ambiguous prefixes are refused.                                                                                                                                                                                        |

**Unique to Reup:** qualifier-based scoping, alias search, ranked shell
completion with privacy guarantees, adaptive ID prefixes, and search results
combined with health/usage context. `claude-history` has fast fuzzy search but
no qualifiers, no aliases, no shell completion, and no operational state layer.

---

### Usage visibility

Deeper than any competitor. No other tool surfaces live account limits
alongside per-session context size in the same view.

| Feature                      | Detail                                                                                                                                                                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Per-session context size** | Latest context-input token count extracted from each analysed transcript. Shown in session rows; web view sorts by context size descending so the most expensive work rises to the top.                                      |
| **Account limits**           | 5-hour and 7-day usage percentages and reset times. Refreshed from Claude Code's local authenticated usage endpoint at most once every 30 seconds.                                                                           |
| **Status-line integration**  | Reads the Claude Code terminal status line as a secondary source for model, agent, and live context detail. Never silently replaces an existing status line; `reup usage setup --replace` is required for that.              |
| **Always visible**           | Usage summary is persistent in both the TUI header and web page header — not hidden in a secondary panel or behind a command. Includes current-session usage, weekly usage, and monthly/credit-period usage where available. |
| **Colour-coded thresholds**  | Cyan normally, yellow at 80%, orange at 90%, red at 100%. Applied consistently across TUI, web, and `reup usage`.                                                                                                            |
| **Freshness transparency**   | Every displayed value shows its last-updated time. Stale or unavailable values are shown as stale/unknown rather than hidden or estimated.                                                                                   |
| **Opt-in, fully reversible** | Usage capture is off by default. `reup usage setup` enables it; `reup usage remove` reverses all changes and deletes the local cache. The OAuth token is held in memory only — never logged or written to disk.              |

**Unique to Reup:** account limits + per-session context in the same always-on
view, with an opt-in architecture that includes explicit reversal. CCHV has
token analytics for browsing; no competitor surfaces live account limits.

---

### TUI (terminal interface)

Keyboard-first, sub-second startup. Designed for habitual daily use: open,
find, resume, done. No tool in the reviewed landscape combines a TUI with
session intelligence.

| Feature                           | Detail                                                                                                                                                                  |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Two-panel layout**              | Projects on the left, sessions on the right. Arrow keys and Tab switch panels.                                                                                          |
| **Session preview / Resume card** | `p` opens a compact pre-resume summary: status, signals, last activity, branch, message count, model — enough to answer "should I resume?" without opening Claude Code. |
| **Command palette**               | `Ctrl+K` opens a full command list with keybindings and a live text filter. All contextual actions are reachable without memorising keys.                               |
| **Bulk archive**                  | `space` toggles session selection (◆ marker). `A` archives all selected. Active sessions are silently skipped and the count is reported. `esc` clears selection.        |
| **Project action menu**           | `space` in the project panel opens a context menu: new session, browse sessions, open in file manager, copy path.                                                       |
| **New session from project**      | `n` launches `claude` in the selected project directory and exits Reup. Also reachable from the command palette and project action menu.                                |
| **Deep search picker**            | While searching, `tab` switches to full-content transcript search and shows results as a navigable picker.                                                              |
| **Expiry glyph**                  | Sessions approaching the Claude Code cleanup window show `⚠Nd` (days remaining) inline in the session row.                                                              |
| **Archive toggle**                | `a` toggles archive state for the selected session. Archived sessions are hidden by default in both TUI and web.                                                        |
| **Search qualifiers**             | All qualifiers available in `reup list` work in the TUI search bar.                                                                                                     |

---

### Web UI

A passive dashboard designed to stay open in a browser tab while you work.
SSE live updates mean the page never needs a manual refresh. The only tool in
the reviewed landscape that ships both a web UI and session intelligence.

| Feature                            | Detail                                                                                                                                                                                       |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Filter pills**                   | All · Needs Attention · Active · Archived — one-click filter.                                                                                                                                |
| **Sort controls**                  | Recent (default) or Risk (attention-status sessions first). Project sort: recent activity or project name.                                                                                   |
| **Session Inspector card**         | Right-panel operations panel: visible Resume/Handoff/Rename/Archive/Delete actions, shortcut hints, Resume Card preview, status explanation, usage/context facts, session ID, and full path. |
| **SSE live updates**               | Server-sent events push changes when the transcript directory changes. No polling or manual refresh.                                                                                         |
| **Session context sort**           | Sessions sorted by latest observed context-input size descending. Sessions without analysed context sort last.                                                                               |
| **Full keyboard navigation**       | `j`/`k` navigate sessions; `[`/`]` or `h`/`l` navigate projects; `a` archives; `/` opens search. Guards prevent firing inside input fields.                                                  |
| **Deep-linkable sessions**         | The URL hash resolves to a specific project and session on load. Share or bookmark any session directly.                                                                                     |
| **Context menus**                  | The visible `...` row button and right-click on project/session rows open Reup's custom action menu instead of relying on browser defaults.                                                  |
| **Triage Inbox**                   | Exclusive, priority-ordered smart buckets surface active work, failures, branch drift, missing paths, high context, expiry, and recently touched sessions.                                   |
| **Organization rail**              | Collapsible Inbox, Stack, and Group sections filter the project and session panels without a server-side query.                                                                              |
| **Tags and work stacks**           | Keyboard and context-menu flows tag sessions/projects, assign groups, toggle stack membership, and save the current search/focus as a reusable stack.                                        |
| **CLAUDE.md editor**               | View and edit each project's instruction file from the web UI. Shown as a tag in the project header when the file exists.                                                                    |
| **Start new session from project** | `+ new` button launches a new Claude Code session in the project directory.                                                                                                                  |
| **Branch drift badge**             | Shown inline on session rows when the recorded branch differs from current git HEAD.                                                                                                         |
| **Status badges**                  | Each session row shows its derived `primaryStatus` badge.                                                                                                                                    |

---

### VS Code Workspace Cockpit

The installable VS Code extension combines a focused full-screen resume
dashboard with workspace-native companion views:

- Full-screen project/session discovery with progressive detail loading,
  structured metadata search, explicit transcript search, live usage, and
  context menus.
- Current-workspace, external-attention, and recent-global sections.
- Deterministic Resume Advice for missing paths, active sessions, branch drift,
  interrupted work, expiry, compaction, and safe resume.
- Live refresh only while the Reup view is visible, including Claude locks,
  multi-root workspaces, active editor affinity, and Git worktrees.
- A CSP-restricted Session Inspector with goal, progress, plan, TODOs, context,
  branches, file links, and tags.
- Safe local actions: resume, handoff, alias, archive/undo, tags, and reveal.
- Compact active/attention status bar and global/workspace Quick Picks.
- One centralized resume policy across all surfaces, choosing the Claude Code
  extension when available or the VS Code terminal, with an optional persistent
  preference and safe fallback.

The extension reuses Reup core discovery, health, preview, metadata, and
handoff logic. It has no telemetry, network service, transcript writes,
automatic branch changes, or destructive delete action.

---

### CLI composability

All commands produce concise human output and machine-readable output where
useful. Designed to be scriptable and composable with standard shell tools.

| Command                              | Purpose                                                                                                                                             |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reup`                               | Open TUI                                                                                                                                            |
| `reup web`                           | Open browser UI                                                                                                                                     |
| `reup resume [id]`                   | Interactive global picker, or resume by ID or unambiguous prefix                                                                                    |
| `reup search <query>`                | Interactive picker with pre-filled search                                                                                                           |
| `reup search --deep <q>`             | Full-content transcript search with interactive picker                                                                                              |
| `reup touched [path]`                | Reverse lookup: which sessions edited a file. Interactive picker without a path; `--json` for scripts                                               |
| `reup list [query]`                  | Compact human table, globally filtered. `--json` for machine-readable output                                                                        |
| `reup inbox`                         | Attention-sorted summary of active and at-risk sessions                                                                                             |
| `reup handoff [session]`             | Compact Markdown continuation packet: last goal, transcript summary, edited files, open todos. Unavailable facts marked explicitly, never inferred. |
| `reup cleanup`                       | Review stale, empty, orphaned, or expired sessions and archive them reversibly                                                                      |
| `reup doctor`                        | Non-destructive local health check                                                                                                                  |
| `reup usage`                         | Show observed usage and data freshness                                                                                                              |
| `reup usage setup / remove / toggle` | Manage usage capture integration                                                                                                                    |
| `reup attention setup / remove`      | Reversible Notification-hook alerts when a session waits for user input                                                                             |
| `reup config get/set/reset <key>`    | Read and write persistent user preferences                                                                                                          |
| `reup completion <shell>`            | Print PowerShell, Bash, or Zsh completion setup                                                                                                     |
| `reup help [command]`                | Show general or command-specific CLI help                                                                                                           |
| `reup --help / --version`            | Help and version                                                                                                                                    |

`reup list` filters combine with AND semantics. `--active`, `--attention`,
`--archived`, `--project`, `--status`, `--limit`, `--json` are all composable.

**Unique to Reup:** `reup handoff` (continuation packet), `reup inbox`
(attention-sorted summary), and `reup doctor` (structured health check). No
other reviewed tool ships any of these. Shell completion with ranked suggestions
and adaptive ID prefixes are also absent from all competitors.

---

### Deferred project memory sync

Project Memory / shared session storage was removed before the first public
release. The design knowledge is preserved in
[`DEFERRED_PROJECT_MEMORY_SYNC.md`](DEFERRED_PROJECT_MEMORY_SYNC.md), but the
feature is not shipped, advertised, or kept dormant in the codebase.

---

### Configuration

| Feature                    | Detail                                                                                                                                              |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Zero-config defaults**   | Works out of the box with `reup`. No config file required.                                                                                          |
| **reup config CLI**        | `reup config get/set/reset <key>` reads and writes `~/.claude/reup/prefs.json`.                                                                     |
| **reup config TUI**        | Keyboard-navigable Interface and Integrations tabs. Integrations show their exact effect and are reversible from within the UI.                     |
| **Persistent preferences** | Theme and integration state are persisted across invocations.                                                                                       |
| **Theme system**           | Dark (default), Light, and Terminal (phosphor) themes. Single design-token layer — switching themes requires no code changes, only a new token set. |
| **i18n groundwork**        | TUI user-facing strings centralised to `src/config/labels.ts` and guarded by a lint rule. Adding a language becomes a data file, not a code change. |

---

### Safety & privacy

| Guarantee                                     | Detail                                                                                                                                                                                |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Local-only analysis**                       | All transcript parsing happens on the local machine. No content is ever sent to a remote service.                                                                                     |
| **No telemetry**                              | Reup collects no usage metrics, crash reports, or any other data.                                                                                                                     |
| **Localhost web server**                      | The web server binds to `127.0.0.1` only. Not reachable from other machines.                                                                                                          |
| **Safe transcript handling**                  | Automated cleanup only archives through Reup sidecar metadata. Permanent deletion is an explicit action, is blocked for active sessions, and is never used by background maintenance. |
| **OAuth token in memory only**                | The local Claude Code token used for usage requests is held in memory during the request and never logged or written to disk.                                                         |
| **Credential warning in handoff** _(roadmap)_ | Before emitting a handoff packet, scan for secret patterns (API keys, tokens, env assignments). Warn and require `--force` to proceed. The transcript is never modified.              |

---

## Competitive snapshot

Assessed against the four tools reviewed in the mid-2026 article
[_I tested 4 tools for browsing Claude Code session history_](https://dev.to/gonewx/i-tested-4-tools-for-browsing-claude-code-session-history-17ie).

| Capability                                          |      reup      | Mantra |  CCHV   | claude-history | Built-in |
| --------------------------------------------------- | :------------: | :----: | :-----: | :------------: | :------: |
| Session signals (interrupted, expiry, path-missing) |       ✓        |   —    |    —    |       —        |    —     |
| Branch drift detection                              |       ✓        |   —    |    —    |       —        |    —     |
| Remote-active heuristic                             |       ✓        |   —    |    —    |       —        |    —     |
| Lost & Found (orphaned / expiring sessions)         |       ✓        |   —    |    —    |       —        |    —     |
| Doctor / health check command                       |       ✓        |   —    |    —    |       —        |    —     |
| Index corruption recovery (JSONL fallback)          |       ✓        |   —    |    —    |       —        |    —     |
| Non-destructive toward transcripts                  |       ✓        |   —    |    ?    |       ✓        |    ✓     |
| Global search with qualifiers                       |       ✓        |   —    |    —    |       —        |    —     |
| Deep transcript search                              |       ✓        |   —    |    —    |       ✓        |    —     |
| Project auto-organization                           |       ✓        |   —    |    —    |       —        |    —     |
| Usage: context window per session                   |       ✓        |   —    |    ✓    |       —        |    —     |
| Usage: live account limits (5h / 7d)                |       ✓        |   —    |    —    |       —        |    —     |
| Usage: always visible in all views                  |       ✓        |   —    |    —    |       —        |    —     |
| Handoff / continuation packet                       |       ✓        |   —    |    —    |       —        |    —     |
| Inbox (attention-sorted summary)                    |       ✓        |   —    |    —    |       —        |    —     |
| Ranked shell completion                             |       ✓        |   —    |    —    |       —        |    —     |
| CLAUDE.md editor                                    |       ✓        |   —    |    —    |       —        |    —     |
| TUI interface                                       |       ✓        |   —    |    —    |       ✓        |    ✓     |
| Web interface                                       |       ✓        |   —    |    ✓    |       —        |    —     |
| VS Code extension                                   |       ✓        |   —    |    —    |       —        |    —     |
| Credential / secret warning before share            |  _(roadmap)_   |   ✓    |    —    |       —        |    —     |
| Files-touched list + reverse "who edited this file" |       ✓        |   ✓    |    —    |       —        |    —     |
| Timeline replay / step-by-step code diff            | ✗ out of scope |   ✓    |    —    |       —        |    —     |
| Cross-tool (Cursor, Codex, OpenCode)                | ✗ out of scope |   ✓    |    ✓    |       —        |    —     |
| Zero configuration                                  |       ✓        |   —    | partial |       —        |    ✓     |
| No API key required for core features               |       ✓        |   ?    |    ?    |       ✓        |    ✓     |
| No Reup cloud, no account, no telemetry             |       ✓        |   —    |    —    |       ✓        |    ✓     |

`✓` = shipped · `—` = absent · `?` = unknown · `*(roadmap)*` = planned · `✗` = intentionally out of scope

---

## What we are intentionally not building

Documented in `Documents/PRODUCT_DIRECTION.md`. Key exclusions relevant to
competitive positioning:

- **Timeline replay / step-by-step code diff** — Mantra's differentiator. Too
  heavy for our light/local mission and does not answer the question Reup is
  built around ("should I resume this session?").

- **Cross-tool support** — CCHV and Mantra support Cursor, Codex, etc. Claude
  Code focus is intentional: it lets us go deeper on Claude-specific signals
  (compaction events, context windows, branch recordings) that don't exist in
  other tools' data formats.

- **Embedded terminal or Electron desktop app** — deliberately unnecessary.
  Reup opens in a terminal or browser tab you already have, starts in under a
  second, and requires no Electron overhead or separate app install. Mantra
  requires a dedicated desktop install.

- **Reup-hosted cloud sync / accounts / team features** — Local-first is a
  design constraint, not a gap. Project Memory sync is deferred until it can be
  supported as a separate explicit milestone.
