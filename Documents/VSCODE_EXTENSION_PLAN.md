# VS Code Extension Plan

Status: historical Milestone 11 discovery plan. The proof succeeded and the
current implementation has moved beyond this document: see
[`extension/README.md`](../extension/README.md),
[`FEATURES.md`](FEATURES.md), and [`ARCHITECTURE.md`](ARCHITECTURE.md) for the
shipped dashboard, Inspector, search, live usage, actions, and resume-target
behavior.

The earlier “not a dashboard clone” constraint remains useful as design
history, but it is no longer a literal product restriction. The implemented
full-screen dashboard is an editor-native, resume-focused surface backed by the
same core functions as TUI and Web, not a copy of the browser administration
UI.

This document defines the first VS Code extension slice for Reup. It is written
for an implementation agent: decisions are explicit, risky ideas are deferred,
and every phase has a verification target.

## Executive Summary

Reup should enter VS Code only if it does something the editor makes uniquely
better. The extension must not be a smaller copy of the web dashboard and must
not compete with Claude Code's native picker on "global search exists". The
winning workflow is:

> From the workspace I am editing, show the Claude Code sessions that matter,
> explain their state, and resume the right one in the integrated terminal.

The first extension milestone is therefore an **Editor Resume Proof**:

1. `Reup: Resume Here` ranks sessions for the current workspace first.
2. `Reup: Resume Session` provides a global Quick Pick with health, branch,
   project, active state, TODO/plan hints, and last activity.
3. A lightweight Activity Bar tree makes active/attention sessions visible
   without opening the web UI.

Everything else is deferred until this proof feels better than typing
`claude --resume` and using the native picker.

## Critical Review of the Previous Plan

The previous plan had good instincts, but it was too broad for Phase 1.

- **Phase 1 was overloaded.** Nineteen features in the first slice would mix
  product discovery, extension packaging, mutations, live usage, notifications,
  and UI design in one branch.
- **Architecture was declared final too early.** Directly importing
  `../src/core` is probably the right direction, but it still needs a bundle,
  startup, and extension-host proof before it becomes a rule.
- **"No backend logic required" was inaccurate.** The extension should not
  create a second parser, but it does need an adapter layer that turns Reup's
  core model into VS Code-friendly view models and commands.
- **Status bar usage was too early.** Usage has source/freshness complexity.
  Showing stale or partial account limits inside VS Code would damage trust.
- **Branch drift notifications risk being noisy.** Passive indicators are a
  better first step. Notifications can come later, opt-in.
- **Mutation features should not lead.** Archive, rename, delete, and handoff
  are useful, but the first extension proof should be read-mostly and hard to
  break.

## Product Wedge

### What the extension should beat

Claude Code's native resume flow can search sessions globally. Reup's VS Code
extension should win when the user needs context before resuming:

- Which sessions belong to the workspace I already have open?
- Which one is active, interrupted, high-context, or branch-drifted?
- What did Claude last plan, touch, or leave unfinished?
- Can I resume it in the integrated terminal without changing surfaces?

### What it should not become

- Not a transcript viewer.
- Not a second web dashboard.
- Not a project-management tool.
- Not a replacement for the Reup TUI.
- Not a wrapper that shells out to `reup list` for every interaction.

## Non-Negotiable Constraints

- Local-first: no Reup cloud, no telemetry, no account, no API key for core
  features.
- Read-only toward Claude-owned transcripts.
- No dependency on an installed `reup` binary for core extension behavior.
- No web server required for the extension.
- VS Code API usage stays at the edge; Reup core remains editor-agnostic.
- Mutations require explicit confirmation and are not part of the first proof.
- Windows, macOS, and Linux must remain first-class.

## Architecture Direction

### Preferred shape

```text
claude-sessions-manager/
  src/
    core/                         existing Reup domain logic
  extension/
    package.json                  VS Code extension manifest
    tsconfig.json                 extension build config
    esbuild.mjs                   bundles extension host entry
    src/
      extension.ts                activation and command registration
      reup-data.ts               adapter from Reup core to extension DTOs
      resume-picker.ts            Quick Pick flows
      session-tree.ts             Activity Bar TreeDataProvider
      terminal.ts                 integrated terminal launch helpers
      formatting.ts               labels, codicons, relative times
      logger.ts                   extension output channel
```

### Boundary rules

- `extension/src/*` may import from `../src/core/*`.
- `src/core/*` must never import from `vscode`.
- The extension must not import `src/web/routes/*` or browser client code.
- The extension must not call Reup's platform terminal launcher; VS Code has
  its own integrated terminal API.
- The adapter returns small DTOs, not raw project/session objects everywhere.

