import { open } from 'node:fs/promises'

/** Maximum bytes read from the end of a transcript to find recent tool activity. */
const TAIL_BYTES = 12_000

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
    await fd.read(buffer, 0, readSize, fileSize - readSize)
    const text = buffer.toString('utf8')

    return parseTailActivity(text)
  } catch {
    return null
  } finally {
    await fd?.close().catch(() => undefined)
  }
}

function parseTailActivity(text: string): SessionTailActivity {
  // Split on newlines; the first line may be a partial line if we didn't read
  // from the start — skip it.
  const rawLines = text.split('\n')
  const lines = rawLines.length > 1 ? rawLines.slice(1) : rawLines

  let lastToolName: string | null = null
  let lastToolUseId: string | null = null
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
        if (id) lastToolUseId = id
      }
      continue
    }

    if (event['type'] === 'user') {
      const content = (event['message'] as Record<string, unknown> | undefined)?.['content']
      if (!Array.isArray(content)) continue
      for (const block of content as Record<string, unknown>[]) {
        if (block['type'] !== 'tool_result') continue
        const id = typeof block['tool_use_id'] === 'string' ? block['tool_use_id'] : null
        if (id) resolvedToolIds.add(id)
      }
    }
  }

  const toolPending = lastToolUseId !== null && !resolvedToolIds.has(lastToolUseId)

  let state: ActivityState
  if (toolPending) {
    state = 'running'
  } else if (lastEventAt) {
    const ageMs = Date.now() - new Date(lastEventAt).getTime()
    state = ageMs < 30_000 ? 'waiting' : 'idle'
  } else {
    state = 'idle'
  }

  return { lastToolName, toolPending, lastEventAt, state }
}
