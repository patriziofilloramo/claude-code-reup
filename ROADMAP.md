# CCM Roadmap

## Open bugs

### High

- [ ] **Windows terminal launcher builds shell strings** — `terminal.windows.ts` uses `exec()`
      to construct shell commands. Input paths come from the filesystem (not the browser), so
      practical risk is low, but the pattern is still fragile. Needs dedicated testing on a clean
      Windows environment before any public release. See `terminal.windows.ts`.

- [ ] **Package name `claude-ccm` is taken on npm** — an unrelated package exists. Needs a
      scoped name or a different name before any publish. Blocked by the publish decision
      (currently not publishing).

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
- [x] CCM sidecar `ccm.json` with per-process serialised atomic write queue
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

- [x] `ccm handoff <session>` — compact Markdown continuation packet from transcript-supported facts
- [x] `ccm inbox` — terminal summary of active and non-archived sessions needing attention
- [x] `ccm doctor` — non-destructive diagnosis of stale locks, broken indices, orphaned transcripts,
      and missing session paths; shared with web Lost & Found
- [x] `ccm list --json` — stable, machine-readable session dump with project, activity, and signals
- [x] Extend `ccm list`: compact human table by default, full JSON with `--json`, global free-text
      search, and composable active/attention/archived/project/status/limit filters
- [x] Make compact list ID prefixes directly usable: globally unique adaptive prefixes, safe
      prefix resume, and opt-in PowerShell/Bash/Zsh session-ID completion
- [x] Rank shell-completion suggestions by current project, active state, and recent activity
- [x] Open a compact global, searchable picker when interactive `ccm resume` has no selector

---

## Milestone 5 — Usage visibility ✓ done