Recommended adapter DTOs:

```ts
type ExtensionProject = {
  id: string
  name: string
  path: string
  sessionCount: number
  updated: string | null
}

type ExtensionSession = {
  id: string
  projectId: string
  projectName: string
  projectPath: string
  title: string
  branch: string | null
  updated: string | null
  messageCount: number
  contextTokens: number | null
  primaryStatus: string
  isActive: boolean
  needsAttention: boolean
  todoSummary: string | null
  planSummary: string | null
}
```

The exact names can evolve during implementation, but the principle should not:
VS Code views consume a stable, small read model.

## VS Code API Decisions to Verify

Use official VS Code APIs only:

- Extension manifest and activation events:
  https://code.visualstudio.com/api/references/extension-manifest
- Activation events:
  https://code.visualstudio.com/api/references/activation-events
- Tree View API:
  https://code.visualstudio.com/api/extension-guides/tree-view
- VS Code API reference:
  https://code.visualstudio.com/api/references/vscode-api

Implementation notes:

- Prefer activation on `onCommand:*` and `onView:reup.sessions`; avoid `*`.
- Use `window.showQuickPick()` for fast resume flows.
- Use `window.createTreeView()` with a `TreeDataProvider` for the sidebar.
- Use `window.createTerminal({ cwd })`, then `terminal.sendText(...)` for
  resume/new-session commands.
- File watching of `~/.claude/projects` must be verified. If VS Code's watcher
  is unreliable for non-workspace folders on any OS, start with explicit
  refresh and add a low-frequency refresh only while the Reup view is visible.

## MVP: Editor Resume Proof

### Phase 0 - Build and data proof

Goal: prove that the extension can bundle and read Reup core without changing
the existing CLI/TUI/web package.

Deliverables:

- [x] `extension/` scaffold with TypeScript + esbuild.
- [x] `vscode` externalized from the bundle.
- [x] Direct imports from Reup core compile inside the extension bundle.
- [x] `Reup: Diagnostics` command logs discovered project/session counts to
      an Output Channel.
- [x] No mutation-capable sidebar yet. A read-only session tree exists because
      it is cheap, useful for Extension Host smoke testing, and does not change
      Reup data.

Verification:

- [x] Existing root checks still pass: `npm run build`, `npm test`,
      `npm run lint`, `npm run format:check`.
- [x] Extension build passes from `extension/`.
- [ ] Extension host manual smoke test.
- [x] No new root dependency is added. Extension build dependencies are local to
      `extension/`.

### Phase 1 - Quick Pick resume flows

Goal: make the keyboard path obviously better than a bare picker.

Commands:

- [x] `Reup: Resume Here`
- [x] `Reup: Resume Session`
- [x] `Reup: Refresh Sessions`

Behavior:

- `Resume Here` ranks sessions by:
  1. exact workspace folder path match
  2. path contained by / containing the workspace folder
  3. current git branch match
  4. active state
  5. needs-attention state
  6. recent activity
- `Resume Session` searches all projects globally.
- Quick Pick rows show:
  - status codicon
  - alias/title
  - project name
  - branch
  - relative activity time
  - active/attention flags
  - TODO/plan hint when available
- Selecting a session opens a VS Code integrated terminal in the recorded
  project path and sends `claude --resume <uuid>`.
- If the path no longer exists, show a clear error and do not launch.
- If the ID is not a full UUID, refuse to launch. The extension should resolve
  prefixes before this point, not pass them to the shell.

Why this can stand out:

- The user does not leave VS Code.
- The list is workspace-aware but still global.
- It shows "should I resume this?" facts, not only names.

### Phase 2 - Activity Bar tree

Goal: provide a passive editor-native navigator without recreating the web UI.

View:

- `Reup` Activity Bar container.
- `Sessions` tree grouped by project.
- Project rows show name, session count, and latest activity.
- Session rows show status, title, branch, active state, and relative time.

Inline/context actions:

- [x] Resume
- [x] Copy Session ID
- [x] Copy Handoff packet
- [x] Reveal Project Folder
- [x] Refresh
- [x] Optional automatic refresh via `reup.refreshMode`: `manual`, `watch`, or
      `interval`

Deferred from the first tree:

- Rename
- Archive
- Delete
- Full detail webview

Reason: the first tree should prove scanning and resume. Mutations can come
after the data refresh model and confirmation UX are solid.

### Phase 3 - Read-only session detail

Goal: make Reup's Resume Card available in the editor without building a
dashboard clone.

Candidate forms, in order:

1. Quick Pick detail text for small summaries.
2. [x] Read-only virtual Markdown document:
       `reup:/session/<project-id>/<id>.md`.
