# Reup — Feature Catalog

Internal reference. Kept up to date as features ship. Use this to inform
marketing copy, competitive comparisons, and prioritisation discussions.

---

## Product story

Reup is for developers whose local Claude Code work is spread across enough
projects, worktrees, terminal windows, and history that location is no longer a
useful memory aid. It supports one continuity loop:

1. **Find the work** from the task, phrase, branch, path, or file you remember.
2. **Know what needs you** without visiting every terminal.
3. **Resume in context** after checking the latest recorded request and answer,
   write/edit targets, path, branch, and health evidence.

Claude Code already provides a capable global `/resume` picker and Agent View
for background sessions. Reup complements both by keeping discovered local CLI
history, matched live processes, and managed background work in a persistent,
information-dense view, then adding structured search and pre-resume context.
Its value is the complete find → triage → inspect → resume workflow, not a claim
that any one primitive is exclusive.

---

## Feature categories

### Session state and health

Reup separates reported, observed, and inferred evidence. State is useful only
when its source and limits are honest.

| Feature                        | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Shared live-state resolver** | TUI, web, CLI inbox, and VS Code consume the same `needs-input`, `working`, `attached`, and `detached` decision. Fresh, non-superseded Agent View task state takes precedence per field, but only a reported PID or verified lock establishes a live process. Pidless managed rows remain safety evidence and are presented only when anchored to a resume-visible discovered session or live lock; orphanable hook/work markers cannot provide that anchor. Transcript activity remains an inferred hint. |
| **Health signals**             | Six independent signals derived from transcript metadata: `interrupted`, `lastToolFailed`, `compactionCount`, `expiresInDays`, `pathExists`, `analysisComplete`. Each is independently computable at the data layer, which is what `reup doctor`/`cleanup` read. The web session list corrects the display for live sessions: a dangling tool call reads as normal mid-turn work, not an interruption, unless the tool actually failed.                                                                    |
| **Derived status display**     | `primaryStatus` is recomputed from the available evidence on each discovery pass rather than persisted as a final label. Inputs can still have different freshness, so the UI must not imply that every derived value is current.                                                                                                                                                                                                                                                                          |
| **Branch drift detection**     | Compares the branch recorded in the transcript against the current git HEAD in the session's working directory. Warns before you resume into the wrong branch. Shown in both TUI and web.                                                                                                                                                                                                                                                                                                                  |
| **Recently active heuristic**  | Sessions with no reported PID or verified local lock but a transcript written within the last 5 minutes show a hollow dot `◌` instead of `●`. This is recency evidence, not proof that a process is still running.                                                                                                                                                                                                                                                                                         |
| **Lost & Found**               | Automatically surfaces three categories: sessions approaching Claude Code's cleanup window (expiring), sessions whose recorded path no longer exists (path-missing), and transcripts present on disk but absent from any project index (orphaned). Available in the web UI panel and via `reup doctor`.                                                                                                                                                                                                    |
| **reup doctor**                | Non-destructive local diagnosis command. Checks for stale sidecar locks, broken or absent indices, orphaned transcripts, missing project paths, and sessions nearing Claude cleanup. Every finding includes an explanation and a suggested action.                                                                                                                                                                                                                                                         |
| **Index corruption recovery**  | When `sessions-index.json` is absent or corrupt, Reup walks the transcript directory and reconstructs session metadata from raw JSONL events. Index corruption does not hide sessions.                                                                                                                                                                                                                                                                                                                     |

Together these signals make the list useful before resume. Competitive copy
should describe this outcome and the evidence model rather than present an
unmaintained “unique” claim.

---

### Search and navigation

Global session search itself is not unique: Claude Code's native resume flow can
already search across projects. Reup's advantage is the power-user navigator
around that search: global project/session context, structured filters, deep
transcript search, aliases, adaptive ID prefixes, shell completion, and health
signals shown inline.

