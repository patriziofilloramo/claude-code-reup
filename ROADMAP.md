# Swoop Roadmap

## Open bugs

### High

- [ ] **Windows terminal launcher builds shell strings** — `terminal.windows.ts` uses `exec()`
      to construct shell commands. Input paths come from the filesystem (not the browser), so
      practical risk is low, but the pattern is still fragile. Needs dedicated testing on a clean
      Windows environment before any public release. See `terminal.windows.ts`.

- [x] **Public product and package naming resolved** — the product is **Swoop**, the CLI command is
      `swoop`, and the available npm package name is `claude-code-swoop`.

- [x] **Web layout breaks on small screens** — resolved: two-breakpoint responsive pass.
      640–899 px: left panel shrinks (min-width 160 px), header keyboard hints hidden.
      ≤639 px: single-panel mode — one column visible at a time, back button navigates
      from session panel to project list, dialog overflow fixed, filter bar wraps.

### Medium

- [x] **No metadata cache / SSE debounce** — resolved: 2 s in-process cache keyed on projects
      directory path; invalidated before filesystem notifications and after sidecar mutations.

### Won't fix

- **`sessions-index.json` `entries` key** — not a format Claude Code produces. Will fix if schema changes.
- **Parser stores first branch/cwd, not latest** — intentional: resume-target semantics.

---

## Recommended next focus

Swoop's near-term product bets are:

1. **Milestone 12 — Organization layer**: Phase 1, 2 (code), and 3 are shipped. One gap remains:
   5 unit tests (2i) and a manual smoke of the `t → tag → chip → focus` flow. Once those pass,
   M12 is closed. Phase 4 (advanced) is deferred until real-world use.
2. **Milestone 13 — Live web control panel**: make `swoop web` worth keeping open while working.
   It should show what is active, changing, risky, or close to a limit without becoming a chat UI.
3. **Milestone 11 — VS Code Workspace Cockpit**: shipped. Remaining: smoke test on clean Windows
   and macOS, and fix the Windows terminal launcher before public release.

**Recommended order:** write the 5 missing Phase 2i tests and run the manual smoke (one short
session). Then move to Milestone 13 — the live web panel is the next product differentiator and
builds cleanly on the existing SSE and live-usage infrastructure. The VS Code extension can absorb
org vocabulary (tags, groups, stacks) as a follow-on after M13 proves the data contracts stable.

---

## Milestone 2 — Session signals ✓ done

- [x] Replace single `SessionStatus` with independent `SessionSignals` (archived, interrupted,
      lastToolFailed, compactionCount, expiresInDays, pathExists, analysisComplete)
- [x] `primaryStatus()` — derived display helper, never stored
- [x] `computeSignalsFromLines()` — exported pure function, fully unit-tested
- [x] Fix compaction detection: `compact_boundary` system event (not `type:summary`)
- [x] Fix parallel tool interrupted detection: Set\<toolUseId\> instead of boolean flag
- [x] Fix `lastToolFailed` false positives: reset on pure-text assistant recovery turn
- [x] Fix path-missing: `access()` per unique `session.projectPath`, not just canonical project
- [x] `null` vs `false/0` for fast-path unanalysed fields (`interrupted`, `lastToolFailed`,
      `compactionCount` are `null` when `analysisComplete: false`)
- [x] Swoop sidecar `swoop.json` with per-process serialised atomic write queue
- [x] Archive and alias backend + web UI + TUI toggle (`a` key)
- [x] Alias rename web UI (inline edit on selected row)
- [x] Body validation for archive/alias API endpoints
- [x] Alias max length 160 chars (trim + slice in route and backend)
- [x] Alias included in TUI, web, and `/api/search` queries
- [x] Status badges in web session rows
- [x] Expiry glyph in TUI: `⚠Nd` (shows days remaining)
- [x] `primaryStatus` added to all session API responses
- [x] Core signals, loading, lock resilience, route, and web-client regression tests

---

## Milestone 3 — Smart views & inspector ✓ done

- [x] **Filter pills** (web): All | Needs Attention | Active | Archived — replaces show-archived toggle
- [x] **Sort control** (web): Recent (default) | Risk (attention-status sessions first)
- [x] **Session Inspector** card: status + explanation, message count, compaction count, expiry, session ID copy, full path
- [x] **Branch drift** indicator: recorded branch ≠ current git HEAD per session path, shown in
      web and TUI
