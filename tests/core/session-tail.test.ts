import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  readSessionTailActivity,
  resolveActivityState,
} from '../../src/core/session/session-tail.js'
import type { SessionTailActivity } from '../../src/core/session/session-tail.js'

function toolUseEvent(toolName: string, toolId: string, timestamp: string): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp,
    message: { content: [{ type: 'tool_use', id: toolId, name: toolName, input: {} }] },
  })
}

function toolResultEvent(toolUseId: string, timestamp: string): string {
  return JSON.stringify({
    type: 'user',
    timestamp,
    message: { content: [{ type: 'tool_result', tool_use_id: toolUseId, content: 'ok' }] },
  })
}

function parallelToolUseEvent(
  tools: Array<{ id: string; name: string }>,
  timestamp: string
): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp,
    message: {
      content: tools.map((tool) => ({
        type: 'tool_use',
        id: tool.id,
        name: tool.name,
        input: {},
      })),
    },
  })
}

function assistantEvent(blocks: unknown[], timestamp: string, stopReason?: string): string {
  return JSON.stringify({
    message: {
      content: blocks,
      ...(stopReason === undefined ? {} : { stop_reason: stopReason }),
    },
    timestamp,
    type: 'assistant',
  })
}

function userTextEvent(text: string, timestamp: string): string {
  return JSON.stringify({
    message: { content: [{ text, type: 'text' }] },
    timestamp,
    type: 'user',
  })
}

function isoAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString()
}