| Feature                         | Detail                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Global view and search**      | Search spans all projects from any directory and keeps projects and sessions visible together. No need to know which project a session belongs to before scanning the work.                                                                                                                                                                                                                        |
| **Scope qualifiers**            | `project:`, `branch:`, `status:`, `is:active`, `is:archived` narrow any free-text query. Qualifiers combine with AND semantics. Plain text queries are unaffected.                                                                                                                                                                                                                                 |
| **Alias search**                | User-assigned session aliases are indexed alongside the session name, ID, and path. Renaming a session for readability also makes it findable.                                                                                                                                                                                                                                                     |
| **Deep transcript search**      | Scans the content of discovered local session transcripts, not just metadata. Available via `reup search --deep`, the TUI `tab` key while searching, and the web UI ⌕ button.                                                                                                                                                                                                                      |
| **Touched-file reverse lookup** | "Which sessions targeted this path with a write/edit tool call?" — a reverse index over recorded `tool_use` events. Exposed as `reup touched <path>` (CLI), a TUI finder (`t` / command palette), and a "touched by N other sessions" link in the web and VS Code inspectors. It does not verify that every attempted tool call succeeded; it surfaces paths and sessions, never diffs or replays. |
| **Ranked shell completion**     | Session-ID completion for `reup resume` and `reup handoff` across PowerShell, Bash, and Zsh. Completions are ranked: current-project sessions first, then active sessions, then recent activity. No session titles or transcript content are exposed to the shell.                                                                                                                                 |
| **Adaptive ID prefixes**        | `reup list` shows the shortest globally unambiguous session-ID prefix for each session (minimum 8 chars). Any prefix from this column can be passed directly to `reup resume` or `reup handoff`; ambiguous prefixes are refused.                                                                                                                                                                   |

The positioning advantage is recognition: search results retain project,
branch, status, and health context instead of becoming a separate list of
matching transcript lines.

---

### Usage visibility

Usage is supporting context for the resume decision, not a primary product
pillar. Report freshness and unavailable values explicitly.

| Feature                      | Detail                                                                                                                                                                                                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Per-session context size** | Latest context-input token count extracted from each analysed transcript. Shown in session rows; web view sorts by context size descending so the most expensive work rises to the top.                                                                                                     |
| **Account limits**           | 5-hour and 7-day usage percentages and reset times. After explicit `reup usage setup`, Reup may query Anthropic's authenticated usage endpoint at most once every 30 seconds using Claude Code's locally managed OAuth credential. No account request is made while the integration is off. |
| **Status-line integration**  | Reads the Claude Code terminal status line as a secondary source for model, agent, and live context detail. Never silently replaces an existing status line; `reup usage setup --replace` is required for that.                                                                             |
| **Header placement**         | TUI, web, and VS Code reserve a compact usage area. It shows `off`/unavailable while the integration is disabled and, when configured, can show current-session context plus the supported 5-hour and 7-day account windows.                                                                |
| **Colour-coded thresholds**  | Cyan normally, yellow at 80%, orange at 90%, red at 100%. Applied consistently across TUI, web, and `reup usage`.                                                                                                                                                                           |
| **Freshness transparency**   | The usage feed exposes its last-updated time and fresh/stale/unavailable state. Missing values remain unavailable rather than being estimated.                                                                                                                                              |
| **Opt-in, fully reversible** | Usage capture and account requests are off by default. `reup usage setup` is the consent boundary; `reup usage remove` restores the previous status-line setting and deletes Reup's aggregate cache. The OAuth token is held in memory only — never logged or written by Reup.              |

Account limits and per-session context appear together so a developer can judge
whether continuing expensive work is practical. This is a secondary benefit,
not the homepage hook.

---

### TUI (terminal interface)

Keyboard-first and designed for habitual daily use: open, find, inspect,
resume, done.

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
SSE updates refresh the page as local session data changes.

