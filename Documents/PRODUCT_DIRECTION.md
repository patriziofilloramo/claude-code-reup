# Swoop Product Direction

## Mission

> **Make Claude Code work observable, prioritised, and safe to resume —
> with zero configuration and no Swoop cloud.**

Swoop is the local control plane between your Claude Code sessions and your
next action. It is not just a session browser, not a transcript viewer, and not
a replacement for Claude Code's own picker. It answers the question that comes
before resuming: _"What was happening, what needs attention, and what should I
do next?"_

The experience benchmark: a developer who closed their laptop mid-task should
be able to open Swoop, understand the state of their Claude Code work, and
resume or clean up the right item in under ten seconds - with confidence, not
guesswork.

## Design Constraints (non-negotiable)

- **Zero configuration.** Works out of the box with a `swoop` invocation.
- **No Swoop-operated cloud, no account, no telemetry.**
- **Fast to open habitually** — sub-second TUI start, no loading spinners.
- **No API key required for core features.**
- **Light.** Adding a feature that makes the tool heavier requires a feature
  removed or the weight justified by a clear user outcome.

## Positioning

Claude Code already has a capable native session picker and can search across
projects from its resume flow. Swoop should not compete by claiming "global
session search" as its main reason to exist.

Swoop's navigator can still be better for power users: it is faster to scan,
shows projects and sessions together, exposes IDs and aliases, supports deep
search and filters, and works as TUI, web UI, and scriptable CLI. That is a real
UX advantage, but it is not the primary product hook.

Swoop's strongest role is:

> A local Claude Code control plane that shows what is running, what needs
> attention, what is safe to resume, and what should be cleaned up next.

The product should answer:

1. What was I working on?
2. Which session needs attention?
3. Is its original project context still valid?
4. Is it safe and useful to resume now?
5. Am I about to hit context or account limits?
6. Can I act without leaving my current surface (terminal, browser, VS Code, or script)?

## Competitive Landscape (as of mid-2026)

| Tool               | Approach                     | What Swoop does that they don't                        |
| ------------------ | ---------------------------- | ------------------------------------------------------ |
| Claude Code native | Built-in picker/resume flow  | Health signals, inbox, usage, diagnostics, automation  |
| Blackcrab          | GUI grid, multi-session view | Health signals, usage visibility, handoff              |
| ccresume           | Minimal CUI picker           | Everything beyond pick-and-resume                      |
| claude-code-viewer | Web with live streaming      | Lighter, local-first, no API key, session intelligence |

Swoop's moat is **operational intelligence plus surface choice**. Intelligence
means session health, context drift, rate-limit state, recovery paths, and
pre-resume summaries. Surface choice means the same local facts are useful from
the terminal, web, scripts, and eventually VS Code. A prettier picker alone is
not defensible; a reliable local operations console is.

## Strategic Bets

Swoop's next differentiators should be built around three reinforcing bets:

1. **Web organization for many projects and sessions.** The web UI should become
   the best place to group, tag, stack, triage, and focus Claude Code work. The
   winning concept is not generic labels; it is work organization by intent:
   "Launch week", "Auth migration", "Waiting on review", "High-context work".
2. **An always-open live web panel.** Developers should be able to keep
   `swoop web` open while Claude Code runs elsewhere and immediately see active
   sessions, changing state, latest tool activity, usage freshness, and attention
   events. It should be calm and glanceable, not a transcript stream.
3. **A VS Code extension only if it surfaces Swoop intelligence natively.** The
   extension should not be a dashboard clone. It should bring groups, stacks,
   active state, usage, resume cards, and safe actions into the editor workflow.

The preferred sequence is: organization first, live web panel second, VS Code
extension discovery in parallel until its MVP is clearly stronger than simply
calling Claude Code's native picker.

## Product Principles

- Local-first, private, and useful without an account.
- Fast enough to open habitually.
- Read-only toward Claude-owned transcripts.
- Useful from both an interactive UI and scripts.
- Focused on continuity and diagnostics, not transcript browsing for its own
  sake.
- Cross-platform without hiding platform-specific limitations.

## Differentiating Capabilities

### Multi-Surface Control Plane

Swoop should make the same local session intelligence available where developers
already work:

- TUI for fast keyboard-first navigation
- Web UI for an always-open dashboard
- CLI for scripting and automation
- VS Code extension for integrated-editor workflows

