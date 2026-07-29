# Reup Roadmap

## Open bugs

### High

- [x] **Windows terminal launcher shell-string blocker resolved** — `terminal.windows.ts` now
      uses structured `execFile()` / `spawn()` launch paths for Windows Terminal, PowerShell,
      and detached `cmd`, with argument-structure regression tests in
      `tests/core/terminal-windows.test.ts`. Clean Windows manual smoke remains part of
      release validation, but the fragile `exec()` implementation is no longer present.

- [x] **Public product and package naming resolved** - the product is **Reup**, the CLI command is
      `reup`, and the npm package identity is `@patriziofilloramo/reup`.

- [x] **Web layout breaks on small screens** — resolved: two-breakpoint responsive pass.
      640–899 px: left panel shrinks (min-width 160 px), header keyboard hints hidden.
      ≤639 px: single-panel mode — one column visible at a time, back button navigates
      from session panel to project list, dialog overflow fixed, filter bar wraps.

### Medium

- [ ] **A VS Code session blocked on a permission prompt is not indicated** — it renders as
      "running" (green, pulsing) on every surface, so a session waiting on the user looks like
      one that is working. Measured 2026-07-28: `claude-vscode` peer locks omit the `status`
      field, and no hook work marker existed for the session despite the attention hooks being
      installed — so `combineWorkEvidence` returns `null` and `resolveActivityState` falls back
      to transcript recency, where a pending `tool_use` reads as `running`.

      `isAwaitingUserReply()` (`session-tail.ts`) already handles the shape, but only for
      `AskUserQuestion` / `ExitPlanMode` when the work status is unknown — a permission prompt
      on `Bash` is not covered, and covering it needs a way to tell "tool in flight" from "tool
      awaiting a decision" without a turn-boundary signal. Note this was never indicated
      correctly: before the `stateIsReported` gate the amber dot shown here marked *pauses*, not
      stalls, which is why it also fired throughout long tool calls.

      Prerequisite for judging any fix: find out whether the VS Code extension fires
      `UserPromptSubmit`/`Stop` hooks at all. If it does, the marker path already solves this and
      the bug is really "markers are missing"; if it does not, Reup needs a transcript-only
      signal for the blocked state.

- [x] **No metadata cache / SSE debounce** — resolved: 2 s in-process cache keyed on projects
      directory path; invalidated before filesystem notifications and after sidecar mutations.

### Won't fix

- **`sessions-index.json` `entries` key** — not a format Claude Code produces. Will fix if schema changes.
- **Parser stores first branch/cwd, not latest** — intentional: resume-target semantics.

---

## Recommended next focus

Core milestones are closed:

- **Milestone 12 — Organization layer**: ✓ closed. Phases 1–3 shipped; 2i unit tests passing;
  manual smoke signed off. Phase 4 (advanced) deferred until real-world use.
- **Milestone 13 — Live web control panel**: ✓ closed lean. Strip, heartbeat, and freshness-aware
  meters shipped and unit-tested; config toggle + attention feed archived to protect zero-config.
- **Milestone 11 — VS Code Workspace Cockpit**: shipped (smoke on clean Windows/macOS pending).

**Current release focus:** Milestone 9 public-release hardening. Keep the first
public surface lightweight, local-only, installer-first, and easy to support.
Blocked items (M10 / Phase 4 / AI renaming) stay parked until the release is
ready.

- **Milestone 14 — Attention system**: ✓ shipped (2026-07-02). `reup attention`
  registers a reversible Claude Code Notification hook; sessions waiting on a
  permission decision or idle input are pinned red in the web live strip with
  desktop notifications, and pulse with a terminal bell in the TUI. Turn
  completion is detected from lock busy→idle transitions with no extra hook.
  Deliberately local-only: no webhook/ntfy delivery in the first release.

---

## To Be Discussed

Open product decisions, not yet made. Nothing here blocks the current release scope;
each item stays parked until explicitly decided.