3. Webview detail panel only if Markdown is not expressive enough.

Content:

- What the user asked for.
- Where Claude left off.
- Native plan.
- Native TODO state.
- Recently touched files.
- Branch/path/active/attention facts.

Guardrail: do not stream or render full transcripts.

## Deferred Features

These are useful but should not ship in the first proof.

| Feature                    | Why defer                                                                  |
| -------------------------- | -------------------------------------------------------------------------- |
| Status bar usage           | Usage freshness is subtle; stale values in the editor would be misleading. |
| Branch drift notifications | Notification fatigue risk. Start with passive indicators.                  |
| Archive / rename / delete  | Mutations need confirmation, refresh, and conflict behavior.               |
| Handoff generation         | Valuable, but not required to prove editor resume.                         |
| Deep transcript search     | Can be expensive; first prove metadata search.                             |
| Web dashboard command      | Easy, but not a differentiator for the extension.                          |
| Groups / tags / stacks     | Wait until Milestone 12 data model stabilizes.                             |
| Live activity strip        | Belongs to Milestone 13 first, then extension if useful.                   |

## Configuration

The extension should start with very few settings.

Initial settings:

- `reup.refreshMode`: `manual` | `watch` | `interval`
- `reup.includeArchived`: boolean
- `reup.showStatusBar`: boolean, default `false` until usage is reliable

Do not expose a large settings surface before the MVP teaches us which controls
users actually need.

## Error Handling and Logging

- Create a `Reup` Output Channel.
- Log extension activation, refresh start/end, project/session counts, and
  recoverable failures.
- Never log transcript content.
- User-facing errors should be short and actionable:
  - "Project path no longer exists: <path>"
  - "Claude Code session ID was not found locally."
  - "Could not read Claude projects directory. Run Reup Doctor for details."
- Keep unexpected errors in the Output Channel with stack traces.

## Security and Privacy

- No telemetry.
- No extension-hosted network service or transcript upload. The shared core
  may make aggregate account-usage requests only after explicit
  `reup usage setup`; extension activation alone does not enable them.
- No transcript writes.
- No shell interpolation with untrusted strings.
- Only full UUIDs may be passed to `claude --resume`.
- Terminal cwd must come from a discovered local project/session path and must
  be checked before launch.
- Mutation commands, when later added, must require explicit confirmation and
  reuse Reup's existing safe metadata functions.

## Testing Strategy

Root repo checks remain mandatory:

```bash
npm run build
npm test
npm run lint
npm run format:check
git diff --check
```

Extension checks:

```bash
cd extension
npm run compile
npm run package
```

Add tests where they buy confidence:

- Adapter formatting/ranking tests using local fixtures.
- Prefix/UUID launch guard tests.
- Quick Pick item construction tests without a VS Code host when possible.
- Manual Extension Host smoke test for activation, Quick Pick, tree refresh,
  and integrated-terminal launch.

Avoid heavy UI automation until the extension shape is proven.

## Go / No-Go Criteria

Promote the extension beyond discovery only when all are true:

- A user can resume the right session from an open workspace faster and with
  more confidence than with Claude Code's native picker.
- The extension uses Reup's existing core intelligence, not a parallel parser.
- It remains local-first and telemetry-free.
- It starts quickly and does not slow down normal VS Code startup.
- It works on Windows, macOS, and Linux.
- It does not make the CLI/TUI/web package heavier in day-to-day use.

Kill or pause the extension idea if the MVP only feels like another picker.

## Suggested Branch Plan

1. `feat/vscode-extension-plan`
   - rewrite this plan
   - optionally add architecture notes discovered during scouting
2. `feat/vscode-extension-skeleton`
   - add extension scaffold
   - prove activation and bundled core read
3. `feat/vscode-resume-picker`
   - implement `Resume Here` and `Resume Session`
4. `feat/vscode-session-tree`
   - add read-only Activity Bar tree
5. `feat/vscode-session-detail`
   - add Resume Card detail if the first two branches feel useful

Keep each branch reviewable. The extension should earn complexity one slice at
a time.

## First Implementation Checklist

When implementation starts, do this first:

- [ ] Create `extension/` with a minimal manifest and activation command.
- [ ] Externalize `vscode` in esbuild.
- [ ] Add a `Reup: Diagnostics` command that reads `loadProjects()` and logs
      counts.
- [ ] Add `extension/src/reup-data.ts` with a small DTO mapper.
- [ ] Verify bundle size and activation time.
- [ ] Only then implement Quick Pick resume.

This keeps the first coding step honest: if shared-core bundling is awkward,
we learn before building UI on top of it.
