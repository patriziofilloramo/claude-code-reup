import { open } from 'node:fs/promises'

import { isBusyEvidenceFresh } from './active-sessions.js'

/** Maximum bytes read from the end of a transcript to find recent tool activity. */
const TAIL_BYTES = 12_000
/**
 * A transcript written within this window (ms) is proof of work in itself:
 * Claude Code flushes events continuously while generating, so a very fresh
 * event means the session is running even with no tool pending and no lock
 * status (lock files do not always carry the status field).
 */
export const TRANSCRIPT_RUNNING_WINDOW_MS = 10_000
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
  /** ISO timestamp of the most recent assistant or user event in the tail. */
  lastEventAt: string | null
  /** Inferred activity state derived from tool and timestamp data. */
  state: ActivityState
}

/**
 * Reads the tail of a JSONL transcript and returns the most recent tool
 * activity. Reads at most TAIL_BYTES from the end to stay fast.
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

    const readSize = Math.min(fileSize, TAIL_BYTES)
    const buffer = Buffer.allocUnsafe(readSize)
    // A short read must not expose the uninitialized remainder of the buffer,
    // so only the bytes actually read are decoded.
    const { bytesRead } = await fd.read(buffer, 0, readSize, fileSize - readSize)
    const text = buffer.subarray(0, bytesRead).toString('utf8')

    // When the file is larger than the tail window we started mid-stream, so
    // the first line is probably truncated and must be dropped.
    const isPartialRead = fileSize > readSize
    const activity = parseTailActivity(text, isPartialRead)
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
  lockStatus: 'busy' | 'idle' | null,
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
  return tailState
}

/**
 * Tools that block on the user by design. A pending call to one of these
 * means Claude is waiting for a reply even while the lock still reads busy,
 * because the turn keeps running until the user answers.
 */
const USER_REPLY_TOOL_NAMES = new Set(['AskUserQuestion', 'ExitPlanMode'])

/**
 * True when a live session is blocked on the user with no Notification hook
 * to say so. Two shapes qualify: the turn ended (`idle` evidence) while the
 * transcript tail still holds an unanswered tool call, or the pending call is
 * to a tool that exists to ask the user something (`AskUserQuestion`,
 * `ExitPlanMode`), which keeps the lock busy for as long as the user is
 * silent. The tail parser clears pending tool uses on any later user prompt
 * or interrupt marker, so a pending call here is genuinely unanswered — not
 * merely a turn resting between prompts.
 */
export function isAwaitingUserReply(
  workStatus: 'busy' | 'idle' | null,
  tail: SessionTailActivity | null
): boolean {
  if (tail?.toolPending !== true || tail.lastEventAt === null) return false
  if (workStatus === 'idle') return true
  return tail.lastToolName !== null && USER_REPLY_TOOL_NAMES.has(tail.lastToolName)
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

function parseTailActivity(text: string, isPartialRead: boolean): SessionTailActivity {
  // Only skip the first line when we started mid-file; reading from offset 0
  // gives a complete first line that must be kept.
  const rawLines = text.split('\n')
  const lines = isPartialRead && rawLines.length > 1 ? rawLines.slice(1) : rawLines

  let lastToolName: string | null = null
  const toolUses: Array<{ id: string; name: string | null }> = []
  const resolvedToolIds = new Set<string>()
  let lastEventAt: string | null = null

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
      const content = (event['message'] as Record<string, unknown> | undefined)?.['content']
      if (!Array.isArray(content)) continue
      for (const block of content as Record<string, unknown>[]) {
        if (block['type'] !== 'tool_use') continue
        const name = typeof block['name'] === 'string' ? block['name'] : null
        const id = typeof block['id'] === 'string' ? block['id'] : null
        if (name) lastToolName = name
        if (id) toolUses.push({ id, name })
      }
      continue
    }

    if (event['type'] === 'user') {
      const content = (event['message'] as Record<string, unknown> | undefined)?.['content']
      // A user turn that is not purely tool results (an interrupt marker or a
      // new prompt) means no tool is running any more — pending tool uses must
      // not keep reporting "running". Mirrors computeSignalsFromLines.
      if (!Array.isArray(content)) {
        toolUses.length = 0
        continue
      }
      const blocks = content as Record<string, unknown>[]
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

  return { lastToolName, toolPending, lastEventAt, state }
}
