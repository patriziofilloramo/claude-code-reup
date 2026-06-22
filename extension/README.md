# Swoop Workspace Cockpit

![Swoop logo](media/swoop-brand.png)

Swoop brings local Claude Code session intelligence into VS Code. It helps you
decide which session to continue, explains resume risks, and resumes it either
in the Claude Code extension or in the correct integrated-terminal directory.

The install icon, dashboard mark, local web header, and monochrome Activity Bar
adaptation are generated from the canonical mark in `src/brand.ts`; product
surfaces must not carry independent logo artwork.

## Full-screen Resume Dashboard

Run **Swoop: Open Dashboard** or use the dashboard button in the Sessions view.
The editor-native dashboard is the fastest way to search projects and sessions,
review resume context, and continue work. Metadata search supports
`project:`, `branch:`, `tag:`/`#`, `status:`, and `is:active`; transcript search
is available explicitly through **Deep search**. Project and session
right-click menus expose the relevant actions without crowding the primary UI.

The dashboard opens once for its onboarding generation, then remains
user-invoked. Normal patch updates do not reopen it automatically.
Background and manual refreshes preserve the active editor/sidebar focus,
dashboard caret, selection, and scroll position.

Swoop is an independent local tool and is not affiliated with Anthropic.

## Workspace Cockpit

The Activity Bar view is organized around the editor you are using:

- **Current Workspace** prioritizes active work, warnings, branch matches, and
  the project containing the active editor.
- **Needs Attention Elsewhere** keeps interrupted, expiring, and unavailable
  sessions visible without mixing them into the workspace.
- **Recent Elsewhere** keeps global history available in a collapsed section.

The Session Inspector shows resume advice, goal, latest response, plan, TODO
state, context size, branches, touched files, tags, and passive Project Memory
status.

Safe local actions include Resume, Copy Handoff, Alias, Archive/Undo, Tags,
Reveal Project, and opening transcript-referenced files. Swoop never modifies
Claude-owned transcripts.

When Anthropic's Claude Code extension is installed, the first Resume asks
whether to use it or the VS Code terminal. The checkmarked **Remember my
choice** control makes that selection persistent; the dashboard split button
can change it later. If the Claude Code command is unavailable, Swoop reports
the problem and safely falls back to the terminal.

## Install locally

From the repository root, the quickest route is:

```bash
npm run install:extension
```

This installs missing extension dependencies when necessary, creates a
versioned VSIX, and installs it with `code --install-extension --force`.

Inside VS Code, the same workflow is available through **Tasks: Run Task** →
**Install Swoop VS Code Extension Locally**.

For manual installation, build the package with `npm run package:extension`,
then:

1. Open the VS Code Command Palette.
2. Run **Extensions: Install from VSIX...**
3. Select the newest `extension/dist/swoop-vscode-<version>.vsix`.
4. Reload VS Code and open the Swoop icon in the Activity Bar.

If the `code` shell command is unavailable, install it from VS Code or set
`SWOOP_VSCODE_CLI` to the executable path.

## Versioning rule

Every change that affects the installable extension must increment
`extension/package.json`. This includes bundled extension/shared-core code, the
manifest, packaged documentation, and media assets. Tests and developer-only
scripts do not require a release bump by themselves.

For the normal pre-1.0 patch release:

```bash
npm version patch --prefix extension --no-git-tag-version
```

CI builds the extension, derives its actual bundled source inputs from the
sourcemap, and rejects release-affecting changes when the extension version did
not increase.

## Development

```bash
cd extension
npm ci
npm run compile
```

From the repository root, run the `Run Swoop VS Code Extension` launch
configuration. The Extension Host uses the local bundle in
`extension/dist/extension.cjs`.

## Refresh and status settings

- `swoop.refreshMode`: `watch` (default), `interval`, or `manual`.
- `swoop.includeArchived`: include locally archived sessions.
- `swoop.showStatusBar`: show active and attention counts while Swoop is
  visible.

Watchers and Git checks are active only while the dashboard is visible. The
sidebar tree refreshes once when opened, after Swoop mutations, or through the
manual Refresh command. This prevents transcript activity from keeping shared
VS Code sidebars busy. Watch events are coalesced and rate-limited, and the
20-second timer is used only in explicit `interval` mode.

## Privacy and safety

- No telemetry and no Swoop backend. When live usage capture is configured,
  the shared core may refresh aggregate limits from Anthropic's authenticated
  read-only usage endpoint; credentials remain in memory and are never logged.
- No transcript writes.
- No automatic branch changes.
- No destructive session deletion.
- Resume accepts only a discovered full UUID and an existing project path.
- Webview content uses a restrictive CSP and validates every message in the
  extension host.

## Troubleshooting

- Run `Swoop: Diagnostics` and inspect **Output: Swoop**.
- Use `Swoop: Refresh Sessions` after moving Claude data manually.
- If automatic refresh is noisy on a virtual filesystem, set
  `swoop.refreshMode` to `interval` or `manual`.
- If a session reports branch drift, verify the current branch before resuming;
  Swoop explains the mismatch but never switches branches automatically.