- [x] **Lost & Found** panel: expiring, path-missing, and orphaned-transcript sessions via `/api/diagnostics`
- [x] **Metadata cache**: 2 s in-process TTL keyed on projects directory; filesystem and sidecar
      invalidation plus slow periodic refresh
- [x] **Project sort** (web): recent activity (default) or project name

---

## Milestone 4 — Handoff & CLI ✓ done

- [x] `swoop handoff <session>` — compact Markdown continuation packet from transcript-supported facts
- [x] `swoop inbox` — terminal summary of active and non-archived sessions needing attention
- [x] `swoop doctor` — non-destructive diagnosis of stale locks, broken indices, orphaned transcripts,
      and missing session paths; shared with web Lost & Found
- [x] `swoop list --json` — stable, machine-readable session dump with project, activity, and signals
- [x] Extend `swoop list`: compact human table by default, full JSON with `--json`, global free-text
      search, and composable active/attention/archived/project/status/limit filters
- [x] Make compact list ID prefixes directly usable: globally unique adaptive prefixes, safe
      prefix resume, and opt-in PowerShell/Bash/Zsh session-ID completion
- [x] Rank shell-completion suggestions by current project, active state, and recent activity
- [x] Open a compact global, searchable picker when interactive `swoop resume` has no selector

---

## Milestone 5 — Usage visibility ✓ done

Make the limits that determine whether work can continue visible before they become a surprise.
Implementation is complete for all locally available data sources. Items that require an undocumented
Anthropic API (plan name, credit spending detail, routine allowances) are tracked separately in
[Milestone 10](#milestone-10--usage-api-dependent-features).

- [x] Research and document authoritative data sources, trust boundaries, and privacy rules in
      [`Documents/USAGE_VISIBILITY.md`](Documents/USAGE_VISIBILITY.md)
- [x] Extract transcript-supported model history, latest model, latest context-input tokens, and
      latest output tokens; expose them in web, TUI, and `swoop list --json`
- [x] Add an explicit, reversible account-limit integration that refreshes 5-hour and 7-day
      percentages/reset times, keeps credentials in memory only, and uses status-line observations
      as a fallback without silently replacing an existing status line
- [x] **Persistent usage summary** in the web header and TUI chrome:
      current-session usage, weekly usage, and monthly/credit-period usage where available
- [x] Show supported percentage used, reset countdown, and last-updated time
- [x] Show a best-effort positive badge when Claude Code local state explicitly reports usage credits
      enabled; never infer activation from spend or limit data
- [x] Sort web sessions by latest observed context size; sessions without analysed context sort last
- [x] Use consistent limit colours everywhere: cyan normally, yellow at 80%, orange at 90%, and
      red at 100%
- [x] Gracefully handle plan differences and unavailable fields. Pro, Max, Team, Enterprise, credits,
      weekly/monthly windows, and routine allowances may expose different data
- [x] Keep usage data local, avoid telemetry, and document exactly what is read and retained

---

## Milestone 6 — UI polish ✓ done

- [x] **Global search by default** across projects and sessions in both TUI and web; match project
      name/path, session name/alias/ID, and branch, then navigate directly to the selected result
- [x] **Configuration foundation**: `swoop config get/set/reset` CLI,
      `~/.claude/swoop/prefs.json` persisted
      per-user preferences, zero-config defaults, extensible for future keys
- [x] **Configuration TUI**: `swoop config` with keyboard-navigable Interface, Integrations, and
      Features tabs; integrations show their exact effect and remain reversible
- [x] Manage live usage and shell-completion integrations through `swoop config`, while preserving
      the existing explicit setup/remove commands
- [x] Add explicit search scopes/qualifiers (`project:`, `branch:`, `status:`, `is:active`,
      `is:archived`); search semantics unchanged for plain-text queries
- [x] Global command palette (`Ctrl+K`) — lists all contextual commands with keybindings, live
      text filter, runs on enter; also accessible from the command palette entry in the footer
- [x] Comfortable / Compact density toggle (`d` key); persisted to user prefs
- [x] **Bulk archive** — `space` to toggle session selection (◆ marker), `A` archives all selected;
      esc clears selection; footer shows selection count and available actions
- [x] **Safe cleanup UX**: archive blocks active sessions with a flash message; bulk archive
      silently skips any active sessions and reports the count; archive is the only destructive action
- [x] Keyboard navigation throughout (web) — `j`/`k` navigate sessions, `[`/`h` and `]`/`l`
      navigate projects, `a` archives the selected session; all guarded against input fields
- [x] Deep-linkable sessions — `selectSession()` writes `#<sessionId>` to the URL hash; on first
      page load the hash is resolved to the matching project + session
- [x] **Deep search inline filter** (web) — Tab inside the `/` search bar scans session transcripts
      and replaces the session list with matched results + snippets; cyan border indicates deep mode
- [x] **Start new session from project** (`+` button on project row, `n` key in TUI) — launch
      `claude` in the selected project directory; also accessible from the command palette and
      project action menu
- [x] **Remote-active session indicator** — sessions with no local lock file but a transcript
      modified in the last 5 minutes show a hollow dot `◌` instead of `●` in the TUI
- [x] **Project action menu** (`space` in project panel) — focused context menu for the selected
      project with actions: new session, browse sessions, open in file manager, copy path

---

## Milestone 7 — Code refactoring and cleanup ✓ done

The codebase has grown organically across six milestones. Now that the full feature surface is
clear, a dedicated cleanup pass will improve maintainability, reduce duplication, and make future
milestones faster to implement. No visible behaviour changes — this is purely internal.

- [x] **Web client modularisation** — split `client.js` (1830 lines) into 15 segment files under
      `src/web/client/` (01-config through 15-data); `scripts/build-client.mjs` concatenates them
      back into one IIFE-wrapped output; `pretest` hook keeps `client.js` in sync automatically;
      all `client-regressions` tests continue to pass unchanged
- [x] **Shared type layer** — `src/web/api-model.ts` is the single source of truth for all API
      response shapes (`ApiProject`, `ApiSession`, `ApiLaunchResponse`, etc.); server routes and
      client parsing both reference it, eliminating the duplication
- [x] **Route consolidation** — `apiRoute` / `guardedRoute` wrappers in `src/web/routes/` unify
      error handling and response envelopes across all route files
- [x] **CSS cleanup** — removed dead `.p-cloud--offline` rule (amber `⚠` icon from an earlier
      branch, superseded by the `☁` coloured via `p-cloud--stale`); `styles.css` is now 1209 lines
- [x] **Core module boundary cleanup** — renamed terminal platform modules to kebab-case
      (`terminal-{shared,unix,windows}.ts`); resolved post-merge duplicate `initCloudSync` /
      `guardOfflineLinks` calls in `server.ts`; `syncRegistry` breaks the project-discovery →
      cloud-sync circular dependency
- [x] **Test coverage gaps** — added `tests/core/cloud-sync.test.ts` covering `stopSyncLoop`
      idempotency, bidirectional copy, append-only propagation, conflict detection, recursive descent,
      skip `.swoop-link`); added `tests/core/device-id.test.ts` (4 cases: create, persist, read
      existing); also fixed a `syncBidirectional` bug where A-only subdirectories were silently
      skipped instead of being created in B; total test count: 194 (was 180)

