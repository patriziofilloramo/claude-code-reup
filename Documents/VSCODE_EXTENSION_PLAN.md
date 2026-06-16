# VS Code Extension Plan

Swoop as a native VS Code extension. Goal: make Swoop's local intelligence
useful inside the editor workflow without requiring any additional prerequisites
beyond Claude Code being installed.

---

## Core decisions (resolved)

### Architecture: bundled extension with shared source

The extension is a standalone directory (`extension/`) in this repo. Its bundler
(esbuild) follows TypeScript imports directly into `../src/core/`, producing a
single self-contained `extension.js`. The VSIX packages only that file.

**No `@swoop/core` workspace package needed.** No shell-out to a `swoop` binary.
No running web server. The extension reads `~/.claude/projects/` directly, the
same way the CLI and web server do — because it compiles the same source.

```
claude-sessions-manager/
├── src/                         ← existing swoop CLI + web
│   └── core/                   ← imported directly by the extension
├── extension/                  ← NEW
│   ├── package.json            ← VS Code extension manifest
│   ├── tsconfig.json           ← includes ../../src/core via paths
│   ├── esbuild.mjs             ← bundles → dist/extension.js
│   └── src/
│       ├── extension.ts        ← activate / deactivate
│       ├── projectTree.ts      ← Activity Bar TreeView
│       ├── sessionPicker.ts    ← Quick Pick
│       └── statusBar.ts        ← Status Bar item
```

**Single prerequisite for the user:** Claude Code installed. Nothing else.

### Surfaces chosen

| Surface                         | Role                                                    |
| ------------------------------- | ------------------------------------------------------- |
| Activity Bar sidebar (TreeView) | Primary browsing — projects and sessions always visible |
| Quick Pick                      | Primary keyboard action — resume with fuzzy search      |
| Status Bar                      | Ambient awareness — active sessions + usage at a glance |
| Command Palette                 | Discoverability — all actions available by name         |
| Explorer context menu           | Contextual resume from the file tree                    |
| Notification                    | Branch drift alert — unique to Swoop                    |

---

## Phase 1 — Core, everything essential

All features in this phase map 1:1 to data Swoop already reads. No new backend
logic required.

### Feature matrix

| #   | Feature                              | Surface               | Core source                           |
| --- | ------------------------------------ | --------------------- | ------------------------------------- |
| 1   | Projects → sessions tree             | Sidebar               | `loadProjects()`                      |
| 2   | Health badge per session (◉ ⚠ ✗)     | Sidebar               | `primaryStatus` + `activeSessionIds`  |
| 3   | Git branch per session               | Sidebar               | `session.gitBranch`                   |
| 4   | Relative time ("2h ago")             | Sidebar               | `session.updated`                     |
| 5   | Message count                        | Sidebar               | `session.messageCount`                |
| 6   | **Resume** in integrated terminal    | Sidebar ▶ + Command   | same logic as resume-route            |
| 7   | **New session** in project directory | Sidebar + Command     | same logic as new-session             |
| 8   | Archive / Unarchive                  | Sidebar context menu  | `setSessionArchived()`                |
| 9   | Rename / Alias                       | Sidebar context menu  | `setSessionAlias()`                   |
| 10  | Copy Session ID                      | Sidebar context menu  | clipboard                             |
| 11  | **Quick Pick "Resume Session"**      | Quick Pick + keybind  | `loadProjects()`                      |
| 12  | **Quick Pick "Resume Here"**         | Quick Pick            | workspace path → project              |
| 13  | Status Bar — active session count    | Status Bar            | `getActiveSessions()`                 |
| 14  | Status Bar — usage %                 | Status Bar            | `loadLiveUsage()`                     |
| 15  | Live auto-refresh                    | Background            | `FileSystemWatcher` on `~/.claude/`   |
| 16  | Activity Bar badge (attention count) | Activity Bar icon     | `attention` filter                    |
| 17  | Open Web Dashboard                   | Command               | opens browser to `swoop web`          |
| 18  | **Branch drift alert**               | Notification          | `session.gitBranch` vs current branch |
| 19  | "Resume Here" from Explorer          | Explorer context menu | workspace path → project              |

### Sidebar layout

```
┌─ SWOOP ─────────────────────────── [+] [⟳] ┐
│                                              │
│  ▼  myapp                    3  ·  2h ago   │
│     ◉  fix-auth-bug   feat/fix  47  2h   ▶  │  ← hover: ▶ appears
│        add-tooltips   feat/ui   91  3h   ▶  │
│     ⚠  cleanup        main      23  8d      │  ← ⚠ = expiring/interrupted
│                                              │
│  ▶  other-project            1  ·  1d ago   │  ← collapsed
│                                              │
└──────────────────────────────────────────────┘
```

- **Project row:** compact path · session count · last active · [+] on hover
- **Session row:** status icon · name/alias · branch · msgs · time · [▶] on hover
- **Right-click:** Resume / Rename / Archive / Copy ID
- **Red badge** on Activity Bar icon when any session needs attention