- **Package signing and notarization** — Windows code-signing certificate, macOS Developer ID
  signing + notarization, and whether to pursue either at all for the first public release vs.
  staying unsigned/RC-only for longer. Budget and "do we want an official distribution channel
  yet" are both open. Once decided, covers the two remaining M9 checkboxes: publishing signed
  checksums/detached signatures/CI-backed provenance attestations, and the signed/notarized
  entries in `Documents/INSTALLATION.md`'s Platform Matrix.
- **Linux `.deb`/`.rpm` packages** — `Documents/INSTALLATION.md` documents these as intentional
  later-phase work; only the portable `.tar.gz` exists today. Needs a decision on whether
  package-manager-native installers are worth building before or independently of signing.
- **CI-backed provenance vs. local-only** — `release:local` already generates
  `provenance.local.json` and CycloneDX SBOMs locally; whether to wire actual CI-attested
  provenance (e.g. SLSA-style) is unscoped and tied to whether/when this project gets a real CI
  release pipeline instead of local RC builds.
- **Clean-VM installer verification** — upgrade, repair, and uninstall have only been verified
  from this dev machine (see Milestone 9's "Add upgrade, repair, and uninstall verification"
  item for what was and wasn't covered). Needs actual clean Windows/macOS/Linux VMs; not
  blocking further development, but blocking calling M9 done.
- **Minor: live-activity state during a background task** (raised 2026-07-22) — Reup's
  running/waiting/idle detection reflects Claude Code's own turn state (`UserPromptSubmit` /
  `Stop` hooks), not whether a background OS process a tool call spawned is still executing.
  Observed directly: a session showed `idle` while a multi-minute `release:installers` build
  was still running in the background, because Claude's own turn had already ended. This is
  arguably correct as designed (the assistant genuinely was idle), but whether a distinct
  "idle with background work outstanding" state would be useful is an open, low-priority UX
  question — not investigated further.

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
- [x] Reup sidecar `reup.json` with per-process serialised atomic write queue
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

- [x] `reup handoff <session>` — compact Markdown continuation packet from transcript-supported facts
- [x] `reup inbox` — terminal summary of active and non-archived sessions needing attention
- [x] `reup doctor` — non-destructive diagnosis of stale locks, broken indices, orphaned transcripts,
      and missing session paths; shared with web Lost & Found
- [x] `reup list --json` — stable, machine-readable session dump with project, activity, and signals
- [x] Extend `reup list`: compact human table by default, full JSON with `--json`, global free-text
      search, and composable active/attention/archived/project/status/limit filters
- [x] Make compact list ID prefixes directly usable: globally unique adaptive prefixes, safe
      prefix resume, and opt-in PowerShell/Bash/Zsh session-ID completion
- [x] Rank shell-completion suggestions by current project, active state, and recent activity
- [x] Open a compact global, searchable picker when interactive `reup resume` has no selector

---

## Milestone 5 — Usage visibility ✓ done