describe('readSessionTailActivity', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'reup-tail-test-'))
  })

  afterEach(async () => {
    await rm(tmpDir, { force: true, recursive: true })
  })

  it('returns null when the file does not exist', async () => {
    const result = await readSessionTailActivity(join(tmpDir, 'nonexistent.jsonl'))
    expect(result).toBeNull()
  })

  it('returns idle state with no tool data for an empty file', async () => {
    const path = join(tmpDir, 'empty.jsonl')
    await writeFile(path, '')
    const result = await readSessionTailActivity(path)
    expect(result).not.toBeNull()
    expect(result!.lastToolName).toBeNull()
    expect(result!.lastEventAt).toBeNull()
    expect(result!.state).toBe('idle')
  })

  it('extracts the tool name from the last tool_use event', async () => {
    const path = join(tmpDir, 'tool.jsonl')
    await writeFile(
      path,
      [toolUseEvent('Bash', 'id-1', isoAgo(60_000)), toolResultEvent('id-1', isoAgo(55_000))].join(
        '\n'
      )
    )
    const result = await readSessionTailActivity(path)
    expect(result!.lastToolName).toBe('Bash')
  })

  it('reports running state when the last tool_use has no matching result', async () => {
    const path = join(tmpDir, 'running.jsonl')
    await writeFile(path, toolUseEvent('Edit', 'id-pending', isoAgo(5_000)))
    const result = await readSessionTailActivity(path)
    expect(result!.lastToolName).toBe('Edit')
    expect(result!.toolPending).toBe(true)
    expect(result!.state).toBe('running')
  })

  it('reports waiting state when the tool resolved within the last 30 seconds', async () => {
    const path = join(tmpDir, 'waiting.jsonl')
    await writeFile(
      path,
      [toolUseEvent('Read', 'id-2', isoAgo(20_000)), toolResultEvent('id-2', isoAgo(15_000))].join(
        '\n'
      )
    )
    const result = await readSessionTailActivity(path)
    expect(result!.toolPending).toBe(false)
    expect(result!.state).toBe('waiting')
  })

  it('reports running while the transcript is being written, even with no tool pending', async () => {
    const path = join(tmpDir, 'generating.jsonl')
    // Claude flushes events continuously while generating; a fresh event is
    // proof of work even when the last tool already resolved and the lock
    // carries no status field.
    await writeFile(
      path,
      [
        toolUseEvent('Bash', 'id-gen', isoAgo(6_000)),
        toolResultEvent('id-gen', isoAgo(3_000)),
      ].join('\n')
    )
    const result = await readSessionTailActivity(path)
    expect(result!.toolPending).toBe(false)
    expect(result!.state).toBe('running')
  })

  /**
   * Measured on a real 6.4 MB transcript: single assistant and user events run
   * 1.5–5 KB, so a 12 KB window held three of them and discarded the first as a
   * partial line. Whether the turn-boundary event survived then depended on
   * where the byte boundary fell, and live state flipped between runs with
   * nothing in the data to explain it.
   */
  it('keeps the turn boundary in view when events are kilobytes each', async () => {
    const path = join(tmpDir, 'large-events.jsonl')
    const filler = 'x'.repeat(5_000)
    await writeFile(
      path,
      [
        ...Array.from({ length: 12 }, (_, index) =>
          assistantEvent([{ text: `${filler}${index}`, type: 'text' }], isoAgo(120_000), 'tool_use')
        ),
        // The event that carries the signal, last and easily pushed out.
        JSON.stringify({
          message: { content: [{ text: 'carry on', type: 'text' }] },
          timestamp: isoAgo(60_000),
          type: 'user',
        }),
      ].join('\n')
    )

    const result = await readSessionTailActivity(path)

    expect(result!.turnInFlight).toBe(true)
    expect(result!.lastEventAt).not.toBeNull()
  })

  describe('turn in flight', () => {
    it('is set while a tool result leaves Claude with work to do', async () => {
      const path = join(tmpDir, 'in-flight.jsonl')
      await writeFile(
        path,
        [
          toolUseEvent('Bash', 'id-t', isoAgo(90_000)),
          toolResultEvent('id-t', isoAgo(60_000)),
        ].join('\n')
      )

      const result = await readSessionTailActivity(path)

      expect(result!.turnInFlight).toBe(true)
      // The age-derived state is unchanged; only resolveActivityState uses the
      // new signal, and only when no source reports turn boundaries.
      expect(result!.state).toBe('idle')
    })

    /**
     * Claude Code splits one assistant turn across several events — thinking,
     * then text, then tool_use — so an intermediate text event looks exactly
     * like the last word of a finished turn. Observed live: the dot dropped to
     * idle during a ten-second gap between a text event and the tool_use that
     * followed it. `stop_reason` is the API's own answer and is recorded on
     * every assistant message.
     */
    it('stays set through an intermediate text event that is not the end of the turn', async () => {
      const path = join(tmpDir, 'mid-turn-text.jsonl')
      await writeFile(
        path,
        [
          toolResultEvent('id-t', isoAgo(40_000)),
          assistantEvent([{ text: 'Now let me check…', type: 'text' }], isoAgo(20_000), 'tool_use'),
        ].join('\n')
      )

      expect((await readSessionTailActivity(path))!.turnInFlight).toBe(true)
    })

    it('stays set while Claude is thinking', async () => {
      const path = join(tmpDir, 'mid-turn-thinking.jsonl')
      await writeFile(
        path,
        assistantEvent([{ thinking: '…', type: 'thinking' }], isoAgo(20_000), 'tool_use')
      )

      expect((await readSessionTailActivity(path))!.turnInFlight).toBe(true)
    })

    it('clears on the assistant event that actually ended the turn', async () => {
      const path = join(tmpDir, 'end-turn.jsonl')
      await writeFile(
        path,
        assistantEvent([{ text: 'All done.', type: 'text' }], isoAgo(20_000), 'end_turn')
      )

      expect((await readSessionTailActivity(path))!.turnInFlight).toBe(false)
    })

    /**
     * Reported from real use: a session showed a pulsing "running" dot with an
     * "interrupted" badge while nothing was running. Claude Code fires no Stop
     * hook when a turn is interrupted, so the last reported work state stays
     * `busy` with nothing to ever retract it — confirmed in the capture log by
     * two consecutive UserPromptSubmit events with no Stop between them.
     *
     * The recorded marker is the retraction, and it is the only tail signal
     * allowed to overrule a busy flag: ordinary quietness must not, because a
     * long tool call looks exactly the same.
     */
    it('records a user interruption as the last word, overruling a stale busy flag', async () => {
      const path = join(tmpDir, 'interrupted.jsonl')
      await writeFile(
        path,
        [
          assistantEvent(
            [{ id: 'id-t', name: 'Bash', type: 'tool_use' }],
            isoAgo(40_000),
            'tool_use'
          ),
          userTextEvent('[Request interrupted by user]', isoAgo(20_000)),
        ].join('\n')
      )

      const result = await readSessionTailActivity(path)
      expect(result!.turnEndedByRecord).toBe('user-interruption')
      expect(result!.turnInFlight).toBe(false)
      expect(resolveActivityState('busy', result, Date.now())).not.toBe('running')
    })

    it('lets Claude resuming after a stop clear the interruption', async () => {
      const path = join(tmpDir, 'resumed.jsonl')
      await writeFile(
        path,
        [
          userTextEvent('[Request interrupted by user]', isoAgo(40_000)),
          assistantEvent(
            [{ id: 'id-u', name: 'Read', type: 'tool_use' }],
            isoAgo(5_000),
            'tool_use'
          ),
        ].join('\n')
      )

      const result = await readSessionTailActivity(path)
      expect(result!.turnEndedByRecord).toBeNull()
      expect(resolveActivityState('busy', result, Date.now())).toBe('running')
    })

    it('lets a new prompt after a stop clear the interruption', async () => {
      const path = join(tmpDir, 'reprompted.jsonl')
      await writeFile(
        path,
        [
          userTextEvent('[Request interrupted by user]', isoAgo(40_000)),
          userTextEvent('actually, do this instead', isoAgo(5_000)),
        ].join('\n')
      )

      expect((await readSessionTailActivity(path))!.turnEndedByRecord).toBeNull()
    })

    /**
     * Reported from real use: Claude stopped on "You've hit your monthly spend
     * limit" and the session kept showing a pulsing "running" dot. Claude Code
     * records the failure as an assistant event carrying `apiErrorStatus`, and
     * gives it a stop_reason of `stop_sequence` -- not `end_turn` -- so reading
     * stop_reason alone reported the turn as still in flight. No Stop hook
     * fires for a failed turn either, so the reported state stays `busy` with
     * nothing to ever retract it.
     */
    it('treats a recorded API failure as the end of the turn', async () => {
      const path = join(tmpDir, 'api-error.jsonl')
      await writeFile(
        path,
        [
          toolUseEvent('Bash', 'id-e', isoAgo(60_000)),
          JSON.stringify({
            apiErrorStatus: 429,
            isApiErrorMessage: true,
            message: {
              content: [{ text: "You've hit your monthly spend limit", type: 'text' }],
              stop_reason: 'stop_sequence',
            },
            timestamp: isoAgo(1_000),
            type: 'assistant',
          }),
        ].join('\n')
      )

      const result = await readSessionTailActivity(path)

      expect(result!.turnEndedByRecord).toBe('api-error')
      expect(result!.turnInFlight).toBe(false)
      // Fresh recording, so the age-derived reading still says running; the
      // record outranks it, and outranks an unretracted busy flag too.
      expect(resolveActivityState('busy', result, Date.now())).not.toBe('running')
    })

    it('lets a retry after an API failure read as running again', async () => {
      const path = join(tmpDir, 'api-error-retry.jsonl')
      await writeFile(
        path,
        [
          JSON.stringify({
            apiErrorStatus: 429,
            isApiErrorMessage: true,
            message: { content: [{ text: 'limit', type: 'text' }], stop_reason: 'stop_sequence' },
            timestamp: isoAgo(60_000),
            type: 'assistant',
          }),
          toolUseEvent('Read', 'id-r', isoAgo(2_000)),
        ].join('\n')
      )

      const result = await readSessionTailActivity(path)

      expect(result!.turnEndedByRecord).toBeNull()
      expect(resolveActivityState('busy', result, Date.now())).toBe('running')
    })

    it('falls back to block shape when stop_reason is absent', async () => {
      // Transcripts from Claude Code versions predating the field must keep
      // their old reading rather than reporting every turn as unfinished.
      const path = join(tmpDir, 'no-stop-reason.jsonl')
      await writeFile(path, assistantEvent([{ text: 'All done.', type: 'text' }], isoAgo(20_000)))

      expect((await readSessionTailActivity(path))!.turnInFlight).toBe(false)
    })

    it('is clear once Claude answers without calling a tool', async () => {
      const path = join(tmpDir, 'turn-done.jsonl')
      await writeFile(
        path,
        [
          toolUseEvent('Bash', 'id-t', isoAgo(90_000)),
          toolResultEvent('id-t', isoAgo(60_000)),
          JSON.stringify({
            message: { content: [{ text: 'done.', type: 'text' }] },
            timestamp: isoAgo(30_000),
            type: 'assistant',
          }),
        ].join('\n')
      )

      expect((await readSessionTailActivity(path))!.turnInFlight).toBe(false)
    })

    it('is clear once the user stops the turn', async () => {
      const path = join(tmpDir, 'turn-stopped.jsonl')
      await writeFile(
        path,
        [
          toolUseEvent('Bash', 'id-t', isoAgo(60_000)),
          JSON.stringify({
            message: { content: [{ text: '[Request interrupted by user]', type: 'text' }] },
            timestamp: isoAgo(30_000),
            type: 'user',
          }),
        ].join('\n')
      )

      expect((await readSessionTailActivity(path))!.turnInFlight).toBe(false)
    })
  })

  it('reports idle state when the last event is older than 30 seconds', async () => {
    const path = join(tmpDir, 'idle.jsonl')
    await writeFile(
      path,
      [
        toolUseEvent('Bash', 'id-3', isoAgo(150_000)),
        toolResultEvent('id-3', isoAgo(120_000)),
      ].join('\n')
    )
    const result = await readSessionTailActivity(path)
    expect(result!.state).toBe('idle')
  })

  it('tracks the most recent tool name across multiple tool_use events', async () => {
    const path = join(tmpDir, 'multi-tool.jsonl')
    await writeFile(
      path,
      [
        toolUseEvent('Bash', 'id-a', isoAgo(120_000)),
        toolResultEvent('id-a', isoAgo(110_000)),
        toolUseEvent('Edit', 'id-b', isoAgo(60_000)),
        toolResultEvent('id-b', isoAgo(50_000)),
      ].join('\n')
    )
    const result = await readSessionTailActivity(path)
    expect(result!.lastToolName).toBe('Edit')
    expect(result!.toolPending).toBe(false)
  })

  it('keeps running state when an earlier parallel tool_use is still unresolved', async () => {
    const path = join(tmpDir, 'parallel-first-pending.jsonl')
    await writeFile(
      path,
      [
        parallelToolUseEvent(
          [
            { id: 'pending-first', name: 'Bash' },
            { id: 'resolved-second', name: 'Read' },
          ],
          isoAgo(5_000)
        ),
        toolResultEvent('resolved-second', isoAgo(4_000)),
      ].join('\n')
    )
    const result = await readSessionTailActivity(path)
    expect(result!.lastToolName).toBe('Bash')
    expect(result!.toolPending).toBe(true)
    expect(result!.state).toBe('running')
  })

  it('shows the latest unresolved parallel tool when more than one is pending', async () => {
    const path = join(tmpDir, 'parallel-latest-pending.jsonl')
    await writeFile(
      path,
      parallelToolUseEvent(
        [
          { id: 'pending-first', name: 'Bash' },
          { id: 'pending-second', name: 'Edit' },
        ],
        isoAgo(5_000)
      )
    )
    const result = await readSessionTailActivity(path)
    expect(result!.lastToolName).toBe('Edit')
    expect(result!.toolPending).toBe(true)
    expect(result!.state).toBe('running')
  })

  it('clears pending tool state when the user interrupts with a text message', async () => {
    const path = join(tmpDir, 'interrupted.jsonl')
    const interruptEvent = JSON.stringify({
      type: 'user',
      timestamp: isoAgo(15_000),
      message: { content: [{ type: 'text', text: '[Request interrupted by user]' }] },
    })
    await writeFile(
      path,
      [toolUseEvent('Bash', 'id-orphaned', isoAgo(20_000)), interruptEvent].join('\n')
    )
    const result = await readSessionTailActivity(path)
    expect(result!.toolPending).toBe(false)
    expect(result!.state).toBe('waiting')
  })

  it('clears pending tool state when a new user prompt arrives as a plain string', async () => {
    const path = join(tmpDir, 'new-prompt.jsonl')
    const promptEvent = JSON.stringify({
      type: 'user',
      timestamp: isoAgo(15_000),
      message: { content: 'please continue' },
    })
    await writeFile(
      path,
      [toolUseEvent('Edit', 'id-orphaned', isoAgo(20_000)), promptEvent].join('\n')
    )
    const result = await readSessionTailActivity(path)
    expect(result!.toolPending).toBe(false)
    expect(result!.state).toBe('waiting')
  })

  it('keeps running state when the user turn contains only tool results for other tools', async () => {
    const path = join(tmpDir, 'partial-results.jsonl')
    await writeFile(
      path,
      [
        parallelToolUseEvent(
          [
            { id: 'still-pending', name: 'Bash' },
            { id: 'resolved', name: 'Read' },
          ],
          isoAgo(5_000)
        ),
        toolResultEvent('resolved', isoAgo(4_000)),
      ].join('\n')
    )
    const result = await readSessionTailActivity(path)
    expect(result!.toolPending).toBe(true)
    expect(result!.state).toBe('running')
  })

  it('returns the ISO timestamp of the most recent event', async () => {
    const path = join(tmpDir, 'ts.jsonl')
    const ts = isoAgo(8_000)
    await writeFile(path, toolUseEvent('Bash', 'id-ts', ts))
    const result = await readSessionTailActivity(path)
    expect(result!.lastEventAt).toBe(ts)
  })

  it('handles files where the first line may be partial due to tail-reading', async () => {
    const path = join(tmpDir, 'large.jsonl')
    const paddingLine = JSON.stringify({ type: 'system', note: 'x'.repeat(200) })
    const toolLine = toolUseEvent('WebSearch', 'id-ws', isoAgo(5_000))
    await writeFile(path, [paddingLine, toolLine].join('\n'))
    const result = await readSessionTailActivity(path)
    expect(result!.lastToolName).toBe('WebSearch')
  })

  it('falls back to file modification time when one giant event fills the tail window', async () => {
    const path = join(tmpDir, 'giant-line.jsonl')
    // A single event bigger than the tail window leaves no parseable line;
    // the fresh mtime must still classify the session as waiting, not idle.
    const giantEvent = JSON.stringify({
      type: 'assistant',
      timestamp: isoAgo(2_000),
      message: { content: [{ type: 'text', text: 'y'.repeat(20_000) }] },
    })
    await writeFile(path, giantEvent)
    const result = await readSessionTailActivity(path)
    expect(result!.lastEventAt).not.toBeNull()
    expect(result!.state).toBe('running')
  })
})