---

## Milestone 7.5 — Cross-device sync (local-first) ✓ done

Share Claude Code sessions and memory across multiple machines without a server.
Uses NTFS junctions / symlinks to redirect Claude Code's per-project directory into
a shared cloud folder (pCloud, Dropbox, OneDrive, etc.) managed entirely by the OS.
No server, no auth — the cloud provider handles transfer.

> ⚠ Experimental: see `CHANGELOG.md` for known risks and the backup procedure.

- [x] `swoop sync link [path]` — creates a per-project NTFS junction pointing the Claude Code
      project directory at a shared cloud folder; backs up existing local sessions first
- [x] `swoop sync unlink [path]` — restores the local directory; sessions written while linked
      remain accessible through the shared folder
- [x] **Sync registry** (`syncRegistry`) — in-memory `Map` of junction paths to cloud state;
      avoids circular imports between discovery, sync, and memory modules
- [x] `initCloudSync()` / `stopSyncLoop()` — startup guard that verifies junction targets
      on launch; replaces offline junctions with a local backup so sessions remain writable
      while the cloud drive is unmounted; restores on reconnect
- [x] **Cloud indicator in TUI and web** — `☁` icon coloured green (online), grey (cloud
      offline / sync paused), or orange (one or more devices used the project without
      running `swoop sync link`)
- [x] **Offline guard** — new sessions are blocked when a project's cloud storage is
      unreachable; flash message informs the user and resumes automatically on reconnect