The shared core should remain local-first and UI-agnostic. New surfaces should
consume the same discovery, health, usage, and resume primitives rather than
reimplementing session parsing.

### Power-User Navigator

The navigator is still a product strength, even though Claude Code has native
global resume/search. It should be positioned as a denser, more informative
operations view rather than as "global sessions exist here and not there".

Keep investing where it is clearly better than the native picker:

- scan many projects and sessions at once
- show health, usage, branch, model, aliases, and active-state inline
- support deep transcript search and structured filters
- make IDs/prefixes, handoff, archive, cleanup, and diagnostics one action away
- preserve a fast, keyboard-first path for daily use

### Resume Card

Before resume, show a compact answer to "what was happening?":

- Last meaningful user request
- Last meaningful assistant response
- Pending or failed tool call
- Native Claude TODO state when present (`TodoWrite` open / in-progress / completed items)
- Recently touched files
- Recorded cwd and branch
- Last activity and active-session state

This is more valuable than building a full transcript viewer first.

### Context Drift

Warn when the recorded context no longer matches the current environment:

- Missing or moved cwd
- Recorded branch differs from the current branch
- Worktree no longer exists
- Session appears active elsewhere
- Repository changed significantly since last activity

Warnings should explain the issue and offer the exact safe resume action. Swoop
should not automatically switch branches or alter worktrees.

### Lost And Found

Surface sessions that may be absent or unclear in normal workflows:

- Sessions missing from an index
- Malformed or partially written transcripts
- Missing project paths
- Stale sidecar locks
- Sessions approaching automatic cleanup

Each finding should explain why it matters and what the user can do.

### Usage Awareness

Make the limits that affect whether work can continue visible before they become
a surprise. Distinguish local session-context facts from live account limits,
show freshness, and leave unavailable values unknown rather than estimating
them. Usage collection must remain local, supported, and opt-in where it changes
Claude Code configuration.

### Composable CLI

Power-user commands can make Swoop valuable beyond its interfaces:

```text
swoop inbox
swoop doctor
swoop search <query>
swoop list
swoop handoff <session>
```

Commands should produce concise human output and provide machine-readable output
where useful.

Search should be global by default because users often remember the work but
not its originating project. Explicit qualifiers may narrow results; interface
focus must not silently change search semantics.

## Explicit Non-Goals

- Swoop-hosted cloud synchronization, accounts, or team features
- Generic support for every AI coding tool
- Embedded terminals or an Electron wrapper
- Full billing or cost-accounting dashboards
- Automatic git branch/worktree modification
- Rewriting or repairing Claude-owned transcript files
- A full transcript editor or IDE replacement

## Priority Order for New Work

When choosing what to build next, apply this filter in order:

1. **Does it help the user decide whether to resume a session?**
   → Highest priority. This is the product's core job.
2. **Does it surface something the user couldn't see before (health, limits, context)?**
   → High priority. This is the intelligence moat.
3. **Does it make an existing workflow faster without adding complexity?**
   → Medium priority. Worth doing if the gain is clear and the surface stays clean.
4. **Does it put existing intelligence into a surface where developers already work?**
   → Medium priority. VS Code can qualify if it exposes Swoop's signals and actions, not
   if it only duplicates the native picker.
5. **Is it UI polish, navigation convenience, or parity with a competitor?**
   → Low priority. Only if it costs little and doesn't add cognitive surface.

The next shared capabilities should strengthen the three strategic bets:
organization metadata, live state/freshness, and editor-ready JSON contracts.
Nothing in the UI layer should block the shared core needed by web, TUI, CLI,
and a future VS Code extension.

## Delivery Guidance

Prefer small features that improve confidence before resume. Avoid forcing
feature parity between TUI and web when a capability naturally belongs in one
surface.

For VS Code work, investigate before building. The first milestone should prove
whether a native extension can offer something better than both Claude Code's
native picker and the existing TUI/web UI. A simple dashboard clone is not
enough; the extension should expose attention, usage, health, and resume actions
inside the editor workflow.

Keep completed work and near-term tasks in [`ROADMAP.md`](../ROADMAP.md). This
document should change only when the product's direction changes.

---

## Naming Brief (for research)

### Current state

