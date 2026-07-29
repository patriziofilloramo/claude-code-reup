import type { SessionSignals, SessionStatus } from './session-model.js'

/** Claude Code's default transcript auto-deletion window (30 days in ms). */
const CLAUDE_CLEANUP_WINDOW_MS = 30 * 24 * 60 * 60 * 1000
/** Sessions expiring within this many days are flagged with the "expiring" status. */
const EXPIRING_THRESHOLD_DAYS = 5
/** Sessions compacted this many times or more are flagged as "heavily-compacted". */
const HEAVY_COMPACTION_THRESHOLD = 3

export interface TranscriptSignals {
  compactionCount: number
  expiresInDays: number
  interrupted: boolean
  /**
   * The user stopped Claude mid-turn and has not given new instructions since.
   *
   * Distinct from `interrupted`, which is *inferred* from an unanswered tool
   * call. This one is *recorded*: Claude Code writes an explicit marker turn.
   * Surfaces treat the two differently — an inferred interruption is normal
   * mid-turn state for a live session, a recorded one is a fact about it.
   */
  interruptedByUser: boolean
  lastToolFailed: boolean
}

/**
 * Exactly the turns Claude Code writes when the user stops it.
 *
 * Matching is exact, and deliberately not a substring test: these same strings
 * appear inside compaction summaries that quote earlier turns, and in ordinary
 * messages that merely discuss interruptions. A substring test flags those
 * sessions as interrupted forever.
 */
const USER_INTERRUPTION_MARKERS = new Set([
  '[Request interrupted by user]',
  '[Request interrupted by user for tool use]',
])

// -----------------------------------------------------------------------------
// Display status
// -----------------------------------------------------------------------------

/** Returns days remaining in Claude Code's default 30-day cleanup window. */
export function calculateExpiryDays(updatedAt: string): number {
  const updatedMs = Date.parse(updatedAt)
  if (!Number.isFinite(updatedMs)) return 0

  const ageMs = Date.now() - updatedMs
  const remainingMs = CLAUDE_CLEANUP_WINDOW_MS - ageMs
  return Math.max(0, Math.round(remainingMs / (24 * 60 * 60 * 1000)))
}

// -----------------------------------------------------------------------------
// Transcript analysis
// -----------------------------------------------------------------------------

/** Derives the single status used for the session's primary display badge. */
export function primaryStatus(signals: SessionSignals): SessionStatus {
  if (!signals.pathExists) return 'path-missing'
  if (signals.expiresInDays !== null && signals.expiresInDays <= EXPIRING_THRESHOLD_DAYS) {
    return 'expiring'
  }
  if (
    signals.interrupted === true ||
    signals.interruptedByUser === true ||
    signals.lastToolFailed === true
  ) {
    return 'interrupted'
  }
  if (signals.compactionCount !== null && signals.compactionCount >= HEAVY_COMPACTION_THRESHOLD) {
    return 'heavily-compacted'
  }
  return 'ok'
}

/**
 * Derives transcript signals from JSONL lines.
 *
 * - `interrupted`: at least one tool-use ID has no matching tool result.
 * - `lastToolFailed`: the latest tool-result batch contains an error and no
 *   later human or pure-text assistant turn cleared the failure state.
 * - `compactionCount`: number of system `compact_boundary` events.
 *
 * Tool calls are tracked by ID so parallel calls are handled correctly.
 */
export function computeSignalsFromLines(lines: string[], updatedAt: string): TranscriptSignals {
  const pendingToolUseIds = new Set<string>()
  let compactionCount = 0
  let lastToolFailed = false
  let interruptedByUser = false

  for (const line of lines) {
    try {
      const event = JSON.parse(line) as Record<string, unknown>

      if (event['type'] === 'system' && event['subtype'] === 'compact_boundary') {
        compactionCount++
        continue
      }

      if (event['type'] === 'assistant') {
        const messageContent = (event['message'] as Record<string, unknown> | undefined)?.[
          'content'
        ]
        if (!Array.isArray(messageContent)) continue

        const contentBlocks = messageContent as Record<string, unknown>[]
        const toolUseBlocks = contentBlocks.filter((block) => block['type'] === 'tool_use')
        if (toolUseBlocks.length === 0) {
          lastToolFailed = false
          continue
        }

        for (const block of toolUseBlocks) {
          if (typeof block['id'] === 'string') pendingToolUseIds.add(block['id'])
        }
        continue
      }

      if (event['type'] !== 'user') continue

      const messageContent = (event['message'] as Record<string, unknown> | undefined)?.['content']
      if (!Array.isArray(messageContent)) {
        pendingToolUseIds.clear()
        lastToolFailed = false
        interruptedByUser = false
        continue
      }

      const contentBlocks = messageContent as Record<string, unknown>[]

      // Checked before the generic branch below, which would otherwise read the
      // marker as an ordinary prompt and erase the very evidence it carries.
      if (isUserInterruptionTurn(contentBlocks)) {
        // Calls left open by the stop were abandoned, not failed.
        pendingToolUseIds.clear()
        lastToolFailed = false
        interruptedByUser = true
        continue
      }

      const containsOnlyToolResults =
        contentBlocks.length > 0 && contentBlocks.every((block) => block['type'] === 'tool_result')

      if (!containsOnlyToolResults) {
        pendingToolUseIds.clear()
        lastToolFailed = false
        // Real instructions mean the user moved on from whatever they stopped.
        interruptedByUser = false
        continue
      }

      for (const block of contentBlocks) {
        if (typeof block['tool_use_id'] === 'string') {
          pendingToolUseIds.delete(block['tool_use_id'])
        }
      }
      lastToolFailed = contentBlocks.some((block) => block['is_error'] === true)
    } catch {
      // A malformed line should not hide otherwise readable session metadata.
    }
  }

  return {
    compactionCount,
    expiresInDays: calculateExpiryDays(updatedAt),
    interrupted: pendingToolUseIds.size > 0,
    interruptedByUser,
    lastToolFailed,
  }
}

/** True when a user turn is nothing but one of Claude Code's stop markers. */
export function isUserInterruptionTurn(contentBlocks: Record<string, unknown>[]): boolean {
  if (contentBlocks.length !== 1) return false
  const block = contentBlocks[0]
  if (block?.['type'] !== 'text' || typeof block['text'] !== 'string') return false
  return USER_INTERRUPTION_MARKERS.has(block['text'].trim())
}
