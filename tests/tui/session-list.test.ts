import { describe, expect, it } from 'vitest'

import type { Session } from '../../src/core/session/session-model.js'
import {
  formatSessionSummary,
  formatTokenCount,
  sessionLivenessGlyph,
} from '../../src/tui/components/SessionList.js'

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

  it('pulses busy sessions so a working agent differs from an attached idle process', () => {
    const frames = new Set(
      [0, 1, 2, 3].map((frame) => sessionLivenessGlyph(true, true, false, frame).glyph)
    )
    expect(frames.size).toBeGreaterThan(1)
  })

  it('lets a session waiting on the user outrank every other liveness state', () => {
    const attention = sessionLivenessGlyph(true, true, false, 0, true)
    expect(attention.glyph).toBe('!')
    const frames = new Set(
      [0, 1, 2, 3].map((frame) => sessionLivenessGlyph(true, true, false, frame, true).glyph)
    )
    expect(frames.size).toBeGreaterThan(1)
  })

  it('keeps steady liveness glyphs for non-busy states', () => {
    expect(sessionLivenessGlyph(true, false, false, 0).glyph).toBe('●')
    expect(sessionLivenessGlyph(false, false, true, 0).glyph).toBe('◌')
    expect(sessionLivenessGlyph(false, false, false, 0).glyph).toBe('●')
    // The glyph must not change with the pulse frame when the session is not busy.
    expect(sessionLivenessGlyph(true, false, false, 1).glyph).toBe(
      sessionLivenessGlyph(true, false, false, 2).glyph
    )
  })
})

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