describe('resolveActivityState', () => {
  const NOW = Date.parse('2026-07-01T12:00:00.000Z')
  const tail = (
    state: SessionTailActivity['state'],
    lastEventAt: string | null = null
  ): SessionTailActivity => ({
    lastToolName: 'Bash',
    toolPending: state === 'running',
    trailingQuestion: false,
    turnInFlight: false,
    lastEventAt,
    state,
  })

  const midTurn = (secondsAgo: number): SessionTailActivity => ({
    ...tail('idle', new Date(NOW - secondsAgo * 1_000).toISOString()),
    // The shape left by a completed tool call while Claude decides what to do
    // next: nothing pending, but the turn has not ended.
    toolPending: false,
    turnInFlight: true,
  })

  it('trusts a corroborated busy lock over a quiet transcript', () => {
    expect(resolveActivityState('busy', tail('idle'), NOW - 1_000, NOW)).toBe('running')
    expect(resolveActivityState('busy', null, NOW - 1_000, NOW)).toBe('running')
    // Fresh transcript activity corroborates busy even with an old transition.
    expect(
      resolveActivityState(
        'busy',
        tail('waiting', new Date(NOW - 2_000).toISOString()),
        NOW - 60 * 60_000,
        NOW
      )
    ).toBe('running')
  })

  it('demotes a zombie busy flag to transcript-derived state', () => {
    const staleTransition = NOW - 60 * 60_000
    // Interrupted session left busy behind: transcript says idle → idle.
    expect(resolveActivityState('busy', tail('idle'), staleTransition, NOW)).toBe('idle')
    expect(resolveActivityState('busy', null, staleTransition, NOW)).toBe('idle')
    // A genuinely long-running tool still shows via its pending tool_use.
    expect(resolveActivityState('busy', tail('running'), staleTransition, NOW)).toBe('running')
  })

  it('never reports running for a lock that says idle', () => {
    expect(resolveActivityState('idle', tail('running'), null, NOW)).toBe('waiting')
    expect(resolveActivityState('idle', tail('waiting'), null, NOW)).toBe('waiting')
    expect(resolveActivityState('idle', tail('idle'), null, NOW)).toBe('idle')
  })

  it('falls back to transcript state for locks without status support', () => {
    expect(resolveActivityState(null, tail('running'), null, NOW)).toBe('running')
    expect(resolveActivityState(null, tail('waiting'), null, NOW)).toBe('waiting')
    expect(resolveActivityState(null, null, null, NOW)).toBe('idle')
  })

  /**
   * Reported from use: a VS Code session read as idle while Claude was plainly
   * working. Those locks omit `status` and no hook marker existed, so the only
   * signal left was transcript age — and the gap between a tool finishing and
   * the next one starting routinely exceeds it. The transcript's own shape
   * settles it: the turn had not ended.
   */
  it('keeps a turn in flight running through a thinking gap when nothing reports boundaries', () => {
    expect(resolveActivityState(null, midTurn(15), null, NOW)).toBe('running')
    expect(resolveActivityState(null, midTurn(60), null, NOW)).toBe('running')
    expect(resolveActivityState(null, midTurn(4 * 60), null, NOW)).toBe('running')
  })

  it('still lets a session that died mid-turn settle', () => {
    // Bounded by the same window that limits trust in a busy flag, so an
    // abandoned turn cannot read as running forever.
    expect(resolveActivityState(null, midTurn(10 * 60), null, NOW)).toBe('idle')
  })

  it('never lets an in-flight turn override a source that reports boundaries', () => {
    // A lock or hook marker saying the turn ended is authoritative; the
    // transcript shape is the fallback for sessions that have neither.
    expect(resolveActivityState('idle', midTurn(15), NOW - 1_000, NOW)).toBe('idle')
    expect(resolveActivityState('busy', midTurn(15), NOW - 1_000, NOW)).toBe('running')
  })
})
