# Reup Beta Validation

## Purpose

Validate that Reup solves a recurring workflow problem for developers who use
Claude Code across several projects and concurrent terminals. This is a product
validation exercise, not a feature tour. A successful beta proves that users
can find, triage, and resume work faster than with Claude Code alone.

Reup has no telemetry. Validation therefore uses observed tasks, short
interviews, and tester-provided feedback. Never collect transcripts, session
contents, credentials, or screenshots that expose private work.

## Target testers

Recruit 5-10 individual developers who meet all of these criteria:

- use Claude Code at least three days per week;
- have local sessions in at least three projects or worktrees;
- regularly keep more than one Claude Code session open;
- have previously searched for, forgotten, or resumed an older session.

Do not use first-time Claude Code users for the initial validation. Reup's
value appears only after session history and parallel work become difficult to
track. Record only coarse cohort facts such as operating system, primary
surface (terminal or VS Code), approximate project count, and approximate
session count.

## Setup gate

Before the product tasks, observe installation on a clean or disposable user
environment. Do not guide the tester unless they are irreversibly blocked.

The source beta requires Node.js 20 or newer, the Claude Code CLI, and existing
local Claude Code session history. Treat CLI/web installation and the optional
VS Code extension as separate steps: `npm link` does not install the VSIX.

Success criteria:

- the tester sees that the first TUI/web/config run automatically registers
  reversible attention hooks, understands the announced undo command, and can
  run `reup attention remove`;
- no account-usage request is made before the tester explicitly chooses
  `reup usage setup`, and `reup usage remove` reverses that integration;
- install to first useful session list takes at most three minutes;
- when `claude agents --json` is available, PID-bearing process rows and
  pidless managed background tasks are classified separately; every difference
  from Reup's presented set follows the documented resume-visible-session or
  live-lock anchor rule;
- extension installation is described separately when the tester chooses VS
  Code;
- removal or rollback instructions are discoverable and leave no Reup hook or
  status-line command in Claude settings.

Record the blocker category, not machine-specific paths or command output.

## Core tasks

### 1. Find forgotten work

Prompt: "Find the Claude Code session where you worked on a task you remember,
but whose project folder or terminal you do not remember."

Measure:

- time from opening Reup to selecting the intended session;
- whether the tester used metadata search, transcript search, touched-file
  lookup, or project browsing;
- whether the selected result was correct on the first attempt;
- the same task with Claude Code's native `/resume` picker when practical.

Target: at least 80% of testers select the intended session within 15 seconds
and no slower than their native workflow.

### 2. Triage live work

Prepare or use at least three ordinary interactive sessions: one working, one
attached but not known to be working, and one needing input where Claude Code
reports that state. When available, also include a background task that remains
`working` or `blocked` after its process exits. Test a locally discovered task
and an unmatched official-only row separately.

Prompt: "Without opening the individual terminals, tell me which session needs
you now and which one is still working."

Measure:

- correctness of each classification;
- time to the answer;
- whether the tester understands `needs-input`, `working`, and `attached`;
- whether the tester distinguishes Agent View task state from verified process
  liveness;
- whether the tester can tell that a label may be reported, locally observed,
  or inferred even where the current interface does not expose full provenance;
- any false urgent signal. Presenting an unmatched pidless official-only row as
  a local live session, calling a pidless task a live process, or losing its
  conservative safety protection is a critical failure.

Target: every reported state is correct, no tester treats an inferred hint as a
guaranteed event after reading the interface explanation, and at least 80% of
testers answer within 10 seconds.

### 3. Resume in context

Choose an inactive session from another project, preferably with branch drift,
a moved path, an interrupted turn, or substantial context.

Prompt: "Decide whether this is the right session to resume, explain any risk,
and continue it."

Measure:

- whether the latest recorded human request and assistant response are useful
  enough to explain what the user was doing and where Claude stopped;
- whether the tester notices relevant path or branch warnings;
- whether resume opens in the intended project without a copied shell command;
- whether the tester trusts the recommendation and why.

Target: at least 80% resume the intended session without opening a transcript
or manually changing directory first.

## Interview questions

Ask after the tasks, without describing the intended positioning first:

1. What problem does Reup solve for you?
2. Which screen or command would you use again next week?
3. What would make you return to Claude Code's built-in tools instead?
4. Which state or warning did you not trust?
5. Which visible feature could disappear without affecting your decision to
   keep Reup?
6. Would you keep the web dashboard, TUI, or VS Code view available while you
   work? Why?
7. What phrase would you use to recommend Reup to another Claude Code user?

Do not ask "Would you use this?" Future intent is weaker evidence than observed
task behavior.

## Decision rules

Proceed with the current positioning when:

- at least 4 of the first 5 qualified testers independently describe the value
  as finding, monitoring, or safely resuming work across projects;
- the task thresholds above are met;
- no tester encounters a data-loss risk or a false authoritative live-state
  claim;
- at least 3 testers voluntarily use Reup again within seven days.

Revise the experience before adding features when any core task misses its
target. Stop promoting live monitoring until corrected if a reported state is
wrong. Reconsider the target audience or positioning if testers value only a
secondary feature such as usage meters, themes, or transcript viewing.

## Feedback record

For each session, store only:

- anonymized tester code and cohort facts;
- task timings and pass/fail outcomes;
- navigation path and blocker category;
- short paraphrases of feedback;
- follow-up usage after seven days, when the tester volunteers it.

Keep raw transcripts, Claude session titles, repository names, paths, and
screenshots out of the feedback record. Summarize repeated findings in
`Documents/PROJECT_MEMORY.md` only after they affect a durable product decision.

Use synthetic, deterministic projects and sessions for public screenshots,
videos, and social cards. Never publish a maintainer's real paths, session
titles, branches, account-usage percentages, or other local metadata.
