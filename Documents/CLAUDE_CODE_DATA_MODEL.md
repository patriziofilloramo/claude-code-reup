# Claude Code Data Model

Reup combines Claude Code's documented `claude agents --json` inventory with
local files Claude Code writes for its own purposes. The inventory is optional
and can omit fields; the local formats are not a stable API, vary by client,
and contain several shapes that mean the opposite of what they look like.

**Read this before changing anything that decides whether a session is running,
waiting, idle, or interrupted.** Every trap below is one that was actually hit,
shipped, and reported by the user. They are listed with the wrong assumption
first, because that is the form an agent arrives with.

## What Reup reads

| Source                          | Written/reported by      | Reup's use                            |
| ------------------------------- | ------------------------ | ------------------------------------- |
| `claude agents --json`          | Claude Code official CLI | Managed IDs, task state, wait reasons |
| `~/.claude/sessions/*.json`     | Claude Code lock files   | Which sessions hold a process         |
| `~/.claude/projects/**/*.jsonl` | Claude Code transcripts  | Turn boundaries, tools, timing        |
| `reup/attention/`, work markers | Reup-owned Claude hooks  | Reported turn boundaries              |

Claude-owned files are read and never written. The inventory subprocess uses a
fixed executable and argument list and is an observation only.

## The traps

### 1. Lock files do not always carry `status`

**Wrong assumption:** every live session reports `busy` or `idle`.

VS Code peer locks omit the `status` field entirely, and so do freshly spawned
processes. Interactive rows in the official inventory may also omit activity
state. A live process can therefore be known while its current turn state is
unknown.

Any rule shaped `if (status === 'idle')` silently never fires for those
sessions. This is the single most common wrong assumption in this codebase, and
the root of most live-state bugs. `combineWorkEvidence()` merges the lock field
with Reup's own hook marker, newer wins, and still returns `null` when neither
exists — `null` is a real, common case, not an edge case.

### 2. `stop_reason` ends a turn — block shape does not

**Wrong assumption:** an assistant message with no `tool_use` block is the end
of the turn.

Claude Code splits one assistant turn across several events: thinking, then
text, then `tool_use`. A text event mid-turn is identical in shape to the last
word of a finished one, so block types cannot tell them apart. Reading the
shape reports a turn as finished several times while it is still running.

Claude Code records the API's own `stop_reason` on assistant messages.
`end_turn` is the only value meaning Claude chose to stop; anything else means
more of the turn is still coming. `isFinalAssistantEvent()` falls back to block
shape only when the field is absent, so older transcripts degrade to the old
reading instead of reporting every turn as unfinished.

### 3. The tail window must be sized by events, not bytes

**Wrong assumption:** reading the last N KB of a transcript gives you the last
few turns.

A single tool result carrying a file can be tens of KB on its own. A fixed byte
window can therefore contain zero conversational events, and the first line of
any window is always discarded as a partial line. The turn-boundary signal then
depends on where the byte boundary happened to fall, which made live state flip
between runs with nothing visible in the data to explain it.

`readSessionTailActivity()` starts at `TAIL_BYTES` (64 KB) and quadruples up to
`MAX_TAIL_BYTES` (512 KB) until the window holds at least `MIN_TAIL_EVENTS` (3)
conversational events. This was the final root cause of "goes idle ~10 seconds
after the prompt" — a bug that survived three earlier wrong diagnoses.

### 4. An interruption is recorded, not only inferred

**Wrong assumption:** a stopped session is one with an unanswered tool call.

There are two distinct facts, and they are not interchangeable:

- `interrupted` — _inferred_ from a `tool_use` with no matching `tool_result`.
  Normal mid-turn state for a live session. It can stay true forever, so it
  must never drive a live indicator.
- `interruptedByUser` — _recorded_. Claude Code writes an explicit marker turn.

The marker is written as a **user** turn, so parsing that treats any user turn
as "the user moved on" erases the very evidence it carries. Stopping a session
therefore used to make it _less_ likely to be reported as interrupted than
simply leaving a tool call dangling.

Match the marker strings **exactly**, never as a substring: compaction
summaries quote earlier turns verbatim, and ordinary messages discuss
interruptions. A substring test flags those sessions as interrupted forever.

### 5. Provenance is part of the state

**Wrong assumption:** a state is a state; where it came from is an
implementation detail.

`stateIsReported` is true when an applicable official inventory field, a lock
`status` field, or a hook marker reported the turn boundary. It is false when
the state came from transcript recency alone, which cannot distinguish a long
tool call from a finished turn.