- [x] `swoop sync link [path]` / `swoop sync unlink [path]` — inject / remove a
      `<!-- swoop:sync:start/end -->` section in the project's `CLAUDE.md` that instructs
      Claude Code on any device to: detect whether the device is linked, write a presence
      file when it is not, warn once, and silently skip after the user dismisses the warning
- [x] **Cross-device CLAUDE.md protocol** — all check files live inside the shared cloud
      folder so Claude Code needs only `hostname` (via Bash) and file access inside the
      project to run the protocol; no extra permissions required
- [x] **Unlinked-device detection** — linked devices scan `{cloudDir}/device-presence/` on
      each discovery pass and surface device names as `unlinkedDevices[]` on the `Project`
      object; orange cloud indicator prompts the user to run `swoop sync link` on that device
- [x] **Append-only shared memory** — unlinked devices append context to
      `{cloudDir}/memory/shared.md` under a `## HOSTNAME — date` header; avoids pCloud
      conflict copies that would arise from concurrent rewrites

---

## Milestone 8 — Growth: themes and i18n ✓ done

### Theme system

- [x] Unified design-token schema (`ThemeTokens` interface in `src/config/theme-tokens.ts`) covering
      every value used by TUI and web; a theme is a plain object satisfying the interface
- [x] Three themes shipped: **Dark** (default), **Light**, **Terminal** (phosphor/CRT)
- [x] `swoop --theme <name>` CLI — saves preference and applies immediately
- [x] Theme selection in `swoop config` Interface tab (keyboard-navigable, live preview)
- [x] Web theme cycle button in footer (◐ dark → ○ light → █ terminal → repeat); persisted via
      `/api/theme` and injected as CSS custom properties at serve time
- [x] Matrix rain Easter egg — triggered by holding the Terminal theme logo ≥ 3 s in the web UI;
      full canvas animation with phosphor-green columns; does not affect the default experience
- [x] Token schema is self-documenting: `ThemeTokens` interface mirrors CSS custom-property names
      so community themes require no build changes

### i18n groundwork

- [x] All TUI user-facing strings centralised to `src/config/labels.ts` (flat map, no library)
- [x] `no-raw-ui-strings` ESLint rule in `src/config/eslint-rules/`; active at `warn` level on
      `src/tui/**` via `eslint.config.js`; fix path is `LABELS.xxx`
- [ ] Extend lint coverage to `src/cli/**` and `src/web/routes/**`
- [ ] Document contribution path: adding a language = parallel labels file + README section

---

## Milestone 8.5 — Config & CLI polish ✓ done

Improvements shipped after M8:

- [x] **Command registry** (`src/tui/commands.ts`) — single `COMMANDS` array with `visibleWhen`
      named conditions; `resolveVisibility()` in `App.tsx` replaces scattered per-command checks;
      HelpOverlay and CommandPalette both derive from the same source of truth
- [x] **`swoop sync`** — renamed from the earlier memory-command prototype throughout: file,
      exports, CLI dispatch, help
      text, documentation, and all user-facing strings; `memory` kept as a backwards-compat alias
- [x] **Sync tab in `swoop config`** — interactive cursor navigation over unsynced and synced
      projects; Enter to link/unlink inline without leaving the TUI; uses `linkProjectForTUI` /
      `unlinkProjectForTUI` wrappers that suppress console output during TUI operation
- [x] **3-state startup cleanup** — `autoCleanupOnStart: 'off' | 'on' | 'auto'`; `auto` silently
      archives only high-confidence candidates; boolean migration in `readUserPrefsSync()` for old prefs
- [x] **Config UI style unification** — Integrations and Features tabs show status bullet inline
      with title (consistent across all tabs); Features tab describes each state in plain text
- [x] **`swoop --help` fixes** — cleanup is described consistently as reversible archiving; removed `[key=val]`
      from `swoop config` line
- [x] **Density toggle removed** — `d` key and comfortable/compact density removed from TUI;
      two stale label keys (`cmdDensityComfortable`, `cmdDensityCompact`) remain in `labels.ts`
      and should be cleaned up

---

## Milestone 9 — Distribution and installers

Make installation feel native and require no repository clone, build step, or
manual shell setup. Detailed behavior is defined in
[`Documents/INSTALLATION.md`](Documents/INSTALLATION.md).

