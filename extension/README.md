# Reup for Claude Code

Reup turns VS Code into a local control surface for Claude Code sessions.

It helps you find the right session, inspect where Claude stopped, and resume
through either the Claude Code extension or the integrated terminal. It reads
the same local data as the `reup` CLI and does not upload transcripts or add a
remote service.

## Main Views

- **Reup Dashboard**: full-screen session dashboard with project filters,
  metadata search, transcript deep search, live usage, handoff, archive, tag,
  alias, and resume actions.
- **Sessions Activity Bar view**: workspace-first tree with Current Workspace,
  Needs Attention Elsewhere, and Recent Elsewhere groups.
- **Session Inspector**: focused resume card with the original goal, latest
  answer, plan, TODOs, files, branch state, context size, and safety advice.
- **Status bar**: compact active/attention indicator while the cockpit is
  visible.

## Commands

- `Reup: Open Dashboard`
- `Reup: Search Sessions`
- `Reup: Resume Here`
- `Reup: Resume Session`
- `Reup: Refresh Sessions`
- `Reup: Diagnostics`

All command IDs use the `reup.*` namespace. No pre-production command aliases
are exposed.

## Settings

| Setting                | Default | Description                                   |
| ---------------------- | ------- | --------------------------------------------- |
| `reup.includeArchived` | `false` | Include archived sessions in extension views  |
| `reup.refreshMode`     | `watch` | `watch`, `interval`, or `manual` refresh mode |
| `reup.showStatusBar`   | `true`  | Show the compact active/attention status item |

Pre-production settings are read as a silent migration fallback when the new
`reup.*` key is unset. New writes use `reup.*` only.

## Resume Behavior

When the Anthropic Claude Code extension is available, Reup can jump to the
native Claude Code editor. You can also choose the integrated VS Code terminal.
Reup asks once and can remember the preference under its new `reup.*` memento
key.

Reup blocks unsafe resumes when the recorded project path is missing. If a
session is already active, it opens the active Claude Code tab when possible
instead of starting a duplicate terminal process.

## Local Development

From the repository root:

```bash
npm run install:extension
```

That command builds a versioned VSIX and installs it with
`code --install-extension --force`.

For release checks:

```bash
npm run build:extension
npm run package:extension
npm test -- --run tests/extension/command-manifest.test.ts
```

Use `Reup: Diagnostics` and inspect **Output: Reup** when troubleshooting a
local build.

## Privacy

- No Reup account, telemetry, or backend.
- No transcript writes.
- No automatic branch changes.
- Webviews use a restrictive CSP and validated messages.
- Resume targets must be discovered sessions with valid paths.

Reup is independent and is not affiliated with Anthropic.
