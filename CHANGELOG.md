# Changelog

## 0.6.3

### Changed

- The README and landing page now route you to an interface by situation — terminal, second
  screen, inside a repository, scripting — instead of describing all four and leaving the choice
  to you. Both state that the interfaces read the same local data rather than competing.
- Both pages now say what Reup costs: six runtime dependencies, no database or daemon, lazy
  command loading worth about 15 ms over bare Node, and a VSIX around 240 KB. Listing time is
  described as scaling with your own history rather than quoted as a number, because it does.
- The shared four-state vocabulary moved out of the accuracy caveats and into the workflow, where
  it belongs: one state resolved once and drawn identically everywhere, with a badge backed by a
  reported fact rather than inferred from silence.

## 0.6.2

### Fixed

- The Sessions view no longer keeps an attention badge standing after you answer a permission
  prompt. Answering one does not end the turn, so Claude Code fires no hook and touches no lock,
  and with only the sidebar visible Reup watched locks and markers alone — leaving the single
  record that work resumed, the transcript, unobserved. Reup now watches the transcript of each
  waiting session, so the claim is retracted as soon as work continues. Nothing about how live
  state is resolved changed, and the extra watchers exist only while a session is actually
  waiting.

## 0.6.1

### Security

- Cleared two advisories published after 0.6.0 was tagged locally: `nanoid` 3.3.18 (custom
  generators can loop indefinitely when size is zero) in the runtime tree, and `js-yaml` in the
  extension's build tooling. Both resolutions land inside the existing semver ranges, so only
  lockfiles changed, and `npm audit` reports zero in the root and in `extension/`.

## 0.6.0

### Added

- The Sessions view gains a **Rest of Repository** group. When the folder you opened sits inside a
  larger repository — one package of a monorepo, one service of a checkout — sessions recorded at
  the repository root or in sibling packages appear there instead of disappearing. They are never
  folded into Current Workspace, which keeps meaning exactly the folder you opened, and
  `Reup: Resume Here` lists them below a separator that says where they come from. The dashboard
  mirrors the group as a focus row. Opening a repository root, the ordinary case, leaves the group
  empty and it is not drawn.
- `reup.countRepositorySessions` (default `true`) controls whether that group feeds the Sessions
  badge and the status indicator. Turn it off to narrow the indicator to the open folder; the
  group stays visible either way. A home directory or a shared parent folder is not a repository,
  so it never reaches either place.

### Fixed

- Branch changes are noticed again for a workspace opened on a subfolder. The `HEAD` watcher
  resolved Git metadata from the opened folder alone, which holds no `.git` in that case, so it
  silently never started and branch-drift indicators went stale in watch mode.

## 0.5.0

### Changed

- The VS Code extension now answers for the folder you have open. The Sessions view, the
  dashboard, and the status indicator cover only sessions recorded in this window's workspace
  folders, and the status badge no longer counts work in repositories you cannot act on from
  here. Widen with **Reup: Show Sessions from All Projects** in the view title bar, the
  dashboard's "All sessions" row, or `reup.sessionScope: all`. `Reup: Resume Session`, Deep
  search, and touched-file lookup stay global under either scope; with no folder open Reup shows
  every local project. The previous device-wide default was left over from the removed shared
  memory store.

### Fixed

- The extension's workspace section could be completely empty on Windows. VS Code always reports
  a lower-cased drive letter while Claude Code records the casing the shell had, and the
  membership test compared the two case-sensitively — so every session started in the workspace
  root fell through to "Recent Elsewhere". Membership is now case-normalized through one shared
  comparison, which `Reup: Resume Here` uses as well.
- The extension no longer adopts sessions recorded in a _parent_ of the open folder. Containment
  was symmetric, so opening a project pulled in the sessions of its home directory and any
  ancestor directory Claude had run in. Membership means the workspace folder itself or anything
  beneath it; reach a monorepo-root session with `Reup: Resume Session`.
- Changing `reup.sessionScope` or `reup.includeArchived`, or adding and removing workspace
  folders, now refreshes the extension's views instead of waiting for the next unrelated refresh.

### Security

- Resolved every open advisory in both dependency trees. The runtime picks up `hono` 4.13.0
  (ReDoS in the CORS middleware, which Reup does not mount) and `brace-expansion` 5.0.9
  (unbounded intermediate arrays). The extension's build tooling picks up `undici` 7.29.0
  (response desynchronization, cache-directive disclosure, CRLF and cookie injection) and
  `fast-uri` 3.1.5 (host confusion via a backslash authority introducer). All four land inside
  the existing semver ranges, so no manifest changed.

## 0.4.4

### Fixed