| Identifier      | Value                     | Status                    |
| --------------- | ------------------------- | ------------------------- |
| Product brand   | Swoop                     | Final                     |
| CLI command     | `swoop`                   | Final                     |
| npm package     | `claude-code-swoop`       | Available and selected    |
| Repository name | `claude-sessions-manager` | Rename before publication |

The public product name is resolved. Swoop is the human-facing brand and CLI
command; `claude-code-swoop` is the descriptive npm package name. The remaining
publication task is selecting and creating the public repository location.

### What the tool is

A **local-first session manager for Claude Code** (Anthropic's AI coding CLI).
It provides:

- A TUI (terminal UI) and a web UI to browse, inspect, and resume Claude Code sessions
- Health signals for each session (interrupted, expiring, context drift)
- Usage / rate-limit visibility before you commit to resuming
- Cross-device sync via OS junctions / symlinks (no cloud account required)
- A composable CLI for scripting (`swoop inbox`, `swoop doctor`, `swoop list`, etc.)

Target users: individual developers who use Claude Code daily and manage multiple
projects / sessions. The tool is never user-facing to end customers — it is a
developer productivity tool.

### Naming goals

A good name for this tool should:

1. **Be short** — ideally 2–8 characters or two short words. The CLI command
   that users type daily must be fast to type (3–4 chars preferred).
2. **Suggest session continuity or context** — not just "Claude wrapper".
   Words or roots around: session, resume, context, handoff, pick up, inbox,
   queue, orbit, lens, relay, trace, mark, anchor, dock, scout, helm, pilot.
3. **Not infringe on Anthropic / Claude branding** — the name should not
   start with "claude" (likely to conflict with Anthropic's own tooling going
   forward). The selected package name uses "claude-code" descriptively while
   the product itself remains independently branded as Swoop.
4. **Sound like a developer tool** — lowercase, terse, Unix-flavoured.
   Not marketing language. Examples of the right register: `tmux`, `fzf`,
   `zoxide`, `rg`, `bat`, `gh`, `mise`, `atuin`, `navi`.
5. **Be unique enough in the Claude / AI tooling ecosystem** that searches
   for the name surface this tool, not something else.

### What to check for each candidate name

For every candidate name the researcher proposes, verify:

- [ ] `npm` registry: `https://www.npmjs.com/package/<name>` — available?
- [ ] `npm` scoped: `https://www.npmjs.com/package/@<scope>/<name>` — if unscoped is taken
- [ ] GitHub: `https://github.com/<name>` and `https://github.com/topics/<name>`
- [ ] Homebrew: `https://formulae.brew.sh/formula/<name>` — any conflict?
- [ ] General web search for `<name> npm` and `<name> cli` — any confusion risk?

The CLI command and npm package intentionally differ: users type `swoop`, while
the package publishes as `claude-code-swoop`.

### Names already in the Claude / AI tools space (avoid or note conflicts)

Known npm packages to avoid clashing with:

- `claude` — Anthropic SDK
- `claude-code-swoop` — selected for this project
- `ccresume`, `blackcrab`, `claude-code-viewer` — competing tools
- Anything prefixed `@anthropic-ai/` — reserved for Anthropic

### Candidate name patterns to explore

The researcher should explore (but is not limited to) these patterns:

- **Two-letter or three-letter commands**: `csm`, `csx`, `csk`, `cpx`, `cre`
- **Short compound words**: `sesskit`, `resumark`, `contex`, `inboxd`
- **Single evocative words**: `handoff`, `sessio`, `pickit`, `requeue`, `orbctl`
- **Portmanteaux**: `codemarks`, `sesslog`, `claudex` (avoid claude-prefix)
- **Metaphor-driven**: tools that "dock", "anchor", "orbit", "helm" a session
- **Action-first**: resume-focused words — `repick`, `recall`, `recon`, `recontext`

### Deliverable expected from the researcher

A ranked shortlist of **5–10 candidate names**, each with:

1. Confirm the selected **npm package name** remains available immediately before publishing.
2. Confirm the selected **CLI command** has no newly significant ecosystem collision.
3. **Availability status** for npm, GitHub, Homebrew, and web search
4. **One-sentence rationale** for why this name fits the tool's identity
5. Any **risks or caveats** (trademark-adjacent, confusable with something else, etc.)

The final choice will be made by the project owner after reviewing the shortlist.
