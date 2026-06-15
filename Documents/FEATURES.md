# CCM — Feature Catalog

Internal reference. Kept up to date as features ship. Use this to inform
marketing copy, competitive comparisons, and prioritisation discussions.

---

## What makes ccm different

Most tools in this space are session _browsers_: they show you a list, let you
pick one, and open it. CCM is a session _continuity inbox_: before you commit
to resuming, it tells you what was happening, whether the context is still
valid, and whether any session needs attention right now. The intelligence layer
— health signals, branch drift detection, usage awareness, and a recovery path
for corrupt indices — is what no other tool in this space ships.

---

## Feature categories

### Session intelligence

The highest-signal area. No other tool in the Claude Code ecosystem surfaces
session health — they show you titles and dates; CCM shows you _state_.

| Feature                       | Detail                                                                                                                                                                                                                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Health signals**            | Six independent signals derived from transcript metadata: `interrupted`, `lastToolFailed`, `compactionCount`, `expiresInDays`, `pathExists`, `analysisComplete`. Each is independently computable — a session can be both active and interrupted simultaneously.                                       |
| **Derived status display**    | `primaryStatus` is computed fresh from signals on every read, never stored. This prevents the stale badges and phantom states that indexed tools show when the transcript changes without an index sync.                                                                                               |
| **Branch drift detection**    | Compares the branch recorded in the transcript against the current git HEAD in the session's working directory. Warns before you resume into the wrong branch. Shown in both TUI and web.                                                                                                              |
| **Remote-active heuristic**   | Sessions with no local lock file but a transcript written within the last 5 minutes show a hollow dot `◌` instead of `●`. Catches sessions running in another terminal or on another machine — without any network access.                                                                             |
| **Lost & Found**              | Automatically surfaces three categories: sessions approaching Claude Code's cleanup window (expiring), sessions whose recorded path no longer exists (path-missing), and transcripts present on disk but absent from any project index (orphaned). Available in the web UI panel and via `ccm doctor`. |
| **ccm doctor**                | Non-destructive, local-only diagnosis command. Checks for stale sidecar locks, broken or absent indices, orphaned transcripts, and missing project paths. Every finding includes an explanation and a suggested action.                                                                                |
| **Index corruption recovery** | When `sessions-index.json` is absent or corrupt, CCM walks the transcript directory and reconstructs session metadata from raw JSONL events. Index corruption does not hide sessions — they surface automatically. _This is a gap across all tools reviewed in the 2026 competitive survey._           |

**Unique to ccm:** all of the above. Branch drift detection, the remote-active
heuristic, Lost & Found, and silent index recovery are absent from every
reviewed competitor.

---

### Search

Ahead of every reviewed competitor, and the only tool in this space whose
search works across projects by default rather than within one.

| Feature                     | Detail                                                                                                                                                                                                                                                           |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Global by default**       | Search spans all projects from any directory. No need to know which project a session belongs to.                                                                                                                                                                |
| **Scope qualifiers**        | `project:`, `branch:`, `status:`, `is:active`, `is:archived` narrow any free-text query. Qualifiers combine with AND semantics. Plain text queries are unaffected.                                                                                               |
| **Alias search**            | User-assigned session aliases are indexed alongside the session name, ID, and path. Renaming a session for readability also makes it findable.                                                                                                                   |
| **Deep transcript search**  | Scans the full content of every session transcript, not just metadata. Available via `ccm search --deep`, the TUI `tab` key while searching, and the web UI ⌕ button.                                                                                            |
| **Ranked shell completion** | Session-ID completion for `ccm resume` and `ccm handoff` across PowerShell, Bash, and Zsh. Completions are ranked: current-project sessions first, then active sessions, then recent activity. No session titles or transcript content are exposed to the shell. |
| **Adaptive ID prefixes**    | `ccm list` shows the shortest globally unambiguous session-ID prefix for each session (minimum 8 chars). Any prefix from this column can be passed directly to `ccm resume` or `ccm handoff`; ambiguous prefixes are refused.                                    |