> **A claim about an event requires reported evidence; presentation may use the
> guess.**

The desktop "turn finished" alert is such a claim, and firing it on recency
meant an alert every time Claude paused to think.

### 6. Freshness windows, and what each is for

| Constant                        | Value | Meaning                                                    |
| ------------------------------- | ----- | ---------------------------------------------------------- |
| `BUSY_STATUS_TRUST_WINDOW_MS`   | 5 min | How long a reported lock/hook `busy` stays believable      |
| `TRANSCRIPT_RUNNING_WINDOW_MS`  | 10 s  | Transcript activity as proof of work itself                |
| `WAITING_WINDOW_MS`             | 30 s  | Below this a quiet session is waiting, not idle            |
| `claudeAgentsRefreshMs`         | 10 s  | Minimum interval between official inventory refreshes      |
| `claudeAgentsStateFreshMs`      | 15 s  | Maximum age for official state to drive presentation       |
| `claudeAgentsSafetyRetentionMs` | 60 s  | Stale retention only for conservative destructive barriers |

`TRANSCRIPT_RUNNING_WINDOW_MS` is deliberately **not exported**. A surface
applying it itself is exactly what made the TUI call a session busy that the
web had already called idle.

### 7. A registered hook is not a working hook

**Wrong assumption:** if Reup's hook entries are in `settings.json`, reported
evidence is available.

Hook entries name a script by absolute path. If that path stops resolving —
the install moved, was removed, or lived on a drive that is no longer mounted —
Claude Code still runs the command, node still fails, and **nothing anywhere
reports it**. Every turn boundary and every needs-input alert is lost, and all
surfaces fall back to guessing from transcript recency.

Found on the development machine itself: the global install was an `npm link`
to a path on an unmounted drive, so all three hooks had been dead for three
weeks while `reup attention status` reported them configured. Much of the
live-state fragility chased during that period was this, not inference bugs.

`inspectAttentionHookHealth()` returns `not-configured | ready | broken`, and
`broken` is the state registration checks cannot see. Before concluding that a
client "does not fire hooks", check this first — the earlier conclusion that
VS Code never fires them was drawn while every client was equally dead.

`ensureAttentionHook()` runs on TUI/web/config startup. It installs missing
Reup-owned entries unless the user previously opted out, or repairs their path
to the running install when it moved. The write is announced together with
`reup attention remove`; explicit removal records the opt-out. It never touches
a command Reup did not write — `hookScriptPath()` returns null there, and null
means "cannot check", never "fine". `reup doctor` reports what repair cannot
fix, which is the case where Reup itself has no stable path to name.

### 8. Nothing retracts a busy flag when a turn ends badly

**Wrong assumption:** a turn that stops is followed by a `Stop` hook.

Claude Code fires no `Stop` hook when the user interrupts a turn, nor when the
API fails. Confirmed in the capture log by two consecutive `UserPromptSubmit`
entries with no `Stop` between them. The last reported work state therefore
stays `busy` with nothing to ever retract it, and the session reads as running
until the five-minute trust window simply ages out — observed as a pulsing
green dot with an "interrupted" badge beside it, and as a session still
"running" minutes after hitting a spend limit.

The transcript records both endings, and that record is the retraction:
`SessionTailActivity.turnEndedByRecord` is `user-interruption` or `api-error`.
One field rather than a flag per case, because the reasons are mutually
exclusive and two booleans kept in sync by hand drift apart.

This is deliberately the **only** tail signal allowed to overrule a reported
`busy`: ordinary quietness must not, since a long tool call looks exactly the
same from outside.

### 9. An API failure is an assistant event, and its stop_reason lies

**Wrong assumption:** `stop_reason` distinguishes a finished turn from a
failed one.

A 429 spend limit is recorded as an ordinary-looking assistant event:

```
type: assistant   apiErrorStatus: 429   stop_reason: "stop_sequence"
content: "You've hit your monthly spend limit ..."
```

`stop_reason` is `stop_sequence`, so trap 2's rule (`end_turn` or the turn is
still in flight) reads a failed turn as a running one, forever. The failure is
identified by the event's own `isApiErrorMessage` / `apiErrorStatus` fields,
which sit at the **top level** of the event, not inside `message`.

### 10. Official does not mean timeless or complete

**Wrong assumption:** once `claude agents --json` reports a state, it should
override every local observation until the next successful command.

