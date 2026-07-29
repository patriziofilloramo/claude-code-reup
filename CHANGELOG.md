# Changelog

## 0.2.1

### Added

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

- Desktop "turn finished" alerts survive a hidden tab. The browser used to
  derive the boundary by diffing snapshots it only receives while awake; the
  server now reports it as a `turn-finished` event. A fully frozen tab still
  cannot alert — that needs a notification raised by the local process, which
  is not in this release.

- Reup now repairs its own Claude Code hooks when their path goes stale. A hook
  entry names an absolute path, and that path moves for ordinary reasons — a
  Node version manager relocates the npm global root, an installer changes
  location — after which the hooks run and fail silently. Starting the TUI, the
  web UI, or the config screen repoints Reup's own entries at the running
  install; hooks that were never set up are never added, and a command Reup did
  not write is never touched. `reup doctor` reports the condition when repair
  cannot act.

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