Make the limits that determine whether work can continue visible before they become a surprise.
Implementation is complete for all locally available data sources. Items that require an undocumented
Anthropic API (plan name, credit spending detail, routine allowances) are tracked separately in
[Milestone 10](#milestone-10--usage-api-dependent-features).

- [x] Research and document authoritative data sources, trust boundaries, and privacy rules in
      [`Documents/USAGE_VISIBILITY.md`](Documents/USAGE_VISIBILITY.md)
- [x] Extract transcript-supported model history, latest model, latest context-input tokens, and
      latest output tokens; expose them in web, TUI, and `reup list --json`
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
- [x] **Configuration foundation**: `reup config get/set/reset` CLI,
      `~/.claude/reup/prefs.json` persisted
      per-user preferences, zero-config defaults, extensible for future keys
- [x] **Configuration TUI**: `reup config` with keyboard-navigable Interface, Integrations, and
      Features tabs; integrations show their exact effect and remain reversible
- [x] Manage live usage and shell-completion integrations through `reup config`, while preserving
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
- [x] **CSS cleanup** — removed dead and duplicated web styles; project/session
      rows keep fixed metadata columns
- [x] **Core module boundary cleanup** — renamed terminal platform modules to kebab-case
      (`terminal-{shared,unix,windows}.ts`); clarified route and discovery boundaries
- [x] **Test coverage gaps** — broadened core and browser-client regression
      coverage around discovery, metadata, and UI invariants

---

## Milestone 7.5 — Deferred Project Memory Sync

The experimental Project Memory work was removed before the first public
release. The design and implementation notes are preserved in
[`Documents/DEFERRED_PROJECT_MEMORY_SYNC.md`](Documents/DEFERRED_PROJECT_MEMORY_SYNC.md).
It may return only as a separate explicit milestone with a fresh safety,
privacy, recovery, and support review.

---

## Milestone 8 — Growth: themes and i18n ✓ done

### Theme system

- [x] Unified design-token schema (`ThemeTokens` interface in `src/config/theme-tokens.ts`) covering
      every value used by TUI and web; a theme is a plain object satisfying the interface
- [x] Three themes shipped: **Dark** (default), **Light**, **Terminal** (phosphor/CRT)
- [x] `reup --theme <name>` CLI — saves preference and applies immediately
- [x] Theme selection in `reup config` Interface tab (keyboard-navigable, live preview)
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
- [x] **3-state startup cleanup** — `autoCleanupOnStart: 'off' | 'on' | 'auto'`; `auto` silently
      archives only high-confidence candidates; boolean migration in `readUserPrefsSync()` for old prefs.
      _Superseded 2026-07-03: startup cleanup and the Features config tab were removed entirely
      (`reup cleanup` remains as an explicit, manual, reversible command)._
- [x] **Config UI style unification** — Integrations and Features tabs show status bullet inline
      with title (consistent across all tabs); Features tab describes each state in plain text
- [x] **`reup --help` fixes** — cleanup is described consistently as reversible archiving; removed `[key=val]`
      from `reup config` line
- [x] **Density toggle removed** — `d` key and comfortable/compact density removed from TUI;
      two stale label keys (`cmdDensityComfortable`, `cmdDensityCompact`) remain in `labels.ts`
      and should be cleaned up

---

## Milestone 9 — Distribution and installers

Make installation feel native and require no repository clone, build step, or
manual shell setup. First public release hardening also removes the deferred
Project Memory implementation from shipped code and adds explicit legal,
privacy, security, and support documentation. Detailed installer behavior is
defined in [`Documents/INSTALLATION.md`](Documents/INSTALLATION.md).

- [x] Resolve the public product/package name before producing signed artifacts
- [x] Remove deferred Project Memory code paths, routes, UI, tests, and startup
      hooks from the public release branch
- [x] Preserve Project Memory knowledge in a deferred architecture document only
      ([`Documents/DEFERRED_PROJECT_MEMORY_SYNC.md`](Documents/DEFERRED_PROJECT_MEMORY_SYNC.md))
- [x] Add disclaimer, privacy, security, and support docs (`DISCLAIMER.md`,
      `PRIVACY.md`, `SECURITY.md`, `SUPPORT.md`)
- [x] Make the README install-first and explicit about local-only/no telemetry/no
      account/no warranty/no SLA
- [x] Add local release-candidate builder (`npm run release:local`) for fast
      first-phase artifacts with no official publish. It validates the repo,
      packages the npm tarball and VSIX, writes local SBOM/provenance metadata,
      and generates `SHA256SUMS.txt` under `release/`.
- [x] Add local installable RC packages (`npm run release:installers`) for
      Windows, macOS, and Linux clean-machine smoke. These are unsigned,
      Node-runtime portable packages with per-user install/uninstall scripts,
      not official signed/native installers.
- [x] Add optional unsigned Windows `.exe` installer generation via Inno Setup 6. The build writes a clear skip note when `ISCC.exe` is not installed.
- [x] Add Windows installer task prompts for current-user `PATH` and
      PowerShell completion. Completion uses managed profile blocks for Windows
      PowerShell 5.1 and PowerShell 7 and is removed on uninstall.
- [x] Build per-user installable packages for Windows, macOS, and Linux —
      `npm run release:installers` produces a Windows `.exe` (Inno Setup) + `.zip`, and
      per-platform `.tar.gz` for macOS/Linux, all verified to build successfully with `npm audit`
      clean. Ran the full pipeline end to end: extracted the Windows zip and confirmed
      `reup.cmd --version` and bare `reup --version` (via PATH) both work, including under
      `-ExecutionPolicy Restricted`. Confirmed `install.sh`/`uninstall.sh`/`bin/reup` carry
      correct `755` permissions inside both Unix tarballs despite being built on Windows
      (GNU tar preserves the mode Node's `chmodSync` sets). Did not run `install.ps1`
      against this machine's real environment (would touch the live user PATH and could
      collide with the `npm link`-ed dev install already on it) or the `.sh` scripts on a
      real macOS/Linux box — that gap is the item below. "Self-contained" is a stretch:
      these still require Node.js 20+ preinstalled on the target machine, matching
      `Documents/INSTALLATION.md`'s documented intentional scope (portable/package shape
      first, signed/notarized/bundled-runtime is later-phase work).
