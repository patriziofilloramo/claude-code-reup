# Changelog

## v0.1.0 — 2026-06-14

Initial release.

### Features

- **TUI** — terminal session browser with vim-style navigation, session detail panel, git branch display
- **Web UI** — local web server (`ccm web`) with real-time updates via SSE
- **Session actions** — resume, open in VS Code, archive, delete
- **Aliases** — per-session human-readable names stored in sidecar metadata
- **ccm memory** *(experimental — see warning below)* — cross-device session sync via cloud storage

### ⚠ Experimental: `ccm memory` / `ccm link`

The `ccm memory link` command and related sync features are **experimental** and should be used at your own risk.

What happens during `ccm link`:

1. The local session directory for a project (`~/.claude/projects/<id>/`) is **replaced** with an NTFS junction (Windows) or symlink (Unix) pointing at a directory inside the project itself (`<project>/.claude-memory/`).
2. Existing local sessions are copied to the cloud directory before the junction is created.
3. A background sync loop maintains a local backup and handles offline transitions.

**Known risks:**

- If the cloud directory is unavailable and no backup exists, the junction may be broken until the cloud comes back.
- Bidirectional sync uses a "larger file wins" heuristic — in rare edge cases this may prefer an older version of a file.
- On Windows, removing a junction with standard tools (Explorer, `rm -rf`) may delete junction contents rather than just the junction itself. Use `ccm unlink` to safely restore.
- The CLAUDE.md injection adds instructions that the Claude Code agent reads on every session start — if those instructions conflict with other CLAUDE.md content, behaviour is undefined.

**Before linking any project, back up your sessions:**

```
xcopy /E /I %USERPROFILE%\.claude\projects\<project-id> <backup-path>   # Windows
cp -r ~/.claude/projects/<project-id> <backup-path>                       # Unix
```

To safely restore a linked project to local-only storage: `ccm unlink <path>`
