# Reup Product Direction

## Mission

> **Make scattered local Claude Code work easy to find, easy to triage, and
> safe to resume.**

The public expression of that mission is:

> **Remember the work, not where you started it.**

Reup is a local continuity tool for Claude Code CLI work. It helps a developer
move through one loop:

1. Find the task they remember across local projects and session history.
2. See which session or managed background task needs attention without
   checking every terminal.
3. Understand the recorded context before resuming in the right directory.

The product is successful when that loop feels substantially better than
remembering paths, revisiting terminal tabs, or reopening sessions to discover
what they contain.

## Target User

Reup is for an individual developer who:

- uses Claude Code most days;
- works across several repositories, worktrees, and terminal windows;
- keeps enough session history that project location is no longer memorable;
- revisits interrupted work after hours or days; and
- wants local visibility without adopting a hosted Reup service.

The product is intentionally less relevant to someone with one repository and
one or two sessions. Marketing should not obscure that. A precise audience
makes the value easier to recognise and keeps the feature set disciplined.

## Positioning

Reup's positioning has three levels:

| Role                               | User outcome                                                                    | Why it matters                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **Wedge: finding**                 | “I can locate the task without remembering its directory or terminal.”          | Immediate, demonstrable, and easy to experience with existing history |
| **Habit: triage**                  | “I can leave Reup open and notice which local session needs me.”                | Creates recurring daily value after discovery                         |
| **Differentiator: resume context** | “I know where Claude stopped and whether the path and branch still make sense.” | Adds confidence beyond selecting a session ID                         |

Finding is not technically exclusive: Claude Code's `/resume` picker can widen
to every local project. Reup should still lead with finding because its
persistent project/session map, structured search, transcript search, touched
files, and inline state make recognition faster for the target user.

Monitoring alone is also not exclusive: Claude Code Agent View is a strong
first-party interface for background sessions. Reup's relevant boundary is
different. It combines discovered local history with ordinary interactive
sessions that hold a live process and locally anchored managed background
tasks, without requiring the developer to background every session first.

Use one public session-state vocabulary across interfaces. These are triage
labels; process presence is a separate fact:

- **needs-input:** a matched session or managed task is blocked on a reported
  or locally observed user action;
- **working:** Agent View reports managed work in progress, or live evidence
  indicates that a matched session is producing output or running a tool;
- **attached:** a live process holds the session, but current work is not
  established;
- **detached:** no current live process is known.

A reported PID or verified local lock is the only basis for claiming a live
process. Agent View task state can remain `working` or `blocked` after that
process exits, so it must not be reinterpreted as process liveness.

Do not substitute `waiting`, `running`, or `idle` as unexplained top-level
states in product copy. A surface may add those words as detail only when it
also preserves the shared state and its evidence boundary.

The defensible product is therefore the complete sequence — **find → triage →
inspect → resume** — not any isolated badge, search box, or interface.

### One-sentence description

> Reup brings your local Claude Code CLI work into one persistent view across
> projects and ordinary terminal sessions, so you can find it, see what needs
> you, and resume in context.

### Messaging rules

- Lead with the outcome, not “control plane”, “session intelligence”, or a list
  of interfaces.
- Say **local Claude Code CLI work**, not “every Claude session”. Claude desktop,
  web, and remote histories are outside Reup's scope.
- Do not claim Claude Code lacks global search or live background-session
  monitoring.
- Do not claim a feature is unique unless a dated, repeatable competitive audit
  supports the exact claim. Prefer a concrete boundary over a superlative.
- Describe source and freshness whenever a status could be inferred.
- Keep TUI, web, VS Code, and CLI as delivery interfaces, not separate value
  propositions.
- Present local operation as a trust property, not the primary reason to install.

## Relationship to Claude Code

Reup complements, rather than replaces, Claude Code's native tools.

| Tool                   | Primary job                                                                                         | Relevant boundary                                                                                                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Claude Code `/resume`  | Switch to a saved conversation; widen from the current worktree to all local projects with `Ctrl+A` | It is a picker inside the resume flow. Selecting a session from an unrelated project copies a `cd` and resume command rather than acting as a persistent work map. |
| Claude Code Agent View | Dispatch, monitor, reply to, and attach to background sessions                                      | Ordinary interactive sessions in other terminals are not listed until they are backgrounded. Agent View is a research preview.                                     |
| Reup                   | Find local history and matched work together, inspect its context, and resume from the correct path | It is limited to local Claude Code CLI data and must remain compatible with an evolving first-party data model.                                                    |

Canonical native references:

