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
  lastToolFailed: boolean
}

// -----------------------------------------------------------------------------
// Display status
// -----------------------------------------------------------------------------

/** Returns days remaining in Claude Code's default 30-day cleanup window. */
export function calculateExpiryDays(updatedAt: string): number {
  const ageMs = Date.now() - new Date(updatedAt).getTime()
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
  if (signals.interrupted === true || signals.lastToolFailed === true) return 'interrupted'
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
        continue
      }

      const contentBlocks = messageContent as Record<string, unknown>[]
      const containsOnlyToolResults =
        contentBlocks.length > 0 && contentBlocks.every((block) => block['type'] === 'tool_result')

      if (!containsOnlyToolResults) {
        pendingToolUseIds.clear()
        lastToolFailed = false
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
    lastToolFailed,
  }
}
