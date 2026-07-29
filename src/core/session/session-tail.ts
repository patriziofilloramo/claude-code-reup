import { open } from 'node:fs/promises'

import { isBusyEvidenceFresh } from './active-sessions.js'
import type { SessionWorkState } from './active-sessions.js'
import { isUserInterruptionTurn } from './session-signals.js'

/**
 * Bytes read from the end of a transcript on the first attempt.
 *
 * Sized against real events rather than a round number: a single assistant or
 * user event routinely runs 1.5–5 KB, so a smaller window holds only two or
 * three of them — and the first is always discarded as a partial line. The
 * turn-boundary signal then depends on where the byte boundary happens to
 * fall, which made live state flip between runs for no reason visible in the
 * data.
 */
const TAIL_BYTES = 64_000
/**
 * Ceiling for the widened re-read. A tool result carrying a large file can
 * exceed any fixed window on its own, so the read grows until it finds
 * conversational events — but never scans an entire multi-megabyte transcript.
 */
const MAX_TAIL_BYTES = 512_000
/** Conversational events the window should contain before its reading is trusted. */
const MIN_TAIL_EVENTS = 3
/**
 * A transcript written within this window (ms) is proof of work in itself:
 * Claude Code flushes events continuously while generating, so a very fresh
 * event means the session is running even with no tool pending and no lock
 * status (lock files do not always carry the status field).
 *
 * Deliberately not exported: a surface applying this window itself is what
 * made the TUI call a session busy that the web already called idle. Surfaces
 * ask resolveSessionLiveState, which reads it here once.
 */
const TRANSCRIPT_RUNNING_WINDOW_MS = 10_000
/** An event within this window (ms) marks a session as waiting rather than idle. */
const WAITING_WINDOW_MS = 30_000

export type ActivityState = 'running' | 'waiting' | 'idle'

export interface SessionTailActivity {
  /** Most recent tool name seen in the tail (e.g. "Bash", "Edit", "Read"). */
  lastToolName: string | null
  /**
   * Whether the last tool_use has a matching tool_result in the tail.
   * true → Claude is still waiting for the tool to complete (running).
   * false → tool completed (waiting or idle).
   */
  toolPending: boolean
  /**
   * True when the tail's last conversational event is a text-only assistant
   * message ending in a question mark — Claude asked something in plain prose
   * with no tool call or UI prompt to detect it by. Cleared by any later user
   * turn or assistant tool activity.
   */
  trailingQuestion: boolean
  /**
   * Whether the last conversational event leaves Claude with work to do.
   *
   * A turn ends exactly when Claude emits an assistant message carrying no
   * tool call — the API's own stop condition — or when the user stops it. A
   * tool call, a tool result, or a fresh prompt all mean the turn is still
   * running, however long the clock says the transcript has been quiet.
   */
  turnInFlight: boolean
  /** ISO timestamp of the most recent assistant or user event in the tail. */
  lastEventAt: string | null
  /** Inferred activity state derived from tool and timestamp data. */
  state: ActivityState
}

/**
 * Reads the tail of a JSONL transcript and returns the most recent tool
 * activity.
 *
 * The window widens until it holds enough conversational events to read a turn
 * boundary from, because a fixed byte count says nothing about how many events
 * it contains: real events run from a few hundred bytes to several kilobytes,
 * so the same window can hold a dozen or barely one. Widening is bounded and
 * rare — the first read covers the ordinary case.
 *
 * Returns null when the file cannot be read.
 */
export async function readSessionTailActivity(
  transcriptPath: string
): Promise<SessionTailActivity | null> {
  let fd: Awaited<ReturnType<typeof open>> | null = null
  try {
    fd = await open(transcriptPath, 'r')
    const stat = await fd.stat()
    const fileSize = stat.size

    let activity = await readTailWindow(fd, fileSize, TAIL_BYTES)
    for (
      let windowSize = TAIL_BYTES * 4;
      activity.conversationalEvents < MIN_TAIL_EVENTS &&
      windowSize <= MAX_TAIL_BYTES &&
      windowSize < fileSize;
      windowSize *= 4
    ) {
      activity = await readTailWindow(fd, fileSize, windowSize)
    }

    if (activity.lastEventAt === null && fileSize > 0) {
      // A single event larger than the tail window leaves no parseable line,
      // which must not read as a dead session: the file's own modification
      // time still proves how recently the transcript was appended.
      return applyLastEventFallback(activity, stat.mtime.toISOString())
    }
    return activity
  } catch {
    return null
  } finally {
    await fd?.close().catch(() => undefined)
  }
}

/** A window's reading, plus what it took to get it — used to decide on widening. */
interface TailWindowReading extends SessionTailActivity {
  /** Assistant and user events found; other record types carry no turn signal. */
  conversationalEvents: number
}