- [Claude Code session management](https://code.claude.com/docs/en/sessions)
- [Claude Code Agent View](https://code.claude.com/docs/en/agent-view)

This comparison must be rechecked near every public release. Anthropic owns the
upstream data and can narrow any individual feature gap quickly.

## Core Product Loop

### 1. Find the work

The user often remembers the task, a file, or a phrase — not the originating
directory. Reup should make all discovered local CLI work recognisable at a
glance.

Keep investing in:

- a persistent project and session map;
- fast metadata search across projects;
- structured qualifiers for status, project, branch, activity, and archive;
- explicit on-demand transcript search;
- reverse lookup for paths targeted by recorded write/edit tool calls;
- aliases and adaptive session-ID prefixes;
- enough row context to distinguish similar sessions without opening them.

Search is global by default. Interface focus may rank nearby results but must
not silently narrow semantics.

### 2. Know what needs attention

The product should answer “which local work needs me now?” calmly and with a
small number of trustworthy states.

Useful outcomes include:

- distinguish active work from idle history;
- surface permission or input waits when Claude reports them;
- keep failure and interruption evidence visible;
- prioritise missing paths, branch drift, expiry, and high context;
- show when a status is reported, locally observed, inferred, stale, or unknown;
- avoid turning every old or ambiguous session into an alert.

The dashboard should be glanceable, not a transcript stream or notification
firehose.

### 3. Resume in context

Before resume, a compact card should answer:

- What was the latest human request recorded in the transcript?
- What was Claude's latest recorded response?
- What remains open?
- Which files were touched, read, or searched?
- What directory and branch were recorded?
- Has that path or branch changed?
- Is the session already active?
- Are context, compaction, or usage limits relevant?
- What exact action will Reup take next?

Prefer structured facts Claude already records over manual bookkeeping:

- plan-mode artifacts and accepted plans;
- TODO state;
- tool calls and results;
- changed, read, and searched files;
- working directory, branch, entrypoint, permission mode, and version;
- compact summaries and recent recorded prompts;
- model, context, and usage facts.

Unavailable facts stay unavailable. A plausible sentence is not a fact.

## State Evidence Contract

Trustworthy state is a product feature. Reup must apply evidence per field,
rather than choosing one source for the whole session.

Precedence for a particular live-state field:

1. **Reported:** a present, valid field from Claude Code's documented Agent
   View inventory, such as `pid`, `status`, `state`, or `waitingFor`.
2. **Observed:** a valid local Claude lock or Reup/Claude hook event.
3. **Inferred:** transcript timing and event-shape heuristics.
4. **Unknown:** no source supports a stronger conclusion.

Rules:

- A missing reported field never erases valid lock or hook evidence.
- A newer valid local report may supersede an older live-inventory snapshot.
- Invalid or unrecognised values are ignored safely and remain diagnosable.
- `state` describes managed background-task lifecycle; `waitingFor` refines the
  reason when process `status` is `waiting`. Only a reported PID or verified
  lock proves that a process is live.
- A pidless managed row remains conservative safety evidence. It is presented
  only when it maps to a resume-visible discovered session or a verified live
  lock. Attention and work markers are not anchors because they can be
  orphaned.
- `startedAt` is not a state-transition timestamp. Managed rows are neither
  called historical nor expired solely because they are old.
- Reported permission/input waits take precedence over a generic working
  inference.
- Old Claude Code versions or an unavailable Agent View inventory must degrade
  without breaking session discovery.
- Every UI does not need to expose implementation detail in every row. Full
  source and freshness are not yet visible in every shipped interface, so
  public copy must call labels guidance rather than proof. Making provenance
  inspectable in the inspector and diagnostics remains a P1 objective.
- Do not say “live” when the source is only a recently written transcript.

This contract replaces the earlier blanket claim that permission prompts could
not be detected. Current Claude Code versions document `waitingFor` reasons,
including permission prompts. Reup still cannot guarantee detection when those
fields are unavailable or a managed row cannot be anchored to a resume-visible
discovered session or verified live lock.

## Product Principles

- **Outcome first.** Organise features around the continuity loop.
- **Zero configuration for core use.** `reup` should work after installation.
- **Fast enough to become a habit.** TUI startup and common navigation should
  feel immediate.
- **Local and explicit.** No Reup account, hosted backend, telemetry, or hidden
  network dependency for core discovery. Authenticated aggregate account-usage
  requests are off until `reup usage setup`.
- **Read-only toward Claude-owned transcripts and indices.** Reup-owned
  metadata is separate and clearly described. The TUI, web, and configuration
  flows automatically register or repair reversible attention hooks in Claude
  settings, announce that write, and provide `reup attention remove` as the
  undo command.
- **Consent for optional network access.** `reup usage setup` is the boundary
  for status-line changes and account-usage requests to Anthropic. The previous
  status line is replaced only with `--replace`; `reup usage remove` restores
  it and clears Reup's aggregate cache.
- **Evidence over theatre.** Unknown is preferable to a confident but weak
  status badge.
- **Actions explain consequences.** Resume, archive, cleanup, and delete must
  state what changes.
- **Lightweight scope.** A feature earns its weight through a measurable user
  outcome.
- **Cross-platform with visible limits.** Do not hide platform or upstream
  compatibility boundaries.

### Archive and deletion semantics

- **Archive** writes reversible Reup-owned metadata and hides the session from
  default Reup views. It does not move, rename, or delete the Claude transcript.
- **Permanent delete** is a separate explicit action in the TUI and web
  dashboard. It requires confirmation, is blocked for active sessions, removes
  the transcript, and cannot be undone.
- Background maintenance may archive; it must never permanently delete.
- The VS Code extension exposes archive/undo but no destructive delete action.

## Interface Strategy

Interfaces come after the core outcomes:

- **TUI:** the fastest keyboard-first find, inspect, and resume path.
- **Web:** a calm, always-open local project/session overview and organization
  surface.
- **VS Code:** workspace-first discovery and pre-resume context in the editor.
- **CLI:** composable queries and actions for scripts.

New interfaces should consume shared discovery, state, preview, metadata, and
resume policy. Do not create a parser, status vocabulary, or safety policy that
exists in only one interface.

Parity is not the goal. Each interface should expose the part of the core loop
that fits its environment while preserving the same facts and consequences.

## Current Priorities

### P0 — Launch integrity

1. Prefer Claude Code's documented Agent View inventory per valid field, with
   safe local fallbacks and unknown states.
2. Audit README, landing page, screenshots, and feature claims against shipped
   behavior.
3. Publish one install path that a beta user can actually complete. Until npm or
   release artifacts exist, say that source is the current path.
4. Keep signing status exact: unsigned and not notarized until the published
   artifacts prove otherwise.
5. Demonstrate the three-task loop with realistic multi-project data.

### P1 — Strengthen the loop

1. Improve result recognition: better titles, project/path context, branch,
   status, and last recorded activity in the list.
2. Improve attention precision and make source/freshness inspectable.
3. Improve resume cards and warnings without becoming a transcript viewer.
4. Reduce steps between selecting a session and resuming it in the correct
   directory.

### P2 — Supporting depth

Usage, organization, handoff, doctor, cleanup, shell completion, configuration,
and `CLAUDE.md` editing should deepen the core workflow but not compete with it
for homepage hierarchy.

Do not add a new product category until the core loop is validated with target
users.

## Validation

Test with developers who have several repositories and a meaningful local
Claude Code history. A generic developer panel will understate the problem.

Measure three tasks:

1. Find an old session from a remembered task clue without knowing its project.
2. Identify which currently open session needs human attention.
3. Resume the correct session and explain its current goal, next step, path,
   and branch before Claude Code opens.

Useful success signals:

- completion rate and median time for each task;
- wrong-session resumes;
- confidence in reported versus inferred state;
- number of terminal or directory visits needed;
- whether the developer leaves Reup open or returns to it unaided;
- which secondary features are actually used during those tasks.

The experience benchmark remains: after closing a laptop mid-task, a target
user should be able to open Reup, recognise the relevant work, and choose the
next action in roughly ten seconds. This is a product aspiration to measure,
not a public performance guarantee.

## Explicit Non-goals

- Reup-hosted cloud synchronization, accounts, or team features
- Aggregating Claude desktop, web, remote, or mobile histories
- Generic support for every AI coding tool
- Remote control or mobile operation
- Embedded terminals or an Electron desktop wrapper
- Automatic branch or worktree mutation
- Rewriting or repairing Claude-owned transcript files
- Full transcript editing, replay, or IDE replacement
- Full billing or cost accounting
- Semantic-search infrastructure before current search is validated
- More manual organization primitives without evidence they improve the core
  loop

## Decision Filter

Evaluate proposed work in this order:

1. Does it make the right local work easier to find or recognise?
2. Does it improve the accuracy or usefulness of attention state?
3. Does it make resume context clearer or resume safer?
4. Does it reduce friction in an existing core workflow without adding a new
   concept?
5. Does it expose shared intelligence in an existing interface?
6. Is it primarily UI polish, organization, or competitor parity?

The first three can justify substantial work. The last three require a small
cost or direct validation evidence.

Keep completed work and near-term implementation tasks in
[`ROADMAP.md`](../ROADMAP.md). This document changes when the product strategy
changes.

## Naming and Publication

| Identifier                  | Value                     | Status                                     |
| --------------------------- | ------------------------- | ------------------------------------------ |
| Product brand               | Reup                      | Final                                      |
| CLI command                 | `reup`                    | Final                                      |
| npm package                 | `@patriziofilloramo/reup` | Reserved project choice; not yet published |
| Repository                  | `claude-code-reup`        | Current                                    |
| VS Code package             | `reup-vscode`             | Current                                    |
| VS Code command/view prefix | `reup.*`                  | Current                                    |

The unscoped npm name `reup` belongs to an unrelated package. Users will still
type the `reup` binary from the scoped package when publishing begins.

Before a public release, recheck npm, GitHub, Homebrew, and general search for a
newly significant collision. Do not reopen historical naming work without a
concrete legal or distribution blocker.
