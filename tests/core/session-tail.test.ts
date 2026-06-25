import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { readSessionTailActivity } from '../../src/core/session/session-tail.js'

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

function isoAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString()
}

describe('readSessionTailActivity', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'swoop-tail-test-'))
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
      [toolUseEvent('Read', 'id-2', isoAgo(15_000)), toolResultEvent('id-2', isoAgo(10_000))].join(
        '\n'
      )
    )
    const result = await readSessionTailActivity(path)
    expect(result!.toolPending).toBe(false)
    expect(result!.state).toBe('waiting')
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
})