The inventory is sampled and its fields can be absent. Reup accepts an
official state for presentation only while the snapshot is at most 15 seconds
old and no newer local reported fact contradicts it. A newer lock/hook
transition, a live lock contradicting official `detached`, or a
transcript-recorded `user-interruption`/`api-error` supersedes an older
snapshot. Ordinary transcript recency does not: it is not strong enough to
overrule a reported event.

The reader is single-flight and stale-while-revalidate. Persistent surfaces
paint from locks immediately and refresh the inventory in the background;
one-shot and safety-sensitive operations may wait. A failed refresh retains
the previous snapshot for at most 60 seconds only to prevent destructive false
negatives. Stale data must never be presented as live.

The process boundary is also a privacy boundary. Reup validates at most 10,000
rows within a 1 MiB response, rejects duplicate session IDs, and discards
Claude's display names and summaries. Logs contain only a sanitized error
name/code, never the command payload or stderr.

### 11. Agent View task state is not process liveness

**Wrong assumption:** a background row without a PID is either a live process
or harmless old history, depending only on its age.

The default `claude agents --json` inventory contains every live session **plus**
background tasks still reported as `working` or `blocked` after their process
has exited. Only `--all` adds completed background tasks. `pid` and `status`
are present only while the process is alive; `state` describes the background
task lifecycle, while `waitingFor` refines the reason when `status` is
`waiting`. These axes are related, but they are not interchangeable.

Snapshot freshness means Reup observed the row recently. It does not mean the
task changed recently, and `startedAt` is not a state-transition timestamp.
Never expire a pidless `working`/`blocked` task, or relabel it historical, from
age alone.

Reup therefore keeps these rows in the managed set used by conservative safety
checks. Presentation is narrower: `isPresentableClaudeAgentSession()` admits a
pidless official row only when Reup can anchor it to a resume-visible discovered
session or a verified live lock. Hook markers are reported turn evidence, but
they can outlive a session and are not presentation anchors by themselves. This
prevents a non-navigable Agent View task from appearing as a local live session
without discarding valid managed state.

## The one rule that holds it together

Managed inventory and presentable activity are resolved **once** from shared
evidence.
`resolveLiveSessionSignals()` assembles official inventory, locks, hooks, and
transcript tails; `resolveSessionLiveState()` maps that evidence into four
states: `needs-input`, `working`, `attached`, `detached`. Every surface draws
that answer. Persistent callers request official refresh in the background so
an optional subprocess cannot block first paint.

A surface may choose how to render a state, and may add detail on top — the web
splits `attached` into a reported `waiting` and plain quiet. A surface may
**not** add a value to the vocabulary or reinterpret one. Re-deriving liveness
locally is the recurring regression, not a shortcut.

`tests/core/session-live-state.test.ts` guards the boundary as well as the
resolver: it fails if a surface starts deriving liveness on its own again.

## How to verify a change here

Unit tests are necessary and not sufficient — every bug above passed the suite
that existed at the time. The failures were in _measurement_, so:

- **Check what the server is actually serving.** Compare the web server's
  process start time against `dist/web/client.js` mtime before believing any
  observation. Two measurements in this project were invalidated because the
  running server predated the fix.
- **The user's messages are not in sync with what they saw.** A prompt sent
  while Claude works is only read at the next turn boundary, so "it was idle"
  and "it is running now" can both be true. Do not resolve the discrepancy by
  reading current state.
- **Measure across the turn boundary.** The gap between the user's prompt and
  Claude's first event cannot be observed from inside the turn. A background
  sampler that outlives the turn is the only way — that is what finally found
  trap 3 after three wrong diagnoses.
- **Replay against real transcripts.** `interruptedByUser` was confirmed by
  scanning 40 real sessions: the 2 flagged were the 2 genuinely stopped.
- **Cross-check the surfaces.** Run the TUI, web, and extension resolution
  paths over the same live data and assert they agree, rather than checking one
  and assuming.
- **Cross-check the official aggregate without exposing content.** Classify
  PID-bearing rows separately from pidless managed background tasks, then
  explain every presentation difference using the anchor rule above. Do not
  paste names, paths, summaries, or transcript text into diagnostics or reports.

## Related documents

- `ARCHITECTURE.md` → "Shared Live State", "Live State Confidence" — the
  current design.
- `PROJECT_MEMORY.md` → dated decisions, including superseded ones. Read for
  _why_, not for current behaviour.