async function readTailWindow(
  fd: Awaited<ReturnType<typeof open>>,
  fileSize: number,
  windowSize: number
): Promise<TailWindowReading> {
  const readSize = Math.min(fileSize, windowSize)
  const buffer = Buffer.allocUnsafe(readSize)
  // A short read must not expose the uninitialized remainder of the buffer,
  // so only the bytes actually read are decoded.
  const { bytesRead } = await fd.read(buffer, 0, readSize, fileSize - readSize)
  const text = buffer.subarray(0, bytesRead).toString('utf8')

  // When the file is larger than the window we started mid-stream, so the
  // first line is probably truncated and must be dropped.
  return parseTailActivity(text, fileSize > readSize)
}

/**
 * Combines Claude Code's own lock-file activity flag with transcript-derived
 * state. A corroborated busy lock wins: transcript appends can pause well
 * beyond any freshness threshold while a long tool call or response is in
 * flight, so tail data alone misreads busy sessions as idle. But the lock is
 * only rewritten on transitions, so a session that died or was interrupted
 * mid-turn leaves `busy` behind forever — a stale flag falls back to the
 * transcript, which still reports genuinely running tools via pending
 * tool_use blocks. Tail state is also the only signal for Claude Code
 * versions without lock status.
 */
export function resolveActivityState(
  lockStatus: SessionWorkState | null,
  tail: SessionTailActivity | null,
  statusUpdatedAt: number | null = null,
  now = Date.now()
): ActivityState {
  const tailState = tail?.state ?? 'idle'
  if (lockStatus === 'busy') {
    const lastTranscriptMs = tail?.lastEventAt ? Date.parse(tail.lastEventAt) : null
    if (isBusyEvidenceFresh(statusUpdatedAt, lastTranscriptMs, now)) return 'running'
    return tailState
  }
  if (lockStatus === 'idle') return tailState === 'running' ? 'waiting' : tailState

  // Nothing reports turn boundaries for this session — VS Code peer locks omit
  // `status`, and no hook marker exists. Here the transcript's own shape beats
  // the clock: a turn still in flight is running however long Claude has been
  // thinking between two tool calls, which is where the age fallback used to
  // report a finished turn and make an active session read as idle. Bounded by
  // the same window that limits trust in a busy flag, so a session that died
  // mid-turn still settles instead of reading as running forever.
  if (tail?.turnInFlight && isBusyEvidenceFresh(null, lastEventMs(tail), now)) return 'running'
  return tailState
}