**Unique to ccm:** qualifier-based scoping, alias search, ranked shell
completion with privacy guarantees, and adaptive ID prefixes. `claude-history`
has fast fuzzy search but no qualifiers, no aliases, no shell completion, and
no cross-project scope.

---

### Usage visibility

Deeper than any competitor. No other tool surfaces live account limits
alongside per-session context size in the same view.

| Feature                      | Detail                                                                                                                                                                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Per-session context size** | Latest context-input token count extracted from each analysed transcript. Shown in session rows; web view sorts by context size descending so the most expensive work rises to the top.                                      |
| **Account limits**           | 5-hour and 7-day usage percentages and reset times. Refreshed from Claude Code's local authenticated usage endpoint at most once every 30 seconds.                                                                           |
| **Status-line integration**  | Reads the Claude Code terminal status line as a secondary source for model, agent, and live context detail. Never silently replaces an existing status line; `ccm usage setup --replace` is required for that.               |
| **Always visible**           | Usage summary is persistent in both the TUI header and web page header — not hidden in a secondary panel or behind a command. Includes current-session usage, weekly usage, and monthly/credit-period usage where available. |
| **Colour-coded thresholds**  | Cyan normally, yellow at 80%, orange at 90%, red at 100%. Applied consistently across TUI, web, and `ccm usage`.                                                                                                             |
| **Freshness transparency**   | Every displayed value shows its last-updated time. Stale or unavailable values are shown as stale/unknown rather than hidden or estimated.                                                                                   |
| **Opt-in, fully reversible** | Usage capture is off by default. `ccm usage setup` enables it; `ccm usage remove` reverses all changes and deletes the local cache. The OAuth token is held in memory only — never logged or written to disk.                |

**Unique to ccm:** account limits + per-session context in the same always-on
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
| **Density toggle**                | `d` switches between comfortable and compact row density. Persisted to user preferences.                                                                                |
| **Bulk archive**                  | `space` toggles session selection (◆ marker). `A` archives all selected. Active sessions are silently skipped and the count is reported. `esc` clears selection.        |
| **Project action menu**           | `space` in the project panel opens a context menu: new session, browse sessions, open in file manager, copy path.                                                       |
| **New session from project**      | `n` launches `claude` in the selected project directory and exits CCM. Also reachable from the command palette and project action menu.                                 |
| **Deep search picker**            | While searching, `tab` switches to full-content transcript search and shows results as a navigable picker.                                                              |
| **Expiry glyph**                  | Sessions approaching the Claude Code cleanup window show `⚠Nd` (days remaining) inline in the session row.                                                              |
| **Archive toggle**                | `a` toggles archive state for the selected session. Archived sessions are hidden by default in both TUI and web.                                                        |
| **Cloud indicator**               | Projects with linked shared storage show `☁` in the project row.                                                                                                        |
| **Search qualifiers**             | All qualifiers available in `ccm list` work in the TUI search bar.                                                                                                      |

---

### Web UI

A passive dashboard designed to stay open in a browser tab while you work.
SSE live updates mean the page never needs a manual refresh. The only tool in
the reviewed landscape that ships both a web UI and session intelligence.

| Feature                            | Detail                                                                                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Filter pills**                   | All · Needs Attention · Active · Archived — one-click filter.                                                                               |
| **Sort controls**                  | Recent (default) or Risk (attention-status sessions first). Project sort: recent activity or project name.                                  |
| **Session Inspector card**         | Right-panel details: status with explanation, message count, compaction count, expiry, session ID copy button, full path.                   |
| **SSE live updates**               | Server-sent events push changes when the transcript directory changes. No polling or manual refresh.                                        |
| **Session context sort**           | Sessions sorted by latest observed context-input size descending. Sessions without analysed context sort last.                              |
| **Full keyboard navigation**       | `j`/`k` navigate sessions; `[`/`]` or `h`/`l` navigate projects; `a` archives; `/` opens search. Guards prevent firing inside input fields. |
| **Deep-linkable sessions**         | The URL hash resolves to a specific project and session on load. Share or bookmark any session directly.                                    |
| **Context menus**                  | Right-click (or keyboard menu key) on a session row shows contextual actions.                                                               |
| **CLAUDE.md editor**               | View and edit each project's instruction file from the web UI. Shown as a tag in the project header when the file exists.                   |
| **Start new session from project** | `+ new` button launches a new Claude Code session in the project directory.                                                                 |
| **Branch drift badge**             | Shown inline on session rows when the recorded branch differs from current git HEAD.                                                        |
| **Status badges**                  | Each session row shows its derived `primaryStatus` badge.                                                                                   |
| **Cloud indicator**                | Projects with linked shared storage show a cloud icon in the project list.                                                                  |

