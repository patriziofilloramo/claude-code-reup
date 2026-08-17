# Contributing to Reup

Reup reads developer work history and makes decisions about whether a Claude
Code session is live, blocked, or safe to resume. Contributions are welcome,
but correctness, privacy, and reversible behavior take priority over feature
count or implementation speed.

## Development setup

Requirements:

- Node.js 20 or newer;
- npm;
- Git;
- VS Code only when working on or manually testing the extension.

From the repository root:

```bash
npm ci
npm ci --prefix extension
npm run build
npm test
```

Run the CLI from the checkout with `node dist/index.js`. Use a disposable
`CLAUDE_CONFIG_DIR` for tests or experiments that should not inspect your real
Claude Code data.

## Architecture boundaries

- `src/core/` owns discovery, parsing, health, live state, usage, organization,
  and resume policy.
- `src/tui/`, `src/web/`, and `extension/src/` render shared core decisions.
- A surface must not introduce a second parser or reinterpret a shared state.
- Claude-owned transcripts are read-only. Reup writes only Reup-owned metadata.
- Every filesystem, process, HTTP, and persisted-data boundary requires runtime
  validation.

Before changing live-state behavior, read
`Documents/CLAUDE_CODE_DATA_MODEL.md` completely. In particular:

- `null` evidence is common and must stay distinct from idle;
- reported and inferred state are not interchangeable;
- Agent View task state and process liveness are orthogonal: only a reported
  PID or verified lock proves a live process;
- a UI may render shared state differently, but must not derive it again;
- passing unit tests do not replace measurement across a real turn boundary.

See `Documents/ARCHITECTURE.md` for the current module map and invariants.

## Change standard

A focused change should include:

1. the smallest coherent implementation that solves the user outcome;
2. runtime validation for new external input;
3. a regression test for every corrected failure mode;
4. documentation for changed user behavior or durable design decisions;
5. no unrelated formatting or refactoring.

Prefer explicit domain names and small public APIs. Avoid abstractions that
only move code without isolating an invariant or boundary. Never turn a
best-effort result into a success message.

Permanent deletion, automatic branch changes, transcript writes, telemetry,
and remote transcript upload are outside Reup's default safety model. Discuss
any proposal that changes those boundaries before implementing it.

## Required checks

Run the full gate before requesting review:

```bash
npm run check:version
npm run format:check
npm run lint
npm run build
npm run build:extension
npm test
npm run package:extension
git diff --check
```

For packaging or distribution changes, also run:

```bash
npm pack --dry-run --json
npm run release:local -- --allow-dirty
```

`--allow-dirty` is for local validation only. Public artifacts must come from a
clean, reviewed commit and must pass the release policy in
`Documents/INSTALLATION.md`.

## Manual verification

Tests that mock Claude Code cannot establish live-state correctness. When a
change affects activity or attention:

- compare Reup with both `claude agents --json` and `claude agents --json --all`
  when available; classify PID-bearing rows separately from pidless managed
  `working`/`blocked` tasks;
- exercise terminal and VS Code sessions separately;
- observe the transition across prompt submission, tool work, user input, turn
  completion, interruption, and process exit;
- verify that a pidless official row needs a resume-visible local session or a
  verified live lock to enter presentation, while safety still retains it;
- never use `startedAt` as task-state age or auto-expire a managed row from age;
- confirm TUI, web, and VS Code show the same shared state;
- record the source and freshness of evidence without copying private session
  content into an issue or fixture.

Installer changes require install, upgrade, repair, and uninstall checks in a
clean or disposable environment for every affected platform.

## Pull requests

Keep pull requests reviewable and explain:

- the user problem and why the change belongs in Reup;
- important alternatives or tradeoffs;
- the automated and manual evidence collected;
- privacy, compatibility, and rollback implications;
- any follow-up work intentionally left out.

Do not include real transcripts, session titles, repository paths, credentials,
or customer data in commits, fixtures, screenshots, or logs. Use synthetic
UUIDs and minimal generated JSONL fixtures.

If a change creates durable product or architecture knowledge, record it in
the narrowest appropriate document: `Documents/ARCHITECTURE.md` for design and
invariants, `ROADMAP.md` for sequencing, and the document closest to the
subject otherwise.

## Reporting security issues

Do not open a public issue for a vulnerability or accidental data exposure.
Follow the private reporting instructions in `SECURITY.md`.