- [x] Resolve the public product/package name before producing signed artifacts
- [ ] Build self-contained, per-user installers for Windows, macOS, and Linux
- [ ] Add the installed `swoop` launcher to the current user's `PATH`
- [ ] Windows installer: offer pre-selected PowerShell completion integration
      for Windows PowerShell 5.1 and PowerShell 7
- [ ] Install shell completion as a managed, idempotent, reversible integration;
      back up profiles before first modification and remove only Swoop-owned blocks
- [ ] Ensure the Windows launcher works without weakening PowerShell execution policy
- [ ] Add upgrade, repair, and uninstall verification on clean platform environments
- [ ] Publish checksums and document artifact provenance/signing

---

## Milestone 10 — Usage: API-dependent features

These items were scoped during Milestone 5 but require data sources not yet exposed by the
Anthropic API. They are tracked here and will be re-evaluated when the API stabilises.

- [ ] Show plan name when a supported source exposes it
- [ ] Show usage-credit spending and reset date when enabled; clearly distinguish included limits
      from paid overage credits
- [ ] Show included routine-run allowance and consumption when the account exposes it
- [ ] Show agent/subagent history per session when a reliable local source is available

---

## Milestone 11 — VS Code Workspace Cockpit ✓ done

Shipped a full-screen Swoop Workspace Cockpit inside VS Code. The extension
bundles selected `src/core` modules directly — no installed `swoop` binary
required. All go/no-go criteria were met.

### Shipped

- [x] Full-screen `SwoopDashboard` webview: workspace-first project/session
      discovery, progressive detail loading, structured metadata search,
      explicit transcript search, live usage, and context menus
- [x] `SessionResumeService`: centralized resume-destination selection across
      dashboard, Inspector, tree, and Quick Picks; optional persistent
      preference between Claude Code extension and integrated terminal
- [x] Activity Bar tree with current-workspace, attention-elsewhere, and
      recent-global sections; stable node identity across refreshes
- [x] `Swoop: Resume Here` Quick Pick — workspace-first ranking (path match →
      git branch match → active → attention → recency)
- [x] `Swoop: Resume Session` global Quick Pick with health badges, branch,
      project, relative time, active/attention flags, TODO/plan hints
- [x] `Swoop: Search Sessions` — structured query search via shared core query
      parser (`session-query.ts`)
- [x] CSP-restricted Session Inspector webview: goal, progress, plan, TODOs,
      context, branches, file links, tags, and passive Project Memory state
- [x] Deterministic Resume Advice for missing paths, active sessions, branch
      drift, interrupted work, expiry, compaction, and safe resume
- [x] Compact active/attention status bar; live usage via shared usage cache
- [x] Safe local actions: resume, handoff, alias, archive/undo, and reveal
- [x] Focus-neutral refresh: tree nodes retain stable IDs; dashboard restores
      focused control, input caret, and scroll position around DOM updates
- [x] Event-driven watch mode: filesystem bursts coalesced and rate-limited;
      hidden views not invalidated; structural no-ops produce no refresh
- [x] All go/no-go criteria satisfied: beats native picker for workspace
      sessions, reuses core intelligence, local-first, no added CLI weight

### Remaining

- [ ] Extension host manual smoke test (activation, Quick Pick, tree refresh,
      integrated-terminal launch) on a clean Windows and macOS environment
- [ ] Windows terminal launcher (`terminal.windows.ts`) needs dedicated testing
      before any public release — see open bug above

---

## Milestone 12 — Organization layer: tags, groups, and work stacks

Make Swoop useful when Claude Code work stops being "a list of folders" and becomes many
parallel investigations, branches, fixes, reviews, and half-finished threads. The goal is a
lightweight organisation layer that feels faster than filing things manually.

See [`Documents/MILESTONE_12_PLAN.md`](Documents/MILESTONE_12_PLAN.md) for the full spec,
Inbox bucket definitions (as implemented), and Phase 4 advanced ideas.

### Status: Phase 1, 2, 3 shipped — test hardening remaining

**Phase 1 — Foundation** ✅ complete  
**Phase 2 — Web Organization UI** ✅ complete (code), 🔲 tests pending  
**Phase 3 — TUI + CLI parity** ✅ complete  
**Phase 4 — Advanced** deferred until MVP is proven in real use

### What shipped

- `org.json` infrastructure: `readOrgData()`, `withOrgLock()`, atomic write, advisory lock,
  SSE watcher, `filterProjectsByOrg()` shared across web/TUI/CLI
