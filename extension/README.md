# Reup for Claude Code

Find and resume local Claude Code CLI work without leaving the editor.

The Reup extension is designed for developers who move between several
repositories and sessions. It helps you locate the right work, notice attention
elsewhere, inspect where Claude stopped, and resume with path and branch context
in view.

Reup reads local Claude Code CLI data. It does not aggregate the separate
history kept by Claude desktop, web, or remote sessions, upload transcripts, or
add a hosted service. Inside the editor, it is a local control surface for this
continuity workflow.

## The editor workflow

1. **Find** — browse the current workspace first or search discovered local
   projects, session metadata, and transcript content. Touched-file lookup finds
   paths targeted by recorded write/edit tool calls; it does not claim that
   every attempted call succeeded.
2. **Triage** — scan current-workspace sessions and attention elsewhere without
   visiting every terminal.
3. **Inspect** — review the latest recorded request and assistant response,
   plans and TODOs when recorded, write/edit targets, path, branch state,
   context, and resume advice.
4. **Resume** — open the Claude Code extension when available or start the
   recorded session in the integrated terminal.

## Views

- **Reup Dashboard** — full-screen project and session discovery with metadata
  search, explicit transcript search, observed usage, handoff, archive, tags,
  aliases, and resume actions.
- **Sessions Activity Bar** — a compact, workspace-first tree with Current
  Workspace, Needs Attention Elsewhere, and Recent Elsewhere sections.
- **Session Inspector** — a focused pre-resume card with the latest recorded
  human request and assistant response, plan, TODOs, files, branch/path checks,
  context, and safety advice. Those fields are recorded text, not a semantic
  reconstruction of the session's original objective.
- **Status Bar** — an optional active/attention summary while the Reup view is
  visible.

Session labels use the same shared `needs-input`, `working`, `attached`, and
`detached` resolver as the other Reup interfaces. `claude agents --json` can
retain pidless background tasks reported as `working` or `blocked`; those rows
remain safety evidence but appear only when they map to a resume-visible
discovered session or a verified live lock. A reported PID or verified lock,
not task state or age, establishes a live process. Hooks and transcript activity
remain bounded state fallbacks, but orphanable markers do not anchor a row. The
extension does not yet display full provenance for every label, so treat state
as guidance rather than proof.

## Commands

- `Reup: Open Dashboard`
- `Reup: Focus Workspace Cockpit`
- `Reup: Search Sessions`
- `Reup: Find Sessions by Touched File`
- `Reup: Resume Here`
- `Reup: Resume Session`
- `Reup: Refresh Sessions`
- `Reup: Diagnostics`

All command IDs use the `reup.*` namespace. No pre-production command aliases
are exposed.

## Settings

| Setting                | Default | Description                                          |
| ---------------------- | ------- | ---------------------------------------------------- |
| `reup.includeArchived` | `false` | Include locally archived sessions in extension views |
| `reup.refreshMode`     | `watch` | Use `watch`, `interval`, or `manual` refresh mode    |
| `reup.showStatusBar`   | `true`  | Show the compact active/attention status item        |

Pre-production settings are read as a silent migration fallback only when the
corresponding `reup.*` key is unset. New writes use `reup.*`.

## Resume behavior

When the Anthropic Claude Code extension is available, Reup can open its native
editor. The integrated VS Code terminal is also available. Reup asks once and
can remember that preference under its `reup.*` extension state.

Reup blocks resume when the recorded project path is missing. If a session is
already active, it opens the active Claude Code tab when possible instead of
starting a duplicate process. Branch warnings are advisory: Reup does not
switch branches or mutate worktrees automatically.

## Archive behavior

Archive writes reversible Reup-owned metadata and hides the session from
default views. It does not move or delete the Claude Code transcript. The VS
Code extension intentionally has no permanent transcript-delete action; use
the TUI or local web dashboard for the separate, explicit, confirmed delete
flow.

## Local development

Local development requires Node.js 20 or newer, Claude Code CLI session history,
and VS Code. From the repository root:

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

## Privacy and safety

- No Reup account, telemetry, hosted backend, or transcript upload.
- No transcript writes during discovery, inspection, or archive.
- No automatic branch or worktree changes.
- Webviews use a restrictive content security policy and validated messages.
- Resume targets must be discovered sessions with valid paths.

The extension does not host a network service. Account-usage requests to
Anthropic are off until the user explicitly runs `reup usage setup`; that
integration uses Claude Code's locally managed OAuth credential in memory and
stores aggregate results only. Remove it with `reup usage remove`.

Running the Reup TUI, web dashboard, or configuration flow automatically
registers or repairs reversible Claude Code attention hooks and prints
`reup attention remove` as the undo command. Merely activating the VS Code
extension does not install those hooks.

Reup is independent from and not endorsed by Anthropic.