- [x] Add the installed `reup` launcher to the current user's `PATH`
- [x] Windows installer: offer pre-selected PowerShell completion integration
      for Windows PowerShell 5.1 and PowerShell 7
- [x] Install shell completion as a managed, idempotent, reversible integration;
      back up profiles before first modification and remove only Reup-owned blocks
- [x] Ensure the Windows launcher works without weakening PowerShell execution policy —
      resolved: `bin/reup.cmd` is the only launcher shipped; `bin/reup.ps1` was removed
      because PowerShell's command lookup prefers a same-named `.ps1` over `.cmd` in the
      same PATH directory, which made bare `reup` resolve to the `.ps1` and fail under the
      Restricted execution policy (the default on many Windows machines) even though the
      `.cmd` needs no execution-policy allowance at all. Verified by reproducing the exact
      failure and confirming the fix under `-ExecutionPolicy Restricted`.
- [ ] Add upgrade, repair, and uninstall verification on clean platform environments —
      partially covered from the current dev machine. Windows launcher + PATH resolution
      tested for real (see the item above). Also found and fixed a real in-place-upgrade bug
      while testing here: `windowsInstallScript()` copied the new `app`/`bin` into the
      install directory without removing the old ones first, so files the new package no
      longer ships (like the `bin/reup.ps1` just removed) survived every upgrade — confirmed
      against this machine's own stale 2026-07-14 install, not just in theory. Fixed to match
      `unixInstallScript()`'s existing clean-remove-then-copy behavior. Still needs actual
      clean Windows/macOS/Linux VMs per `Documents/INSTALLATION.md`'s Validation checklist —
      repair, uninstall, and the macOS/Linux `.sh` packages have not been run on their real
      target platforms at all.
- [x] Generate local checksums, SBOMs, and provenance metadata for release-candidate artifacts
- [ ] Publish signed checksums, detached signatures, SBOM, and CI-backed provenance attestations

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

Shipped a full-screen Reup Workspace Cockpit inside VS Code. The extension
bundles selected `src/core` modules directly — no installed `reup` binary
required. All go/no-go criteria were met.

### Shipped

- [x] Full-screen `ReupDashboard` webview: workspace-first project/session
      discovery, progressive detail loading, structured metadata search,
      explicit transcript search, live usage, and context menus
- [x] `SessionResumeService`: centralized resume-destination selection across
      dashboard, Inspector, tree, and Quick Picks; optional persistent
      preference between Claude Code extension and integrated terminal
- [x] Activity Bar tree with current-workspace, attention-elsewhere, and
      recent-global sections; stable node identity across refreshes
- [x] `Reup: Resume Here` Quick Pick — workspace-first ranking (path match →
      git branch match → active → attention → recency)
- [x] `Reup: Resume Session` global Quick Pick with health badges, branch,
      project, relative time, active/attention flags, TODO/plan hints
- [x] `Reup: Search Sessions` — structured query search via shared core query
      parser (`session-query.ts`)
- [x] CSP-restricted Session Inspector webview: goal, progress, plan, TODOs,
      context, branches, file links, and tags
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
- [ ] Clean Windows manual terminal-launch smoke before official public release

---

## Milestone 12 — Organization layer: tags, groups, and work stacks ✓ done

