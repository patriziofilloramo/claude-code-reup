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
    lastEventAt,
    state,
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
})