Make the limits that determine whether work can continue visible before they become a surprise.
Implementation is complete for all locally available data sources. Items that require an undocumented
Anthropic API (plan name, credit spending detail, routine allowances) are tracked separately in
[Milestone 10](#milestone-10--usage-api-dependent-features).

- [x] Research and document authoritative data sources, trust boundaries, and privacy rules in
      [`Documents/USAGE_VISIBILITY.md`](Documents/USAGE_VISIBILITY.md)
- [x] Extract transcript-supported model history, latest model, latest context-input tokens, and
      latest output tokens; expose them in web, TUI, and `ccm list --json`
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
- [x] **Configuration foundation**: `ccm config get/set/reset` CLI, `~/.ccm/prefs.json` persisted
      per-user preferences, zero-config defaults, extensible for future keys
- [x] **Configuration TUI**: `ccm config` with keyboard-navigable Interface, Integrations, and
      Features tabs; integrations show their exact effect and remain reversible
- [x] Manage live usage and shell-completion integrations through `ccm config`, while preserving
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
- [x] **Test coverage gaps** — added `tests/core/cloud-sync.test.ts` (9 cases: `stopSyncLoop`
      idempotency, `syncBidirectional` copy both directions, larger-file merge, recursive descent,
      skip `.ccm-link`); added `tests/core/device-id.test.ts` (4 cases: create, persist, read
      existing); also fixed a `syncBidirectional` bug where A-only subdirectories were silently
      skipped instead of being created in B; total test count: 194 (was 180)

---

## Milestone 7.5 — Cross-device sync (local-first) ✓ done

Share Claude Code sessions and memory across multiple machines without a server.
Uses NTFS junctions / symlinks to redirect Claude Code's per-project directory into
a shared cloud folder (pCloud, Dropbox, OneDrive, etc.) managed entirely by the OS.
No server, no auth — the cloud provider handles transfer.

> ⚠ Experimental: see `CHANGELOG.md` for known risks and the backup procedure.

- [x] `ccm link [path]` — creates a per-project NTFS junction pointing the Claude Code
      project directory at a shared cloud folder; backs up existing local sessions first
- [x] `ccm unlink [path]` — restores the local directory; sessions written while linked
      remain accessible through the shared folder
- [x] **Sync registry** (`syncRegistry`) — in-memory `Map` of junction paths to cloud state;
      avoids circular imports between discovery, sync, and memory modules
- [x] `initCloudSync()` / `stopSyncLoop()` — startup guard that verifies junction targets
      on launch; replaces offline junctions with a local backup so sessions remain writable
      while the cloud drive is unmounted; restores on reconnect
- [x] **Cloud indicator in TUI and web** — `☁` icon coloured green (online), grey (cloud
      offline / sync paused), or orange (one or more devices used the project without
      running `ccm link`)
- [x] **Offline guard** — new sessions are blocked when a project's cloud storage is
      unreachable; flash message informs the user and resumes automatically on reconnect
- [x] `ccm memory link [path]` / `ccm memory unlink [path]` — inject / remove a
      `<!-- ccm:sync:start/end -->` section in the project's `CLAUDE.md` that instructs
      Claude Code on any device to: detect whether the device is linked, write a presence
      file when it is not, warn once, and silently skip after the user dismisses the warning
- [x] **Cross-device CLAUDE.md protocol** — all check files live inside the shared cloud
      folder so Claude Code needs only `hostname` (via Bash) and file access inside the
      project to run the protocol; no extra permissions required
- [x] **Unlinked-device detection** — linked devices scan `{cloudDir}/device-presence/` on
      each discovery pass and surface device names as `unlinkedDevices[]` on the `Project`
      object; orange cloud indicator prompts the user to run `ccm link` on that device
- [x] **Append-only shared memory** — unlinked devices append context to
      `{cloudDir}/memory/shared.md` under a `## HOSTNAME — date` header; avoids pCloud
      conflict copies that would arise from concurrent rewrites

---

## Milestone 8 — Distribution and installers

Make installation feel native and require no repository clone, build step, or
manual shell setup. Detailed behavior is defined in
[`Documents/INSTALLATION.md`](Documents/INSTALLATION.md).

- [ ] Resolve the public product/package name before producing signed artifacts
- [ ] Build self-contained, per-user installers for Windows, macOS, and Linux
- [ ] Add the installed `ccm` launcher to the current user's `PATH`
- [ ] Windows installer: offer pre-selected PowerShell completion integration
      for Windows PowerShell 5.1 and PowerShell 7
- [ ] Install shell completion as a managed, idempotent, reversible integration;
      back up profiles before first modification and remove only CCM-owned blocks
- [ ] Ensure the Windows launcher works without weakening PowerShell execution policy
- [ ] Add upgrade, repair, and uninstall verification on clean platform environments
- [ ] Publish checksums and document artifact provenance/signing

---

## Milestone 9 — Growth: themes and i18n

### Theme system — attract developers, retain power users

The UI must be a competitive differentiator, not just functional. Both the TUI and web interfaces
should share a single design-token layer so changing a theme requires no code changes — only a
new token set. The initial three themes are:

- **Dark** (current default) — dense, high-contrast, optimised for long coding sessions
- **Light** — clean white/grey palette for bright environments and screen sharing
- **Terminal** — near-black background, phosphor-green text, subtle CRT scan-line effect in the web
  version. Targets the developer audience that self-identifies with the command line aesthetic.
  Potential to generate social sharing among developers on first launch.

  > Design note on "Terminal" vs pure "Matrix": a pixel-accurate Matrix rain animation would be
  > distracting during real work. The terminal/phosphor look achieves the same cultural signal —
  > "this was made for people who live in the terminal" — without sacrificing usability. Reserve
  > the Matrix rain for an Easter egg on an extended key hold (≥ 3 s on a logo element), not the
  > default experience.

- [ ] Extract all colour and spacing values from `src/config/theme.ts` and `src/web/styles.css`
      into a unified token schema (`ThemeTokens` interface)
- [ ] Ship the three themes above; expose `ccm --theme <name>` and a web settings toggle
- [ ] Document the public token schema so community-contributed themes require no internal changes

### i18n groundwork — lower barrier for non-English contributors

The immediate addressable audience is primarily English-speaking developers. Full translations are
low priority today, but string centralisation is low-cost and architecturally correct regardless.

Decision: **extract, don't translate yet.**

- [ ] Move all user-facing strings (TUI labels, web UI text, CLI messages, error descriptions) into
      `src/config/labels.ts` with a simple flat map — no i18n library, no pluralisation engine,
      no locale detection
- [ ] Enforce a lint rule that blocks raw string literals in UI rendering paths; strings must come
      from the labels map
- [ ] Document the contribution path: adding a language = providing a parallel labels file + a
      README section in that language. No build complexity required.

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

## Backlog

### Nice-to-have (validated by competitive analysis, mid-2026)

- [ ] **Credential/secret warning in `ccm handoff`** — Before emitting the handoff Markdown packet,
      scan the session transcript for common secret patterns: `sk-...`, `ANTHROPIC_API_KEY=`,
      `Bearer ...`, `.env` style assignments, and long hex/base64 tokens. Print a warning count
      and require explicit `--force` (or confirmation prompt) before outputting. Never modify
      transcript content. Competes directly with Mantra's credential-redaction feature but stays
      read-only and local-first. Maps to "Is it safe to share this?" — priority filter #2.

- [ ] **Files-touched list in resume card** — Populate the "Recently touched files" field in the
      resume card by extracting `tool_use` write/edit/create events from the session JSONL. Show a
      compact deduplicated list capped at ~5 paths with a `+N more` overflow. No diff, no replay —
      just the file names. Closes a gap all four reviewed tools have: you can see what Claude *said*
      but not what it *changed*. Priority filter #1 (helps decide whether to resume).

### Advanced — requires API key / opt-in

These features intentionally sit outside the core tool. CCM's design goal is zero-config,
lightweight, and local-first. Anything here requires an explicit user action to enable and
must never activate automatically or affect the default experience.

- [ ] **AI session renaming** — `ccm rename-sessions [project]` reads the first ~10 messages of
      each un-aliased session, calls the Claude API to suggest a concise meaningful name, then
      shows a preview table before writing anything. `--apply` to commit. Requires
      `ANTHROPIC_API_KEY`. Estimate token cost upfront. Never overwrites existing aliases.

---

## To Be Checked Yet

Ideas that need more investigation before committing to a milestone. May be promoted, deferred,
or dropped after evaluation.

### Live session panel — the "always-open" use case

The web UI could act as a **passive control panel** that developers keep open in a browser tab
while working in the terminal. The value proposition: at a glance, without switching windows, you
see what Claude is doing right now.

Proposed additions to the web right-panel (using existing SSE + usage capture infrastructure):

- [ ] **Live context bar** — context window % for the currently active session, updated in real time
      via the SSE channel. Colour-coded to match the `ccm usage` bar thresholds
- [ ] **Rate limit mini-display** — inline 5h and 7d percentage next to the active session indicator,
      replacing the current static `●` dot with a subtle meter
- [ ] **Last-tool trace** — the most recent tool call name/type from the active session's transcript,
      updated on every SSE change event. Gives a "heartbeat" feeling while Claude is processing
- [ ] **Session timeline** — a compact sparkline of message activity over the last hour for the
      selected session, drawing on existing transcript timestamps. No new data required

The goal is not to replicate a chat UI — that belongs to Claude Code. The goal is a glanceable
dashboard that makes context exhaustion and rate limits impossible to miss.

---

## What is explicitly out of scope

| Item                             | Reason                                              |
| -------------------------------- | --------------------------------------------------- |
| npm publish                      | Local stable version first; package name unresolved |
| Server-based cloud sync / auth   | Local-first only; OS-level junctions via pCloud etc.|
| Required/free-form config files  | Zero-config remains a design constraint             |
| Support for non-Claude-Code CLIs | Claude Code only                                    |
| Backup / restore of transcripts  | Out of scope; archive = hide only                   |