- Session tags and project tags in `swoop.json`; `Session.tags`, `Project.group`, `Project.projectTags`
- Full org CRUD: groups, stacks, stack items, project-group assignments
- API routes: `/api/org/**`, tag mutation endpoints, `?group`/`?stack`/`?tag` project filters
- Web left rail: Inbox (7 priority buckets), Stacks, Groups — all collapsible, `localStorage`-persisted
- Web focus bar, session/project chips (max 2 + overflow), clickable tag filters
- Tag picker (`t`), group/stack picker (`g`), context menu additions, inspector org editor
- "Save as stack" from search or Smart View focus
- TUI: chips, group labels, `f` cycle focus, command palette entries, source/freshness labels
- CLI: `--tag`, `--group`, `--stack` filters; `--json` includes tags/group/projectTags; no HTTP

### Inbox buckets (as implemented — priority order, exclusive assignment)

| Bucket | Condition |
|---|---|
| Active now | session.id ∈ activeSessionIds |
| Needs attention | interrupted ∥ lastToolFailed (narrower than original plan — each problem has its own bucket) |
| Branch drift | gitBranch ≠ currentBranch |
| Path missing | !pathExists |
| High context | latestContextTokens ≥ 150 000 |
| Expiring soon | expiresInDays ≤ 7 |
| Recently touched | updated within RECENT_WITHIN_DAYS |

### Remaining before M12 is closed

- [ ] **Unit tests (2i)** — 5 tests not yet written:
  - Inbox bucket assignment: priority ordering, archived sessions excluded
  - Smart View counts from fixture projects
  - Focus filter applied to project/session list
  - Chip overflow cap (`buildTagChipsHtml(tags, max)`)
  - Tag picker recent-first sort
- [ ] **Manual smoke**: `t` → tag applied → chip visible in row → click chip → focus filters sessions → `×` clears focus

### Why this matters

### Phase 4 — Advanced (deferred)

After real-world use proves the MVP:

- [ ] `--todo pending` and `--planned` CLI filters (require transcript scan)
- [ ] Suggested tags from branch prefix, folder name, and status signals (opt-in in config)
- [ ] Portable org export: `swoop org export` → `org.json` + all `swoop.json` tags
- [ ] Org import with merge strategy
- [ ] Quick clean sweep — bulk archive from group/stack, skips active sessions
- [ ] Drag-to-stack (after `g` picker is proven sufficient)
- [ ] TODO-aware and plan-aware triage (requires `hasTodos`/`hasPlans` persisted in sidecar)

---

## Milestone 13 — Live web control panel

Make `swoop web` worth keeping open on a second monitor or browser tab while Claude Code runs in a
terminal. The web UI should become a quiet operations panel: active sessions, live limits, recent
tool activity, and attention signals update without the user refreshing or switching context.

### Why this matters

The TUI is great for intentional navigation. The web UI can win a different use case: **passive
awareness while working**. A developer should glance at Swoop and know:

- which Claude session is active right now
- whether it is using tools, waiting, interrupted, or recently wrote output
- whether context or account limits are becoming dangerous
- whether the active project/session changed underneath them
- which session deserves attention next

### Product direction

- [ ] **Live Activity Strip** — a top or right-side strip showing active sessions with state:
      running, recently changed, waiting, interrupted, remote-active, or stale
- [ ] **Selected-session heartbeat** — when a selected session changes, show last update time,
      latest event type, latest tool name, and whether output is still moving
- [ ] **Tool trace** — compact last-tool display: `Edit`, `Read`, `Bash`, `Write`, failed tool,
      or pending tool. No transcript streaming; just operational state.
- [ ] **Context/limit meters** — persistent current-session and weekly/monthly account limit bars,
      with freshness and reset time visible. Never show stale data as live.
- [ ] **Attention feed** — small chronological feed of actionable events: session became active,
      tool failed, path missing, branch drift, high context, session expiring, orphan found.
- [ ] **Live Resume Card refresh** — refresh the selected session's Resume Card when transcript
      changes, but debounce enough to avoid distracting flicker.
- [ ] **Pinned watch list** — pin up to a few projects/sessions to the live panel. This pairs well
      with Milestone 12 work stacks.

### Live signal model