| Feature                            | Detail                                                                                                                                                                                         |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Filter pills**                   | All · Needs Attention · Active · Archived — one-click filter.                                                                                                                                  |
| **Sort controls**                  | Recent (default) or Risk (attention-status sessions first). Project sort: recent activity or project name.                                                                                     |
| **Session Inspector card**         | Right-panel operations panel: visible Resume/Handoff/Rename/Archive/Delete actions, shortcut hints, Resume Card preview, status explanation, usage/context facts, session ID, and full path.   |
| **SSE live updates**               | Server-sent events push filesystem and activity changes promptly. Periodic server refresh and client reconciliation polling cover missed watcher/SSE events; manual refresh remains available. |
| **Session context sort**           | Sessions sorted by latest observed context-input size descending. Sessions without analysed context sort last.                                                                                 |
| **Full keyboard navigation**       | `j`/`k` navigate sessions; `[`/`]` or `h`/`l` navigate projects; `a` archives; `/` opens search. Guards prevent firing inside input fields.                                                    |
| **Deep-linkable sessions**         | The URL hash resolves to a specific project and session on load. Share or bookmark any session directly.                                                                                       |
| **Context menus**                  | The visible `...` row button and right-click on project/session rows open Reup's custom action menu instead of relying on browser defaults.                                                    |
| **Triage Inbox**                   | Mutually exclusive, priority-ordered smart buckets surface active work, failures, branch drift, missing paths, high context, expiry, and recently touched sessions.                            |
| **Organization rail**              | Collapsible Inbox, Stack, and Group sections filter the project and session panels without a server-side query.                                                                                |
| **Tags and work stacks**           | Keyboard and context-menu flows tag sessions/projects, assign groups, toggle stack membership, and save the current search/focus as a reusable stack.                                          |
| **CLAUDE.md editor**               | View and edit each project's instruction file from the web UI. Shown as a tag in the project header when the file exists.                                                                      |
| **Start new session from project** | `+ new` button launches a new Claude Code session in the project directory.                                                                                                                    |
| **Branch drift badge**             | Shown inline on session rows when the recorded branch differs from current git HEAD.                                                                                                           |
| **Status and live markers**        | Non-`ok` health states render a `primaryStatus` badge. Live-state markers are separate, so a healthy session is not given a decorative `ok` badge.                                             |

---

### VS Code Workspace Cockpit

The installable VS Code extension combines a focused full-screen resume
dashboard with workspace-native companion views:

- Full-screen project/session discovery with progressive detail loading,
  structured metadata search, explicit transcript search, opt-in usage
  visibility, and context menus.
- Current-workspace, external-attention, and recent-global sections.
- Deterministic Resume Advice for missing paths, active sessions, branch drift,
  interrupted work, expiry, compaction, and safe resume.
- Live refresh only while the Reup view is visible, including Claude locks,
  multi-root workspaces, active editor affinity, and Git worktrees.
- A CSP-restricted Session Inspector with the latest recorded request and
  answer, plan, TODOs, context, branches, file links, and tags.
- Safe local actions: resume, handoff, alias, archive/undo, tags, and reveal.
- Compact active/attention status bar and global/workspace Quick Picks.
- One centralized resume policy across all surfaces, choosing the Claude Code
  extension when available or the VS Code terminal, with an optional persistent
  preference and safe fallback.

The extension reuses Reup core discovery, health, preview, metadata, and
handoff logic. It hosts no network service and has no telemetry, transcript
writes, automatic branch changes, or destructive delete action. When the user
has explicitly configured usage capture, the shared core may query Anthropic's
account-usage endpoint for aggregate limits; it never sends transcripts.

---

### CLI composability

All commands produce concise human output and machine-readable output where
useful. Designed to be scriptable and composable with standard shell tools.