function lastEventMs(tail: SessionTailActivity): number | null {
  const parsed = tail.lastEventAt ? Date.parse(tail.lastEventAt) : Number.NaN
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Tools that block on the user by design. A pending call to one of these
 * means Claude is waiting for a reply even while the lock still reads busy,
 * because the turn keeps running until the user answers.
 */
const USER_REPLY_TOOL_NAMES = new Set(['AskUserQuestion', 'ExitPlanMode'])

/**
 * True when a live session is blocked on the user with no Notification hook
 * to say so. Three shapes qualify: the turn ended (`idle` evidence) while the
 * transcript tail still holds an unanswered tool call; the pending call is to
 * a tool that exists to ask the user something (`AskUserQuestion`,
 * `ExitPlanMode`), which keeps the lock busy for as long as the user is
 * silent; or the turn ended on a text-only question with no tool at all. The
 * tail parser clears pending tool uses and trailing questions on any later
 * user turn, so a hit here is genuinely unanswered — not merely a turn
 * resting between prompts.
 */
export function isAwaitingUserReply(
  workStatus: SessionWorkState | null,
  tail: SessionTailActivity | null
): boolean {
  if (!tail || tail.lastEventAt === null) return false
  if (tail.toolPending) {
    if (workStatus === 'idle') return true
    return tail.lastToolName !== null && USER_REPLY_TOOL_NAMES.has(tail.lastToolName)
  }
  return workStatus === 'idle' && tail.trailingQuestion
}

function applyLastEventFallback(
  activity: SessionTailActivity,
  lastEventAt: string
): SessionTailActivity {
  if (activity.state === 'running') return { ...activity, lastEventAt }
  return { ...activity, lastEventAt, state: stateFromLastEventAge(lastEventAt) }
}

function stateFromLastEventAge(lastEventAt: string, now = Date.now()): ActivityState {
  const ageMs = now - new Date(lastEventAt).getTime()
  if (ageMs < TRANSCRIPT_RUNNING_WINDOW_MS) return 'running'
  return ageMs < WAITING_WINDOW_MS ? 'waiting' : 'idle'
}

function parseTailActivity(text: string, isPartialRead: boolean): TailWindowReading {
  // Only skip the first line when we started mid-file; reading from offset 0
  // gives a complete first line that must be kept.
  const rawLines = text.split('\n')
  const lines = isPartialRead && rawLines.length > 1 ? rawLines.slice(1) : rawLines

  let lastToolName: string | null = null
  const toolUses: Array<{ id: string; name: string | null }> = []
  const resolvedToolIds = new Set<string>()
  let lastEventAt: string | null = null
  let trailingQuestion = false
  let turnInFlight = false
  let conversationalEvents = 0

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    let event: Record<string, unknown>
    try {
      event = JSON.parse(trimmed)
    } catch {
      continue
    }

    const timestamp = typeof event['timestamp'] === 'string' ? event['timestamp'] : null
    if (timestamp) lastEventAt = timestamp

    if (event['type'] === 'assistant') {
      conversationalEvents++
      const message = event['message'] as Record<string, unknown> | undefined
      const content = message?.['content']
      if (!Array.isArray(content)) continue
      const blocks = content as Record<string, unknown>[]
      const toolUseBlocks = blocks.filter((block) => block['type'] === 'tool_use')
      // A text-only assistant message ending in "?" is a question asked in
      // prose; any tool activity instead means Claude kept working.
      trailingQuestion = toolUseBlocks.length === 0 && endsWithQuestion(blocks)
      turnInFlight = !isFinalAssistantEvent(message, toolUseBlocks.length)
      for (const block of toolUseBlocks) {
        const name = typeof block['name'] === 'string' ? block['name'] : null
        const id = typeof block['id'] === 'string' ? block['id'] : null
        if (name) lastToolName = name
        if (id) toolUses.push({ id, name })
      }
      continue
    }

    if (event['type'] === 'user') {
      conversationalEvents++
      // Any user turn answers a trailing question, whatever its shape.
      trailingQuestion = false
      // A prompt or a tool result both leave Claude with work to do next.
      turnInFlight = true
      const content = (event['message'] as Record<string, unknown> | undefined)?.['content']
      // A user turn that is not purely tool results (an interrupt marker or a
      // new prompt) means no tool is running any more — pending tool uses must
      // not keep reporting "running". Mirrors computeSignalsFromLines.
      if (!Array.isArray(content)) {
        toolUses.length = 0
        continue
      }
      const blocks = content as Record<string, unknown>[]
      // A stop marker ends the turn as surely as a final assistant message:
      // the user cut it short, so nothing is running afterwards.
      if (isUserInterruptionTurn(blocks)) turnInFlight = false
      const containsOnlyToolResults =
        blocks.length > 0 && blocks.every((block) => block['type'] === 'tool_result')
      if (!containsOnlyToolResults) {
        toolUses.length = 0
        continue
      }
      for (const block of blocks) {
        const id = typeof block['tool_use_id'] === 'string' ? block['tool_use_id'] : null
        if (id) resolvedToolIds.add(id)
      }
    }
  }

  const pendingTool = toolUses
    .slice()
    .reverse()
    .find((toolUse) => !resolvedToolIds.has(toolUse.id))
  const toolPending = pendingTool !== undefined
  if (pendingTool?.name) lastToolName = pendingTool.name

  let state: ActivityState
  if (toolPending) {
    state = 'running'
  } else if (lastEventAt) {
    state = stateFromLastEventAge(lastEventAt)
  } else {
    state = 'idle'
  }

  return {
    conversationalEvents,
    lastToolName,
    toolPending,
    trailingQuestion,
    turnInFlight,
    lastEventAt,
    state,
  }
}

/**
 * Whether an assistant event is the one that ended the turn.
 *
 * Claude Code splits a single assistant turn across several events — thinking,
 * text, then tool_use — so block types alone cannot tell an intermediate
 * message from a final one: a text event mid-turn looks exactly like the last
 * word of a finished one. It does record the API's own `stop_reason`, and
 * `end_turn` is the only value meaning Claude chose to stop; everything else
 * has more of the turn still to come.
 *
 * Falls back to the block shape when the field is absent, so transcripts from
 * Claude Code versions that predate it still degrade to the old reading rather
 * than reporting every turn as unfinished.
 */
function isFinalAssistantEvent(
  message: Record<string, unknown> | undefined,
  toolUseBlockCount: number
): boolean {
  const stopReason = message?.['stop_reason']
  if (typeof stopReason === 'string') return stopReason === 'end_turn'
  return toolUseBlockCount === 0
}

/** True when the last text block of an assistant message ends with a question mark. */
function endsWithQuestion(blocks: Record<string, unknown>[]): boolean {
  for (let index = blocks.length - 1; index >= 0; index--) {
    const block = blocks[index]!
    if (block['type'] !== 'text' || typeof block['text'] !== 'string') continue
    // Trailing markdown decoration or closing punctuation must not hide the
    // question mark (e.g. "…right?**" or "…ok?)").
    const stripped = block['text'].replace(/[\s*_`"')\]]+$/u, '')
    return stripped.endsWith('?')
  }
  return false
}