- Windows packages now include an extensionless `reup` launcher for Git Bash as well as
  `reup.cmd` for cmd.exe and PowerShell. Git Bash therefore no longer skips the local package and
  falls through to an older npm-global shim elsewhere on `PATH`; `bin/reup.ps1` remains
  intentionally absent for execution-policy compatibility.
- Windows installers de-duplicate and prepend their own `PATH` entry. The portable installer also
  verifies the installed version through every available supported shell and reports competing
  Reup installations without deleting them. The development install task now accepts only the
  checksummed package built from the current clean commit instead of selecting a release directory
  by modification time.
- Portable upgrades stage and verify the complete runtime before swapping it into place, with
  rollback on failure and an ownership marker that prevents stale local uninstall tasks from
  deleting another installer's files. Inno upgrades explicitly remove obsolete `bin/reup.ps1` and
  portable ownership metadata.
- The repository's local-install task uses an isolated `%LOCALAPPDATA%\Programs\reup-dev`
  directory, and portable packages refuse to overlay a directory owned by Inno Setup. Failed local
  upgrades also restore their previous staging/uninstaller pair.

## 0.4.3

### Fixed

- Release-candidate verification and installer assembly no longer pass
  drive-letter absolute paths to GNU tar. Tarball reads and extraction now run
  from a controlled working directory with relative, slash-separated operands,
  so `release:installers` works from Git Bash without treating `C:` as a remote
  host.

## 0.4.2

### Fixed

- VSIX verification now reads the ZIP archive in-process instead of invoking
  whichever `tar` executable appears first in `PATH`. Release checks therefore
  behave consistently in PowerShell, Git Bash, Linux, and macOS.
- Archive inspection remains bounded and extraction-free: it preserves
  duplicate paths, rejects encrypted or non-regular entries and unsupported
  compression, validates decompression and per-entry CRC-32, and limits both
  total expanded size and buffered manifest metadata.

## 0.4.1

### Fixed

- Live Activity no longer synthesizes a non-navigable `Needs input` session
  from an unmatched, pidless Agent View background row. Agent View-managed
  `working`/`blocked` rows remain conservative safety evidence and are still
  presented when Reup can anchor them to resume-visible local history or a
  verified live lock.
- TUI, inbox, extension, REST, and SSE now apply the same presentation boundary.
  Orphaned hook markers and `startedAt` age cannot resurrect or expire a managed
  task, and `/api/active` returns the same filtered IDs as the activity stream.
- Concurrent project and active-ID reads now share one cold discovery scan, and
  browser reachability checks use a constant-time `/api/health` endpoint rather
  than triggering session discovery during an outage.

## 0.4.0

### Added

- Reup now reads Claude Code's documented `claude agents --json` inventory as
  an optional official live-state source. Valid fresh fields can identify
  background and interactive sessions, working/blocked state, and documented
  wait reasons such as permission prompts. The process boundary is fixed-argv,
  no-shell, timeout/output/row bounded, runtime-validated, and discards external
  display names and summaries.
- The shared official reader is single-flight and stale-while-revalidate.
  Persistent TUI, web, and VS Code surfaces keep a lock-only first paint and
  refresh in the background; one-shot and safety-sensitive operations may wait.
  Official state drives presentation for at most 15 seconds, with a separate
  60-second retention window used only to prevent destructive false negatives.
- A review-only beta-candidate workflow and local release builder now produce
  an exact npm tarball, VSIX, source archive for clean commits, checksums,
  dependency snapshots, release notes, and explicit build metadata. The build
  publishes nothing and has read-only CI permissions.
- Release policy checks now inspect the exact packed npm manifest/README and
  VSIX manifests/archive paths, install the tarball into an isolated prefix,
  verify npm's generated `reup` shim, and reject source leakage, unsafe paths,
  duplicate entries, unexpected files, or identity drift.
- Added a task-based beta validation protocol, contribution and issue/PR
  templates, and deterministic synthetic demo tooling. The public dashboard
  screenshot is captured from the real app without maintainer data.

### Changed

- Public positioning now leads with the workflow Reup is strongest at: find
  local Claude Code work scattered across projects, triage what needs attention,
  then inspect recorded context before resume. Documentation compares this
  honestly with Claude Code `/resume` and Agent View and separates source beta,
  npm beta, extension, signing, notarization, and publication claims.
- TUI, web, CLI inbox, cleanup/resume safety, and the VS Code extension now
  consume the same merged live evidence and four-state vocabulary:
  `needs-input`, `working`, `attached`, and `detached`.
- Touched-file documentation now describes recorded Edit/Write targets rather
  than claiming every tool call successfully edited a file.