Make Reup useful when Claude Code work stops being "a list of folders" and becomes many
parallel investigations, branches, fixes, reviews, and half-finished threads. The goal is a
lightweight organisation layer that feels faster than filing things manually.

See [`Documents/MILESTONE_12_PLAN.md`](Documents/MILESTONE_12_PLAN.md) for the full spec,
Inbox bucket definitions (as implemented), and Phase 4 advanced ideas.

### Status: closed ✓ — Phases 1–3 shipped, 2i tests passing

**Phase 1 — Foundation** ✅ complete  
**Phase 2 — Web Organization UI** ✅ complete (code + 2i tests)  
**Phase 3 — TUI + CLI parity** ✅ complete  
**Phase 4 — Advanced** deferred until MVP is proven in real use

### What shipped

- `org.json` infrastructure: `readOrgData()`, `withOrgLock()`, atomic write, advisory lock,
  SSE watcher, `filterProjectsByOrg()` shared across web/TUI/CLI
- Session tags and project tags in `reup.json`; `Session.tags`, `Project.group`, `Project.projectTags`
- Full org CRUD: groups, stacks, stack items, project-group assignments
- API routes: `/api/org/**`, tag mutation endpoints, `?group`/`?stack`/`?tag` project filters
- Web left rail: Inbox (7 priority buckets), Stacks, Groups — all collapsible, `localStorage`-persisted
- Web focus bar, session/project chips (max 2 + overflow), clickable tag filters
- Tag picker (`t`), group/stack picker (`g`), context menu additions, inspector org editor
- "Save as stack" from search or Smart View focus
- TUI: chips, group labels, `f` cycle focus, command palette entries, source/freshness labels
- CLI: `--tag`, `--group`, `--stack` filters; `--json` includes tags/group/projectTags; no HTTP

### Inbox buckets (as implemented — priority order, exclusive assignment)

| Bucket           | Condition                                                                                    |
| ---------------- | -------------------------------------------------------------------------------------------- |
| Active now       | session.id ∈ activeSessionIds                                                                |
| Needs attention  | interrupted ∥ lastToolFailed (narrower than original plan — each problem has its own bucket) |
| Branch drift     | gitBranch ≠ currentBranch                                                                    |
| Path missing     | !pathExists                                                                                  |
| High context     | latestContextTokens ≥ 150 000                                                                |
| Expiring soon    | expiresInDays ≤ 7                                                                            |
| Recently touched | updated within RECENT_WITHIN_DAYS                                                            |

### Closed

- [x] **Unit tests (2i)** — done. Behavioural core tests in
      `tests/core/session-smart-view.test.ts` cover bucket priority order, archived
      exclusion, and fixture-project counts/filtering (`filterProjectsBySmartView`).
      Client-invariant tests in `tests/web/org-inbox.test.ts` cover the focus filter,
      chip overflow cap (`buildTagChipsHtml`), and tag-picker recency order.
- [x] **Manual smoke** — signed off (`t` → tag → chip → click → focus → `×`).

### Why this matters

### Phase 4 — Advanced (deferred)

After real-world use proves the MVP:

- [ ] `--todo pending` and `--planned` CLI filters (require transcript scan)
- [ ] Suggested tags from branch prefix, folder name, and status signals (opt-in in config)
- [ ] Portable org export: `reup org export` → `org.json` + all `reup.json` tags
- [ ] Org import with merge strategy
- [ ] Quick clean sweep — bulk archive from group/stack, skips active sessions
- [ ] Drag-to-stack (after `g` picker is proven sufficient)
- [ ] TODO-aware and plan-aware triage (requires `hasTodos`/`hasPlans` persisted in sidecar)

---

## Milestone 13 — Live web control panel ✓ done (lean)

**Closed lean.** Shipped + unit-tested: live activity strip, selected-session heartbeat (latest
tool + last-update time), tool trace, and freshness-aware usage meters (`fresh`/`stale`/`unavailable`,
never stale-as-live). **Archived to protect zero-config / lightweight:** the config toggle (an on/off
flag contradicts zero-config) and the attention feed (a growing feed is visible weight — the Inbox +
live strip already cover it). Pinned watch list stays deferred. See the MVP slice below for detail.

