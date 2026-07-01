# Changelog

## Unreleased

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
