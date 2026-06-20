import { describe, expect, it } from 'vitest'

import { getResumeAdvice } from '../../src/core/session/resume-advice.js'
import type { Session } from '../../src/core/session/session-model.js'

describe('getResumeAdvice', () => {
  it.each([
    [{ signals: { pathExists: false } }, false, 'path-missing'],
    [{}, true, 'already-active'],
    [{ gitBranch: 'feature', currentBranch: 'main' }, false, 'branch-drift'],
    [{ signals: { interrupted: true } }, false, 'interrupted'],
    [{ signals: { expiresInDays: 2 } }, false, 'expiring'],
    [{ signals: { compactionCount: 4 } }, false, 'heavily-compacted'],
    [{}, false, 'ready'],
  ] as const)('derives %s as %s -> %s', (overrides, active, expected) => {
    expect(getResumeAdvice(session(overrides), active).code).toBe(expected)
  })

  it('keeps priority deterministic when multiple warnings apply', () => {
    const result = getResumeAdvice(
      session({
        currentBranch: 'main',
        gitBranch: 'feature',
        signals: { expiresInDays: 1, interrupted: true, pathExists: false },
      }),
      true
    )

    expect(result.code).toBe('path-missing')
    expect(result.severity).toBe('blocked')
  })
})

function session(
  overrides: Partial<Session> & { signals?: Partial<Session['signals']> } = {}
): Session {
  const { signals: signalOverrides, ...sessionOverrides } = overrides
  return {
    context: {
      latestContextTokens: null,
      latestModel: null,
      latestOutputTokens: null,
      models: null,
    },
    created: '2026-01-01T00:00:00.000Z',
    id: '00000000-0000-0000-0000-000000000001',
    messageCount: 1,
    name: 'Test',
    projectPath: '/project',
    signals: {
      analysisComplete: true,
      archived: false,
      compactionCount: 0,
      expiresInDays: 20,
      interrupted: false,
      lastToolFailed: false,
      pathExists: true,
      ...signalOverrides,
    },
    updated: '2026-01-01T00:00:00.000Z',
    ...sessionOverrides,
  }
}
