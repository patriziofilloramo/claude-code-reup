# Stop hunting for the right Claude session

**Swoop turns VS Code into a local mission control for Claude Code.**

Find work across every project, understand exactly where Claude stopped, and
resume the right session without guessing from a title or timestamp.

![Swoop dashboard workflow](https://raw.githubusercontent.com/patriziofilloramo/claude-code-swoop/master/extension/media/marketplace/dashboard-workflow.gif)

## Your Claude work, understood at a glance

- **Find anything in seconds.** Search titles, aliases, projects, branches,
  tags, status and session IDs. Deep Search scans transcript content only when
  you ask for it.
- **Know before you resume.** See the original goal, Claude's latest answer,
  plan, TODOs, touched files, context size and branch state.
- **Continue in the right place.** Resume through the Claude Code extension or
  the integrated terminal, in the recorded project directory.
- **Catch trouble early.** Active sessions, interrupted work, branch drift,
  missing paths, expiring transcripts and high context are visible before they
  surprise you.
- **Stay in control.** Alias, tag, archive, copy a handoff or reveal the project
  without editing Claude-owned transcripts.

## Full-screen Resume Dashboard

Run **Swoop: Open Dashboard** and your scattered Claude sessions become one
action-oriented workspace:

- **Continue now** ranks the most relevant session.
- Live usage limits remain visible while you work.
- Project and session context menus keep secondary actions one click away.
- Keyboard navigation, responsive layouts and progressive loading keep the
  dashboard fast even with large histories.

Search supports `project:`, `branch:`, `tag:`/`#`, `status:` and `is:active`.
Use **Deep search** when the clue is buried inside a conversation.

## A cockpit beside your editor

![Swoop Workspace Cockpit](https://raw.githubusercontent.com/patriziofilloramo/claude-code-swoop/master/extension/media/marketplace/workspace-cockpit.png)

The compact Activity Bar view follows the workspace you are editing:

- **Current Workspace** keeps relevant sessions close.
- **Needs Attention Elsewhere** surfaces risky work without mixing it into your
  current project.
- **Recent Elsewhere** keeps the rest accessible without noise.

Select a session and the Inspector reconstructs the useful continuation
context: what you asked for, where Claude left off, its plan, TODO state, files
and safe-resume advice.

## Resume your way

When the Anthropic Claude Code extension is available, Swoop can resume there
directly. Prefer a terminal? Choose the integrated VS Code terminal instead.
Swoop asks once and can remember your choice, while the dashboard split button
always lets you override it.

If a project path is missing or the same session is already active, Swoop
blocks the unsafe launch and explains why.

## Local-first by design

- No Swoop account, backend or telemetry.
- No transcript writes.
- No automatic branch changes.
- No destructive session deletion.
- Webviews use a restrictive CSP and validated messages.
- Resume targets must be discovered sessions with valid paths.

Swoop reads the local Claude Code state already stored on your machine. Optional
live usage refresh uses Anthropic's authenticated read-only usage endpoint;
credentials stay in memory and are never logged.

## Get started

1. Install and reload VS Code.
2. Open the Swoop icon in the Activity Bar.
3. Run **Swoop: Open Dashboard**.
4. Select a session and press **Resume**.

Useful commands:

- `Swoop: Open Dashboard`
- `Swoop: Search Sessions`
- `Swoop: Resume Here`
- `Swoop: Resume Session`
- `Swoop: Diagnostics`

Swoop is an independent local tool and is not affiliated with Anthropic.

## Local development

From the repository root:

```bash
npm run install:extension
```

This builds a versioned VSIX and installs it with
`code --install-extension --force`. Run `Swoop: Diagnostics` and inspect
**Output: Swoop** when troubleshooting a local build.