- [ ] Split live data into explicit freshness states: `live`, `recent`, `stale`, `unavailable`
- [ ] Reuse existing SSE for project/session changes; add narrowly scoped event payloads only if
      polling the whole project list becomes visibly wasteful
- [ ] Track latest transcript mtime per active session and derive a "last changed" heartbeat
- [ ] Extract latest tool event from transcript tail only, not by reparsing full transcripts on every
      tick
- [ ] Treat account usage separately from session context; label both clearly
- [ ] Display "updated X ago" beside every live meter whose value can go stale

### Web UI shape

- [ ] Header: compact usage bars remain visible but cleaner; stale values become dim with clear text
- [ ] Right panel: selected-session live card above/beside Resume Card
- [ ] Optional bottom rail: active sessions and attention feed, collapsible
- [ ] Use subtle motion only for state changes, never constant animation
- [ ] Keep row density readable; live indicators should clarify, not decorate

### Safety and performance

- [ ] Add feature toggle in `swoop config`: live web panel on/off
- [ ] Respect `SWOOP_NO_OPEN` and localhost-only web server constraints
- [ ] Avoid transcript tail reads more often than necessary; batch updates per project
- [ ] Never expose secret transcript content in the live feed; tool names, file paths, and statuses
      are enough for the first version
- [ ] Degrade gracefully when usage integration is disabled or unavailable

### MVP slice

1. [ ] Live activity strip for active/recent sessions
2. [ ] Selected-session heartbeat with latest tool/status and last update time
3. [ ] Freshness-aware usage bars in the web header and detail panel
4. [ ] Attention feed with only high-signal events
5. [ ] Config toggle and tests for freshness, throttling, and stale display

### Product guardrails

- [ ] Do not build a transcript viewer or chat clone
- [ ] Do not imply "live" when the source has not updated recently
- [ ] Do not add noisy notifications by default; this is a glanceable dashboard, not an alarm system
- [ ] Prefer "calm useful state" over animation-heavy monitoring UI

---

## Backlog

### Nice-to-have (validated by competitive analysis, mid-2026)

- [ ] **Credential/secret warning in `swoop handoff`** — Before emitting the handoff Markdown packet,
      scan the session transcript for common secret patterns: `sk-...`, `ANTHROPIC_API_KEY=`,
      `Bearer ...`, `.env` style assignments, and long hex/base64 tokens. Print a warning count
      and require explicit `--force` (or confirmation prompt) before outputting. Never modify
      transcript content. Competes directly with Mantra's credential-redaction feature but stays
      read-only and local-first. Maps to "Is it safe to share this?" — priority filter #2.

- [ ] **Files-touched list in resume card** — Populate the "Recently touched files" field in the
      resume card by extracting `tool_use` write/edit/create events from the session JSONL. Show a
      compact deduplicated list capped at ~5 paths with a `+N more` overflow. No diff, no replay —
      just the file names. Closes a gap all four reviewed tools have: you can see what Claude _said_
      but not what it _changed_. Priority filter #1 (helps decide whether to resume).

### Advanced — requires API key / opt-in

These features intentionally sit outside the core tool. Swoop's design goal is zero-config,
lightweight, and local-first. Anything here requires an explicit user action to enable and
must never activate automatically or affect the default experience.

- [ ] **AI session renaming** — `swoop rename-sessions [project]` reads the first ~10 messages of
      each un-aliased session, calls the Claude API to suggest a concise meaningful name, then
      shows a preview table before writing anything. `--apply` to commit. Requires
      `ANTHROPIC_API_KEY`. Estimate token cost upfront. Never overwrites existing aliases.

---

## To Be Checked Yet

Ideas that need more investigation before committing to a milestone. May be promoted, deferred,
or dropped after evaluation.

### VS Code implementation

Promote from Milestone 11 discovery only after the extension has a clear MVP
that beats a simple native picker workflow. See the Milestone 11 go/no-go
criteria.

### Live web control panel

Promoted to [Milestone 13](#milestone-13--live-web-control-panel).

---

## What is explicitly out of scope

| Item                             | Reason                                               |
| -------------------------------- | ---------------------------------------------------- |
| npm publish                      | Local stable version first; package name selected    |
| Server-based cloud sync / auth   | Local-first only; OS-level junctions via pCloud etc. |
| Required/free-form config files  | Zero-config remains a design constraint              |
| Support for non-Claude-Code CLIs | Claude Code only                                     |
| Backup / restore of transcripts  | Out of scope; archive = hide only                    |