### Quick Pick layout

```
 Swoop: Resume Session ____________________________

 ◉  fix-auth-bug                           myapp
    feat/fix  ·  47 msgs  ·  2h ago
 ⚠  cleanup-routes                  [2d left]  myapp
    main  ·  23 msgs  ·  8d ago  ·  expiring
    add-tooltips                               myapp
    feat/ui  ·  91 msgs  ·  3h ago
```

- **Label:** status icon + session name (fuzzy-searchable)
- **Description:** branch · msgs · time
- **Detail:** project (small, dimmed)
- **Suggested keybind:** `Ctrl+Shift+R` / `Cmd+Shift+R`

This beats Claude Code's native `--resume` picker because it shows health,
branch, and project for every session without opening anything.

### Status Bar layout

```
[Swoop  ◉ 2  ·  82%]
```

- `◉ 2` — active session count → click opens Quick Pick filtered to active
- `82%` — 5h usage, color: green < 70 %, yellow < 90 %, red ≥ 90 %
- Tooltip: 5h / 7d breakdown and reset time
- Single compact item, non-intrusive

### Branch drift alert (unique to Swoop)

Fires when VS Code detects a branch change in the open workspace and a recorded
session was started on a different branch:

```
┌──────────────────────────────────────────────────────┐
│  Swoop: Branch changed to main                       │
│  Session "fix-auth-bug" was started on feat/fix.     │
│  [Resume on feat/fix]  [Dismiss]                     │
└──────────────────────────────────────────────────────┘
```

No backend work required — `session.gitBranch` and the current branch from
`git rev-parse HEAD` are both available locally.

### Command Palette commands

```
Swoop: Resume Session        ← all sessions Quick Pick
Swoop: Resume Here           ← sessions for the current workspace
Swoop: New Session Here      ← new session in the current workspace
Swoop: Show Inbox            ← Quick Pick filtered to attention sessions
Swoop: Open Web Dashboard    ← opens browser
```

---

## Phase 2 — Important, but decisions needed

These features are valuable but each requires a non-trivial design choice before
implementation. Deferring keeps Phase 1 focused and shippable.

| #   | Feature                          | Surface                 | Open question                                             |
| --- | -------------------------------- | ----------------------- | --------------------------------------------------------- |
| A   | Session detail panel             | Sidebar Webview         | How much to duplicate the web inspector?                  |
| B   | Resume Card inline               | Hover / Webview         | Generate locally or call the web route?                   |
| C   | Handoff copy                     | Command + context menu  | Bundle generation logic or require web server?            |
| D   | Lost & Found / Diagnostics panel | Command → panel         | Worth duplicating outside the web UI?                     |
| E   | File decoration on Explorer      | File Decorator          | What to decorate — folder? Which indicator?               |
| F   | Inbox notification on startup    | Notification            | How persistent? Opt-in? Frequency?                        |
| G   | CLAUDE.md editor                 | Command + sidebar link  | Link to open the file in editor, or inline editor?        |
| H   | Deep search                      | Quick Pick variant      | Needs the transcript index — defer to when web is running |
| I   | Delete session                   | Context menu            | VS Code confirmation dialogs are awkward — design first   |
| J   | Open project folder as workspace | Context menu on project | `vscode.openFolder` — simple but needs UX decision        |
| K   | Usage detail chart/graph         | Webview tooltip         | Is it worth the complexity vs text tooltip?               |

---

## Go / no-go criteria (from ROADMAP)

Before shipping any version:

- [ ] It clearly beats the native `claude --resume` picker for at least one
      common workflow
- [ ] It reuses Swoop's existing local intelligence with no second parser or
      divergent data model
- [ ] It stays local-first: no telemetry, no account, no API key for core
      features
- [ ] It does not block the CLI / TUI / web experience or add heavy dependencies
      to the existing package
- [ ] It works on Windows, macOS, and Linux

---

## Effort estimate (Phase 1)

| Component                                                      | Effort      |
| -------------------------------------------------------------- | ----------- |
| `extension/` scaffolding, manifest, esbuild config             | 0.5 d       |
| Core reader bridge (TypeScript imports + type alignment)       | 0.5 d       |
| `projectTree.ts` — Activity Bar TreeView (projects + sessions) | 1.5 d       |
| `sessionPicker.ts` — Quick Pick (all + Resume Here)            | 1 d         |
| `statusBar.ts` — active count + usage %                        | 0.5 d       |
| Commands (New Session, Show Inbox, Open Web)                   | 0.5 d       |
| `FileSystemWatcher` live refresh                               | 0.5 d       |
| Branch drift notification                                      | 0.5 d       |
| Explorer context menu ("Resume Here")                          | 0.5 d       |
| Cross-platform testing + VSIX packaging                        | 0.5 d       |
| **Total Phase 1**                                              | **~7 days** |