### Fixed

- Account-limit refresh no longer reads Claude Code's OAuth credential or calls
  Anthropic's authenticated usage endpoint before explicit
  `reup usage setup`, even when an older aggregate cache exists.
- A newer lock/hook transition, a live lock contradicting official `detached`,
  or a transcript-recorded user interruption/API error now supersedes an older
  official snapshot. Ordinary transcript recency remains a fallback and cannot
  overrule reported evidence.
- Stable official state identity prevents repeated needs-input notifications;
  a gap beyond the retention window starts a new transition. A reported
  working-to-needs-input change no longer emits a false turn-finished event.
- Notification hook capture now ignores completion and unknown notification
  subtypes; only permission/input/dialog waits create attention markers.

## 0.3.2

### Fixed

- The VS Code dashboard and inspector now separate a working session from one
  that is merely attached, as the TUI and the web already did. Only the tree
  icon had been converted; the dashboard dot and the inspector pill still read a
  binary `isActive`, so a session between turns showed bright green there and
  dimmed everywhere else. The dashboard dot pulses while working and is held
  back when attached, honouring `prefers-reduced-motion`.

## 0.3.1

### Changed

- Documented a known limitation: a session waiting on a tool-permission prompt
  is shown as working. Claude Code appears not to report that state — its
  `Notification` hook was not observed firing for one, and from the local files
  a running tool and a tool awaiting approval look identical. Reup shows what
  it can verify rather than guessing, so the indicator is deliberately absent
  rather than approximated.

## 0.3.0

### Added

- Desktop "turn finished" notifications now survive a tab you switched away
  from. The page used to find the boundary by diffing activity snapshots, which
  it only receives while awake, so a throttled tab missed one side of the
  transition and stayed silent. The server reports the boundary as its own
  event; the page still decides whether to raise it, because `document.hidden`
  answers the one question no local process can — whether you are looking. A
  tab frozen for several minutes still raises nothing, by which point you have
  been away long enough to read the state on return.

  No new setting: the page's notification toggle remains the control.

- Reup's Claude Code hooks are installed on first run rather than waiting for
  `reup attention setup`, and the surface that does it says so and names the
  command that undoes it. They feed live state and needs-input as well as turn
  boundaries, so leaving them behind a command nobody discovers meant shipping
  features that silently did nothing. `reup attention remove` is recorded and
  honoured — nothing reinstalls behind your back.

- The web UI now notices when the server stops. A dropped live stream triggers
  a reachability probe; if nothing answers, a full-screen "LINK LOST" panel
  appears — the boot loader's Matrix rain in a failure palette, over a terminal
  readout of the connection that failed, a retry countdown, and the command to
  start the server again. Dismissing it leaves a persistent `server offline`
  status in the footer, and the page marks itself so live dots read as unknown
  rather than asserting a state nothing is confirming. The page reconnects and
  reloads on its own once the server is back, and honours
  `prefers-reduced-motion`.

  The watcher is deliberately observational: it never clears the live feed and
  never gates reconnection, because an earlier version that did both broke the
  live feed outright.

### Changed

- The TUI, the web UI and the VS Code extension now read a session's live state
  from one shared core (`resolveSessionLiveState`) instead of each deriving its
  own. They previously disagreed in front of the user: the TUI called a session
  busy for ten seconds after its last transcript event, the web ran the full
  activity resolver, and the extension had no notion of activity at all, so the
  same session could pulse in one surface and sit still in another. The shared
  vocabulary is four states — needs-input, working, attached, detached — and a
  surface may add detail on top but may not reinterpret them. The web's
  reported-only "waiting" is the one such addition.

- An attached-but-quiet session is now dimmed live colour rather than dead
  grey, on every surface: dimmed green in the TUI, green at reduced opacity in
  the web, a green outline icon in VS Code. "A process is here but idle" and
  "no process at all" used to look identical.

- The web live dot states only what is always known: the session holds a live
  lock. running / waiting / idle became substatuses — "running" adds the pulse,
  and nothing else repaints the dot. It used to turn amber for "waiting" and
  grey for "idle", both of which can come from transcript recency alone, so an
  actively working session read as needing attention and then as dead while the
  TUI correctly showed it as live. "Needs input" stays red: it comes from
  Claude Code's Notification hook and is authoritative.

### Fixed

- A session the user stopped, or one the API cut short, no longer reads as
  running. Claude Code fires no `Stop` hook for either, so the last reported
  work state stayed `busy` with nothing to retract it — a stopped session kept
  a pulsing green dot beside its "interrupted" badge, and hitting a spend limit
  left a session "running" for minutes. Both endings are recorded in the
  transcript, and that record now retracts the flag. A spend limit is recorded
  as an assistant event whose `stop_reason` is `stop_sequence`, so reading
  `stop_reason` alone reported it as still in flight.

