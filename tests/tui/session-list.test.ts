import { describe, expect, it } from 'vitest'

import type { Session } from '../../src/core/session/session-model.js'
import { formatSessionSummary, formatTokenCount } from '../../src/tui/components/SessionList.js'
import { sessionStatusMarker } from '../../src/tui/session-status-marker.js'

describe('TUI session list', () => {
  it('keeps compact context values readable', () => {
    expect(formatTokenCount(999)).toBe('999')
    expect(formatTokenCount(8_200)).toBe('8.2k')
    expect(formatTokenCount(91_000)).toBe('91k')
    expect(formatTokenCount(1_200_000)).toBe('1.2m')
  })

  it('formats one compact metadata summary per session row', () => {
    expect(
      formatSessionSummary(
        session({
          context: { ...session().context, latestContextTokens: 8_200 },
          messageCount: 2,
          updated: new Date().toISOString(),
        })
      )
    ).toBe('just now · 2 msgs · 8.2k ctx')
  })

  it('keeps working sessions as filled dots while pulsing by color', () => {
    const frames = [0, 1, 2, 3].map((frame) =>
      sessionStatusMarker(markerState({ liveState: 'working', pulseFrame: frame }))
    )
    expect(new Set(frames.map((frame) => frame.glyph))).toEqual(new Set(['●']))
    expect(new Set(frames.map((frame) => frame.color)).size).toBeGreaterThan(1)
  })

  it('lets a session waiting on the user replace the dot with an alert marker', () => {
    expect(sessionStatusMarker(markerState({ liveState: 'needs-input' })).glyph).toBe('!')
  })

  it('uses a single filled-dot marker for normal liveness states', () => {
    expect(sessionStatusMarker(markerState({ liveState: 'attached' })).glyph).toBe('●')
    expect(sessionStatusMarker(markerState({ isRemotelyActive: true })).glyph).toBe('●')
    expect(sessionStatusMarker(markerState()).glyph).toBe('●')
  })

  it('separates an attached-but-quiet session from a working one by intensity', () => {
    // The user must be able to tell "someone is here" from "something is
    // happening" at a glance, without the two competing for attention.
    const attached = sessionStatusMarker(markerState({ liveState: 'attached' }))
    const working = sessionStatusMarker(markerState({ liveState: 'working' }))
    expect(attached.dim).toBe(true)
    expect(working.dim).toBe(false)
    // Dimming carries the difference, so both stay on the live colour rather
    // than hard-coding a second green that no theme defines.
    expect(attached.color).toBe(working.color)
  })

  it('replaces the marker for attention-worthy health states', () => {
    expect(sessionStatusMarker(markerState({ status: 'expiring' })).glyph).toBe('!')
    expect(sessionStatusMarker(markerState({ status: 'path-missing' })).glyph).toBe('!')
  })

  it('never resurrects the historical interrupted flag as a live indicator', () => {
    // interrupted is full-transcript triage data that can stay true forever;
    // rendering it as an alert re-creates the permanent-! bug (PROJECT_MEMORY).
    expect(sessionStatusMarker(markerState({ status: 'interrupted' })).glyph).toBe('●')
    expect(
      sessionStatusMarker(markerState({ liveState: 'attached', status: 'interrupted' }))
    ).toEqual(sessionStatusMarker(markerState({ liveState: 'attached' })))
  })
})

function markerState(overrides: Partial<Parameters<typeof sessionStatusMarker>[0]> = {}) {
  return {
    isBulkSelected: false,
    isRemotelyActive: false,
    liveState: 'detached' as const,
    pulseFrame: 0,
    status: 'ok' as const,
    ...overrides,
  }
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    context: {
      latestContextTokens: null,
      latestModel: null,
      latestOutputTokens: null,
      models: [],
    },
    created: '2026-06-11T00:00:00.000Z',
    id: '00000000-0000-0000-0000-000000000001',
    messageCount: 1,
    name: 'Session',
    projectPath: '/project',
    signals: {
      analysisComplete: true,
      archived: false,
      compactionCount: 0,
      expiresInDays: 20,
      interrupted: false,
      lastToolFailed: false,
      pathExists: true,
    },
    updated: '2026-06-11T00:00:00.000Z',
    ...overrides,
  }
}
