import { describe, expect, it } from 'vitest'

import type { Session } from '../../src/core/session-model.js'
import { formatSessionSummary, formatTokenCount } from '../../src/tui/components/SessionList.js'

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