- The live strip shows a stopped session as `interrupted` rather than
  `waiting`, which reads as "between turns" and hid that the turn was cut
  short.

- Reup now repairs its own Claude Code hooks when their path goes stale. A hook
  entry names an absolute path, and that path moves for ordinary reasons — a
  Node version manager relocates the npm global root, an installer changes
  location — after which the hooks run and fail silently. Starting the TUI, the
  web UI, or the config screen repoints Reup's own entries at the running
  install. A command Reup did not write is never touched, and repair refuses
  when Reup itself has no stable path to name — replacing one dead path with
  another is not a repair. `reup doctor` reports what repair cannot fix.

- `reup attention status` no longer reports dead hooks as working. Hook entries
  name a script by absolute path; if that path stops resolving (the install was
  moved or removed, or lived on a drive that is no longer mounted) Claude Code
  still runs the command, node fails, and nothing reports it — every turn
  boundary and needs-input alert is silently lost while status says "on". Found
  on a real machine, where all three hooks had been dead for three weeks. The
  new `broken` state names the missing path and the config TUI offers to repair
  it rather than, as before, removing the hooks when toggled.

- Desktop "turn finished" alerts no longer fire on every pause. The alert now
  requires a source that actually reports turn boundaries — a lock status field
  or a hook marker. Sessions with neither (VS Code locks omit `status`) derive
  their state from transcript recency, which cannot tell a long tool call from
  a finished turn, so a quiet stretch mid-turn raised a "finished" alert.
  `/api/live-activity` entries carry `stateIsReported` to express this.

- Stopping Claude mid-turn now shows the session as interrupted. Claude Code
  records the stop as an explicit marker turn, but Reup only ever inferred
  interruption from an unanswered tool call — and the marker is a user turn, so
  it cleared exactly that evidence. Stopping a session therefore made it _less_
  likely to be reported as interrupted than simply leaving a tool call
  dangling. Verified against real transcripts: of 40 sessions, the two that
  were genuinely stopped and never resumed are the two now flagged.
- A session stopped from the VS Code panel stays attached, and the web UI
  suppresses the interrupted badge for live sessions — a deliberate correction
  for a dangling tool call mid-turn, which is normal. That correction no longer
  applies to a recorded stop, which is a fact about the session rather than an
  inference about it.

## 0.2.0

First version cleared for production. The security and data-integrity entries
below come from a pre-production review; each one is covered by a regression
test.

### Security

- The localhost web server now rejects every request — reads included — whose
  `Host` header is not loopback. Only state-changing routes were checked
  before, so a page on an attacker's domain could point that name at
  127.0.0.1 (DNS rebinding), become same-origin with Reup, and read the whole
  local Claude history: project paths, full transcripts, and `CLAUDE.md`
  contents. The check is registered once as middleware, so no endpoint can be
  added without it.
- The Lost & Found panel escapes the project paths it renders. A path is taken
  verbatim from a transcript's `cwd`, and directory names may legally contain
  markup on Linux and macOS, so opening a session recorded in such a directory
  could execute script inside the Reup page — with full access to its own API.
- The web UI now ships a Content-Security-Policy. Scripts are authorised by a
  per-render nonce, so injected markup cannot execute even if an escaping bug
  reappears.
- `usage-last-raw.json` is written owner-only and atomically, matching every
  other file Reup persists. It carries session identifiers and workspace paths
  and was previously world-readable on shared machines.

### Added

- Attention alerts: `reup attention setup` registers a reversible Claude Code
  Notification hook so Reup knows the moment a session waits on a permission
  decision or idle input. The web live strip pins those sessions in red with
  the waiting reason and can raise desktop notifications (needs input, and
  turn finished while the tab is hidden); the TUI pulses a red marker and
  rings the terminal bell. `reup attention remove` restores the previous hook
  configuration exactly and clears stored alerts.
- Near real-time working-state detection: session busy/idle state now comes
  from Claude Code's own lock files, merged per session and corroborated for
  freshness, pushed to the browser over typed SSE events within ~150 ms.
- Exact turn boundaries for every session: `reup attention setup` also
  registers UserPromptSubmit/Stop hooks, giving Reup its own busy/idle signal
  for sessions whose lock files omit the status field (VS Code peers). A
  transcript written within the last seconds also reads as running, and
  attached-but-quiet sessions stay visible in the live strip (dimmed as Idle)
  instead of flickering out.