| Command                           | Purpose                                                                                                                                                         |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reup`                            | Open TUI                                                                                                                                                        |
| `reup web`                        | Open browser UI                                                                                                                                                 |
| `reup resume [id]`                | Interactive global picker, or resume by ID or unambiguous prefix                                                                                                |
| `reup search <query>`             | Interactive picker with pre-filled search                                                                                                                       |
| `reup search --deep <q>`          | Full-content transcript search with interactive picker                                                                                                          |
| `reup touched [path]`             | Reverse lookup for sessions whose transcripts recorded a write/edit tool call targeting a path. Interactive picker without a path; `--json` for scripts         |
| `reup list [query]`               | Compact human table, globally filtered. `--json` for machine-readable output                                                                                    |
| `reup inbox`                      | Attention-sorted summary of active and at-risk sessions                                                                                                         |
| `reup handoff [session]`          | Compact Markdown continuation packet: latest recorded request, transcript summary, write/edit targets, and open TODOs. Unavailable facts are marked explicitly. |
| `reup cleanup`                    | Review stale, empty, orphaned, or expired sessions and archive them reversibly                                                                                  |
| `reup doctor`                     | Non-destructive local health check                                                                                                                              |
| `reup usage`                      | Show observed usage and data freshness                                                                                                                          |
| `reup usage setup / remove`       | Opt in to or remove status-line capture and authenticated aggregate account-usage refresh                                                                       |
| `reup attention setup / remove`   | Manage reversible local Notification-hook alerts                                                                                                                |
| `reup config get/set/reset <key>` | Read and write persistent user preferences                                                                                                                      |
| `reup completion <shell>`         | Print PowerShell, Bash, or Zsh completion setup                                                                                                                 |
| `reup help [command]`             | Show general or command-specific CLI help                                                                                                                       |
| `reup --help / --version`         | Help and version                                                                                                                                                |

`reup list` filters combine with AND semantics. `--active`, `--attention`,
`--archived`, `--project`, `--status`, `--limit`, `--json` are all composable.

These commands expose the same continuity loop to scripts: find with `list`,
`search`, or `touched`; triage with `inbox` and `doctor`; continue with `resume`
or `handoff`.

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

| Guarantee                                     | Detail                                                                                                                                                                                                                             |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Local analysis**                            | All transcript parsing happens on the local machine. No content is sent to a Reup-operated remote service.                                                                                                                         |
| **No Reup telemetry**                         | Reup sends no product analytics, crash reports, or session content to a Reup-operated service.                                                                                                                                     |
| **Localhost web server**                      | The web server binds to `127.0.0.1` only. Not reachable from other machines.                                                                                                                                                       |
| **Safe transcript handling**                  | Automated cleanup only archives through Reup sidecar metadata. Permanent deletion is an explicit action, is blocked for active sessions, and is never used by background maintenance.                                              |
| **Visible, reversible hook write**            | The first TUI, web, or configuration launch registers Reup-owned attention hooks in Claude settings and announces `reup attention remove`. An explicit removal records the opt-out; extension activation alone does not add hooks. |
| **OAuth token in memory only**                | After explicit usage setup, the local Claude Code token used for aggregate account requests is held in memory during the request and never logged or written by Reup.                                                              |
| **Credential warning in handoff** _(roadmap)_ | Before emitting a handoff packet, scan for secret patterns (API keys, tokens, env assignments). Warn and require `--force` to proceed. The transcript is never modified.                                                           |

---

## Relationship to Claude Code's native tools

The useful comparison is by workflow boundary, not by accumulating checkmarks.

| Question                                    | Claude Code `/resume`                                                      | Claude Code Agent View                                         | Reup                                                                                              |
| ------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Primary job**                             | Switch to a saved conversation                                             | Dispatch and operate background sessions                       | Find, triage, inspect, and resume local CLI work                                                  |
| **Scope**                                   | Current worktree by default; `Ctrl+A` widens to all local projects         | Background sessions across local projects                      | Discovered local transcripts plus matched live processes and managed tasks                        |
| **Interactive sessions in other terminals** | Saved conversations remain available in the picker                         | Not listed until backgrounded                                  | Included when Claude reports them or valid local evidence matches them                            |
| **Search and recognition**                  | Search, preview, name, branch, age, and message count                      | Filter by state, agent, or pull request                        | Metadata qualifiers, explicit transcript search, touched files, branch, state, and health context |
| **Live operation**                          | Resume/switch flow                                                         | State, peek, reply, attach, stop, and dispatch                 | At-a-glance triage and resume; not a background-agent supervisor                                  |
| **Boundary**                                | An unrelated project produces a copied `cd … && claude --resume …` command | Built around background sessions; currently a research preview | Local CLI data only; no Claude desktop, web, or remote-history aggregation                        |

Native behavior is based on Claude Code's official
[session documentation](https://code.claude.com/docs/en/sessions) and
[Agent View documentation](https://code.claude.com/docs/en/agent-view). Recheck
this table for each public release because first-party behavior evolves quickly.

Agent View can retain pidless background tasks reported as `working` or
`blocked` after their process exits. Reup does not call those rows historical
or expire them by age: it keeps them for conservative safety checks, while
presentation requires either a resume-visible discovered session or a verified
live lock. Attention and work markers may refine state but cannot establish
that anchor because they can be orphaned.

---

## What we are intentionally not building

Documented in `Documents/PRODUCT_DIRECTION.md`. The important boundaries are:

- **Timeline replay or step-by-step code diffs.** Reup is a continuity and
  resume tool, not a transcript replay environment.
- **Cross-tool support.** Claude Code focus allows deeper use of its local
  session facts and documented Agent View inventory.
- **Embedded terminals or an Electron desktop app.** Reup uses the terminal,
  browser, and editor the developer already has.
- **Claude desktop, web, remote, or mobile history aggregation.** Reup is scoped
  to local Claude Code CLI data.
- **Reup-hosted sync, accounts, or team features.** Project Memory sync remains
  deferred and is not shipped or advertised.
