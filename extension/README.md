# Swoop Workspace Cockpit

Swoop brings local Claude Code session intelligence into VS Code. It helps you
decide which session to continue, explains resume risks, and launches Claude in
the correct integrated-terminal directory.

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

## Install a local VSIX

```bash
cd extension
npm ci
npm run package:vsix
code --install-extension dist/swoop-vscode-0.1.0.vsix
```

Restart or reload VS Code, then open the Swoop icon in the Activity Bar.

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

Watchers, Git checks, and the safety interval are active only while the Swoop
view is visible.

## Privacy and safety

- No telemetry or network requests.
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