- Web session list: the live-session dot now shows the same
  working/waiting/idle/needs-input states as the live activity strip and
  inspector, instead of a single binary "active" indicator.

### Fixed

- A `reup.json` that cannot be read is no longer treated as "this project has
  no Reup metadata". Previously a truncated or briefly locked sidecar made the
  next alias, tag, or archive change rewrite the file from empty — silently
  discarding every other session's metadata and reporting success. Updates now
  fail with the path to repair and leave the file untouched; discovery still
  degrades gracefully so one damaged file cannot hide a project.
- A malformed `org.json` no longer produces a generic 500 on group and stack
  mutations. A file missing collections is completed in place; a file that
  cannot be parsed is refused with the path to repair, and is never
  overwritten.
- Resuming a session whose project directory no longer exists no longer aborts
  the TUI launch with a raw filesystem error. Both resume paths now fall back
  to the current directory and say so, matching what `reup resume` already did.
- A session whose transcript already exists but whose metadata index has not
  listed it yet (a startup/first-flush race) no longer disappears entirely
  from the web session list. It now surfaces with its real name and message
  count instead of a placeholder ghost.
- Web session list and search results no longer show "✗ interrupted" for an
  actively-running session whose last transcript event is simply a tool call
  in flight — that is normal mid-turn state, not an interruption. A genuine
  tool failure still shows the badge regardless of whether the session is
  still live.

### Removed

- The experimental `reup sync` cross-device Project Memory feature (the `sync`
  command, sync API routes, web sync drawer, TUI sync surfaces, and the
  background sync guard) was removed before the first public release. The
  design knowledge and a reactivation checklist are preserved in
  `Documents/DEFERRED_PROJECT_MEMORY_SYNC.md`.

### Changed

- Renamed the product and public CLI to **Reup** with the single binary `reup`.
- Set the npm package identity to `@patriziofilloramo/reup`.
- Renamed public VS Code commands, views, settings, and generated assets to the
  `reup.*` namespace.

### Migration

- Existing pre-production local data is copied forward into `~/.claude/reup/`,
  `reup.json`, `.reup-link`, `.reup-conflicts`, browser `reup:*` keys, and VS
  Code `reup.*` settings where applicable.
- Legacy files are left in place for rollback; Reup writes new state to the new
  names.
- Reup no longer manages junctions/symlinks created by the removed
  `reup sync link`. Existing links keep working at the filesystem level, but
  there is no `reup sync unlink`: to restore local-only storage, copy the
  contents of `<project>/.claude-memory/` back into
  `~/.claude/projects/<project-id>/` and remove the junction/symlink manually
  while no Claude session is running in that project.
- The `crossDeviceSessionStorage` and `projectSearchPaths` preference keys are
  no longer read and are dropped from `prefs.json` on the next preference
  write. Any future sync reactivation treats them as fresh opt-ins.

## v0.1.0 — 2026-06-14

Initial release.

### Features

- **TUI** — terminal session browser with vim-style navigation, session detail panel, git branch display
- **Web UI** — local web server (`reup web`) with real-time updates via SSE
- **Session actions** — resume, open in VS Code, archive, delete
- **Aliases** — per-session human-readable names stored in sidecar metadata
- **reup sync** _(experimental — see warning below)_ — cross-device session sync via cloud storage

### ⚠ Experimental: `reup sync`

The `reup sync link` command and related sync features are **experimental** and should be used at your own risk.

What happens during `reup sync link`:

1. The local session directory for a project (`~/.claude/projects/<id>/`) is **replaced** with an NTFS junction (Windows) or symlink (Unix) pointing at a directory inside the project itself (`<project>/.claude-memory/`).
2. Existing local sessions are copied to the cloud directory before the junction is created.
3. A background sync loop maintains a local backup and handles offline transitions.

**Known risks:**

- If the cloud directory is unavailable and no backup exists, the junction may be broken until the cloud comes back.
- Independently modified copies are reported as conflicts and left untouched. Resolve the conflict
  before retrying sync; Reup only propagates files when one is an exact append-only extension.
- On Windows, removing a junction with standard tools (Explorer, `rm -rf`) may delete junction contents rather than just the junction itself. Use `reup sync unlink` to safely restore.
- The CLAUDE.md injection adds instructions that the Claude Code agent reads on every session start — if those instructions conflict with other CLAUDE.md content, behaviour is undefined.

**Before linking any project, back up your sessions:**

```
xcopy /E /I %USERPROFILE%\.claude\projects\<project-id> <backup-path>   # Windows
cp -r ~/.claude/projects/<project-id> <backup-path>                       # Unix
```

To safely restore a linked project to local-only storage: `reup sync unlink <path>`