---

### CLI composability

All commands produce concise human output and machine-readable output where
useful. Designed to be scriptable and composable with standard shell tools.

| Command                             | Purpose                                                                                                                                             |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ccm`                               | Open TUI                                                                                                                                            |
| `ccm web`                           | Open browser UI                                                                                                                                     |
| `ccm resume [id]`                   | Interactive global picker, or resume by ID or unambiguous prefix                                                                                    |
| `ccm search <query>`                | Interactive picker with pre-filled search                                                                                                           |
| `ccm search --deep <q>`             | Full-content transcript search with interactive picker                                                                                              |
| `ccm list [query]`                  | Compact human table, globally filtered. `--json` for machine-readable output                                                                        |
| `ccm inbox`                         | Attention-sorted summary of active and at-risk sessions                                                                                             |
| `ccm handoff [session]`             | Compact Markdown continuation packet: last goal, transcript summary, edited files, open todos. Unavailable facts marked explicitly, never inferred. |
| `ccm doctor`                        | Non-destructive local health check                                                                                                                  |
| `ccm usage`                         | Show observed usage and data freshness                                                                                                              |
| `ccm usage setup / remove / toggle` | Manage usage capture integration                                                                                                                    |
| `ccm sync`                          | Open the interactive shared-session-storage panel _(experimental)_                                                                                  |
| `ccm sync link / unlink`            | Manage experimental shared session storage for a project, with an optional explicit path for scripts                                                |
| `ccm config get/set/reset <key>`    | Read and write persistent user preferences                                                                                                          |
| `ccm completion <shell>`            | Print PowerShell, Bash, or Zsh completion setup                                                                                                     |
| `ccm help [command]`                | Show general or command-specific CLI help                                                                                                           |
| `ccm --help / --version`            | Help and version                                                                                                                                    |

`ccm list` filters combine with AND semantics. `--active`, `--attention`,
`--archived`, `--project`, `--status`, `--limit`, `--json` are all composable.

**Unique to ccm:** `ccm handoff` (continuation packet), `ccm inbox`
(attention-sorted summary), and `ccm doctor` (structured health check). No
other reviewed tool ships any of these. Shell completion with ranked suggestions
and adaptive ID prefixes are also absent from all competitors.

---

### Shared session storage

| Feature                   | Detail                                                                                                                                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **ccm sync link**         | Moves a project's session transcripts from `~/.claude/projects/` into `.claude-memory/` inside the project directory, then redirects Claude Code's storage there via a filesystem junction (Windows) or symlink (macOS/Linux). |
| **Cloud sync compatible** | Any cloud folder syncing the project (OneDrive, pCloud, Dropbox, Google Drive) carries the sessions along automatically. No cloud account required in CCM itself.                                                              |
| **Second-machine setup**  | `ccm sync link <path>` on a new machine computes the expected project ID from the path and creates the redirect automatically if no local entry exists.                                                                        |
| **Reversible**            | `ccm sync unlink` restores local-only storage.                                                                                                                                                                                 |
| **Cloud indicator**       | Linked projects show `☁` in TUI and web project rows.                                                                                                                                                                          |

**Unique to ccm:** no other reviewed tool ships a session portability mechanism
of any kind.

---

### Configuration

| Feature                         | Detail                                                                                                                                                      |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Zero-config defaults**        | Works out of the box with `ccm`. No config file required.                                                                                                   |
| **ccm config CLI**              | `ccm config get/set/reset <key>` reads and writes `~/.ccm/prefs.json`.                                                                                      |
| **ccm config TUI**              | Keyboard-navigable Interface, Integrations, and Features tabs. Integrations show their exact effect and are reversible from within the UI.                  |
| **Persistent preferences**      | Density mode, integration state, and (roadmap) theme are persisted across invocations.                                                                      |
| **Theme system** _(roadmap)_    | Dark (current default), Light, and Terminal (phosphor) themes. Single design-token layer — switching themes requires no code changes, only a new token set. |
| **i18n groundwork** _(roadmap)_ | All user-facing strings centralised to `src/config/labels.ts`. Adding a language becomes a data file, not a code change.                                    |

---

### Safety & privacy

| Guarantee                                     | Detail                                                                                                                                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Local-only analysis**                       | All transcript parsing happens on the local machine. No content is ever sent to a remote service.                                                                                    |
| **No telemetry**                              | CCM collects no usage metrics, crash reports, or any other data.                                                                                                                     |
| **Localhost web server**                      | The web server binds to `127.0.0.1` only. Not reachable from other machines.                                                                                                         |
| **Safe transcript handling**                  | Automated cleanup only archives through CCM sidecar metadata. Permanent deletion is an explicit action, is blocked for active sessions, and is never used by background maintenance. |
| **OAuth token in memory only**                | The local Claude Code token used for usage requests is held in memory during the request and never logged or written to disk.                                                        |
| **Credential warning in handoff** _(roadmap)_ | Before emitting a handoff packet, scan for secret patterns (API keys, tokens, env assignments). Warn and require `--force` to proceed. The transcript is never modified.             |

---

## Competitive snapshot

Assessed against the four tools reviewed in the mid-2026 article
[_I tested 4 tools for browsing Claude Code session history_](https://dev.to/gonewx/i-tested-4-tools-for-browsing-claude-code-session-history-17ie).

| Capability                                          |      ccm       | Mantra |  CCHV   | claude-history | Built-in |
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
| Shared session storage (cloud-sync portable)        |       ✓        |   —    |    —    |       —        |    —     |
| CLAUDE.md editor                                    |       ✓        |   —    |    —    |       —        |    —     |
| TUI interface                                       |       ✓        |   —    |    —    |       ✓        |    ✓     |
| Web interface                                       |       ✓        |   —    |    ✓    |       —        |    —     |
| Credential / secret warning before share            |  _(roadmap)_   |   ✓    |    —    |       —        |    —     |
| Files-touched list in session preview               |  _(roadmap)_   |   ✓    |    —    |       —        |    —     |
| Timeline replay / step-by-step code diff            | ✗ out of scope |   ✓    |    —    |       —        |    —     |
| Cross-tool (Cursor, Codex, OpenCode)                | ✗ out of scope |   ✓    |    ✓    |       —        |    —     |
| Zero configuration                                  |       ✓        |   —    | partial |       —        |    ✓     |
| No API key required for core features               |       ✓        |   ?    |    ?    |       ✓        |    ✓     |
| No cloud, no account, no telemetry                  |       ✓        |   —    |    —    |       ✓        |    ✓     |

`✓` = shipped · `—` = absent · `?` = unknown · `*(roadmap)*` = planned · `✗` = intentionally out of scope

---

## What we are intentionally not building

Documented in `Documents/PRODUCT_DIRECTION.md`. Key exclusions relevant to
competitive positioning:

- **Timeline replay / step-by-step code diff** — Mantra's differentiator. Too
  heavy for our light/local mission and does not answer the question CCM is
  built around ("should I resume this session?").

- **Cross-tool support** — CCHV and Mantra support Cursor, Codex, etc. Claude
  Code focus is intentional: it lets us go deeper on Claude-specific signals
  (compaction events, context windows, branch recordings) that don't exist in
  other tools' data formats.

- **Embedded terminal or Electron desktop app** — deliberately unnecessary.
  CCM opens in a terminal or browser tab you already have, starts in under a
  second, and requires no Electron overhead or separate app install. Mantra
  requires a dedicated desktop install.

- **Cloud sync / accounts / team features** — Local-first is a design
  constraint, not a gap. Shared session storage (`ccm sync link`) lets sessions
  travel with a project via any cloud folder the user already syncs.
