import { describe, expect, it } from 'vitest'

import { computeSignalsFromLines, primaryStatus } from '../../src/core/session/session-signals.js'

const DAY_MS = 24 * 60 * 60 * 1_000

describe('computeSignalsFromLines', () => {
  const recentTimestamp = new Date(Date.now() - 10 * DAY_MS).toISOString()

  function assistant(blocks: unknown[]): string {
    return JSON.stringify({ type: 'assistant', message: { content: blocks } })
  }

  function compaction(): string {
    return JSON.stringify({ type: 'system', subtype: 'compact_boundary' })
  }

  function toolResult(toolUseId: string, isError?: boolean): string {
    const block: Record<string, unknown> = { type: 'tool_result', tool_use_id: toolUseId }
    if (isError) block['is_error'] = true
    return JSON.stringify({ type: 'user', message: { content: [block] } })
  }

  function toolUse(toolUseId: string): Record<string, unknown> {
    return { type: 'tool_use', id: toolUseId }
  }

  function userText(text: string): string {
    return JSON.stringify({ type: 'user', message: { content: text } })
  }

  it('returns clean signals for a normal completed session', () => {
    const lines = [userText('hello'), assistant([{ type: 'text', text: 'hi' }])]
    const signals = computeSignalsFromLines(lines, recentTimestamp)

    expect(signals.interrupted).toBe(false)
    expect(signals.lastToolFailed).toBe(false)
    expect(signals.compactionCount).toBe(0)
  })

  it('detects compact_boundary events instead of summary events', () => {
    const lines = [
      compaction(),
      assistant([{ type: 'text', text: 'ctx trimmed' }]),
      compaction(),
      compaction(),
    ]
    const signals = computeSignalsFromLines(lines, recentTimestamp)

    expect(signals.compactionCount).toBe(3)
    expect(signals.interrupted).toBe(false)
  })

  it('marks interrupted when assistant ends with an unresolved tool use', () => {
    const lines = [userText('go'), assistant([toolUse('tu_1')])]
    const signals = computeSignalsFromLines(lines, recentTimestamp)

    expect(signals.interrupted).toBe(true)
    expect(signals.lastToolFailed).toBe(false)
  })

  it('clears interrupted when a matching tool result arrives', () => {
    const lines = [
      userText('go'),
      assistant([toolUse('tu_1')]),
      toolResult('tu_1'),
      assistant([{ type: 'text', text: 'done' }]),
    ]
    const signals = computeSignalsFromLines(lines, recentTimestamp)

    expect(signals.interrupted).toBe(false)
  })

  it('sets lastToolFailed when the session ends after a failed tool result', () => {
    const lines = [assistant([toolUse('tu_1')]), toolResult('tu_1', true)]
    const signals = computeSignalsFromLines(lines, recentTimestamp)

    expect(signals.lastToolFailed).toBe(true)
    expect(signals.interrupted).toBe(false)
  })

  it('resets lastToolFailed after a pure-text assistant response', () => {
    const lines = [
      assistant([toolUse('tu_1')]),
      toolResult('tu_1', true),
      assistant([{ type: 'text', text: "I'll try a different approach" }]),
    ]
    const signals = computeSignalsFromLines(lines, recentTimestamp)

    expect(signals.lastToolFailed).toBe(false)
    expect(signals.interrupted).toBe(false)
  })

  it('clears lastToolFailed after a subsequent successful tool result', () => {
    const lines = [
      assistant([toolUse('tu_1')]),
      toolResult('tu_1', true),
      assistant([toolUse('tu_2')]),
      toolResult('tu_2'),
    ]
    const signals = computeSignalsFromLines(lines, recentTimestamp)

    expect(signals.lastToolFailed).toBe(false)
  })

  it('can report interrupted and lastToolFailed simultaneously', () => {
    const lines = [
      assistant([toolUse('tu_1')]),
      toolResult('tu_1', true),
      assistant([toolUse('tu_2')]),
    ]
    const signals = computeSignalsFromLines(lines, recentTimestamp)

    expect(signals.lastToolFailed).toBe(true)
    expect(signals.interrupted).toBe(true)
  })

  it('detects an unresolved call among parallel tool uses', () => {
    const lines = [assistant([toolUse('tu_1'), toolUse('tu_2')]), toolResult('tu_1')]
    const signals = computeSignalsFromLines(lines, recentTimestamp)

    expect(signals.interrupted).toBe(true)
  })

  it('clears interrupted when all parallel tool uses have results', () => {
    const lines = [
      assistant([toolUse('tu_1'), toolUse('tu_2')]),
      toolResult('tu_1'),
      toolResult('tu_2'),
      assistant([{ type: 'text', text: 'both done' }]),
    ]
    const signals = computeSignalsFromLines(lines, recentTimestamp)

    expect(signals.interrupted).toBe(false)
  })

  it('computes expiresInDays from the updated timestamp', () => {
    const twentyFiveDaysAgoTimestamp = new Date(Date.now() - 25 * DAY_MS).toISOString()
    const signals = computeSignalsFromLines([], twentyFiveDaysAgoTimestamp)

    expect(signals.expiresInDays).toBeGreaterThanOrEqual(4)
    expect(signals.expiresInDays).toBeLessThanOrEqual(6)
  })

  it('skips malformed lines without throwing', () => {
    const lines = ['not-json', '{broken', '{"type":"user","message":{"content":"ok"}}']

    expect(() => computeSignalsFromLines(lines, recentTimestamp)).not.toThrow()
  })
})

describe('primaryStatus', () => {
  const baseSignals = {
    analysisComplete: true,
    archived: false,
    compactionCount: 0,
    expiresInDays: 20,
    interrupted: false,
    lastToolFailed: false,
    pathExists: true,
  }

  it('returns ok when all signals are nominal', () => {
    expect(primaryStatus(baseSignals)).toBe('ok')
  })

  it('returns path-missing with highest priority', () => {
    expect(
      primaryStatus({
        ...baseSignals,
        pathExists: false,
        interrupted: true,
        expiresInDays: 2,
      })
    ).toBe('path-missing')
  })

  it('returns expiring when expiresInDays is five or fewer', () => {
    expect(primaryStatus({ ...baseSignals, expiresInDays: 5 })).toBe('expiring')
    expect(primaryStatus({ ...baseSignals, expiresInDays: 0 })).toBe('expiring')
    expect(primaryStatus({ ...baseSignals, expiresInDays: 6 })).toBe('ok')
  })

  it('returns interrupted for an interruption or failed tool', () => {
    expect(primaryStatus({ ...baseSignals, interrupted: true })).toBe('interrupted')
    expect(primaryStatus({ ...baseSignals, lastToolFailed: true })).toBe('interrupted')
  })

  it('returns heavily-compacted after three compactions', () => {
    expect(primaryStatus({ ...baseSignals, compactionCount: 3 })).toBe('heavily-compacted')
    expect(primaryStatus({ ...baseSignals, compactionCount: 2 })).toBe('ok')
  })

  it('treats unknown fast-path signals as non-actionable', () => {
    expect(primaryStatus({ ...baseSignals, expiresInDays: null })).toBe('ok')
    expect(primaryStatus({ ...baseSignals, interrupted: null, lastToolFailed: null })).toBe('ok')
  })
})