Make `reup web` worth keeping open on a second monitor or browser tab while Claude Code runs in a
terminal. The web UI should become a quiet operations panel: active sessions, live limits, recent
tool activity, and attention signals update without the user refreshing or switching context.

### Why this matters

The TUI is great for intentional navigation. The web UI can win a different use case: **passive
awareness while working**. A developer should glance at Reup and know:

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

- [ ] Add feature toggle in `reup config`: live web panel on/off
- [ ] Respect `REUP_NO_OPEN` and localhost-only web server constraints
- [ ] Avoid transcript tail reads more often than necessary; batch updates per project
- [ ] Never expose secret transcript content in the live feed; tool names, file paths, and statuses
      are enough for the first version
- [ ] Degrade gracefully when usage integration is disabled or unavailable

### MVP slice

1. [x] Live activity strip for active/recent sessions (`buildActivitySectionHtml`)
2. [x] Selected-session heartbeat with latest tool/status and last update time
3. [x] Freshness-aware usage bars (`fresh`/`stale`/`unavailable` in usage core)
4. [~] Attention feed — **archived (not building)**. A persistent, growing feed is
   visible weight; the Inbox buckets + live activity strip already surface what
   deserves attention next, with no extra UI.
5. [x] Tests for freshness / stale display — done (`tests/core/live-usage.test.ts`,
       `account-usage.test.ts`, `session-tail.test.ts`). **Config toggle archived**:
       a live-panel on/off flag contradicts zero-config; the panel is light enough
       to always be on and simply ignorable.

> Design constraint (applies to all remaining M13 work): lightweight, zero-config,
> fast, easy. Features should be almost-hidden and elegant — discoverable by those
> who want them, ignorable by everyone else. No config toggles, no visible weight.

### Product guardrails

- [ ] Do not build a transcript viewer or chat clone
- [ ] Do not imply "live" when the source has not updated recently
- [ ] Do not add noisy notifications by default; this is a glanceable dashboard, not an alarm system
- [ ] Prefer "calm useful state" over animation-heavy monitoring UI

---

## Backlog

### Nice-to-have (validated by competitive analysis, mid-2026)

- [ ] **Credential/secret warning in `reup handoff`** — Before emitting the handoff Markdown packet,
      scan the session transcript for common secret patterns: `sk-...`, `ANTHROPIC_API_KEY=`,
      `Bearer ...`, `.env` style assignments, and long hex/base64 tokens. Print a warning count
      and require explicit `--force` (or confirmation prompt) before outputting. Never modify
      transcript content. Competes directly with Mantra's credential-redaction feature but stays
      read-only and local-first. Maps to "Is it safe to share this?" — priority filter #2.

- [x] **Files-touched list in resume card** — done, and extended well past the original
      idea. Touched files are extracted from `tool_use` write events
      (`session-automatic-context.ts`) and shown in every surface. On top of that, a full
      **reverse file→session lookup** shipped (`session-file-search.ts`:
      `searchTouchedFiles` / `collectTouchedFiles`): "which sessions edited this file?".
      Exposed as `reup touched <path>` (CLI), a TUI finder (`t`), and — the elegant,
      almost-hidden form — a "touched by N other sessions" affordance on each touched file
      in the web inspector and the VS Code inspector + dashboard. Reads only the immutable
      recorded write events; never diffs or replays.

### Advanced — requires API key / opt-in

These features intentionally sit outside the core tool. Reup's design goal is zero-config,
lightweight, and local-first. Anything here requires an explicit user action to enable and
must never activate automatically or affect the default experience.

- [ ] **AI session renaming** — `reup rename-sessions [project]` reads the first ~10 messages of
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

| Item                             | Reason                                            |
| -------------------------------- | ------------------------------------------------- |
| npm publish                      | Local stable version first; package name selected |
| Reup-hosted cloud sync / auth    | Local-first, no account, no hosted sync service   |
| Required/free-form config files  | Zero-config remains a design constraint           |
| Support for non-Claude-Code CLIs | Claude Code only                                  |
| Backup / restore of transcripts  | Out of scope; archive = hide only                 |
