import { describe, expect, it } from 'vitest'

import { findCleanupCandidates } from '../../src/core/session/cleanup.js'
import type { Project, Session } from '../../src/core/session/session-model.js'

describe('cleanup candidate selection', () => {
  it('scores deterministic cleanup candidates for explicit review', () => {
    const projects = [
      createProject([
        createSession('empty', { messageCount: 0 }),
        createSession('expired', { expiresInDays: 0, messageCount: 20 }),
        createSession('trivial', { messageCount: 2 }),
        createSession('stale', { messageCount: 8, updated: '2025-01-01T00:00:00.000Z' }),
      ]),
    ]

    const candidates = findCleanupCandidates(
      projects,
      new Set(),
      Date.parse('2026-06-15T00:00:00Z')
    )

    expect(candidates.map((candidate) => [candidate.session.name, candidate.score])).toEqual([
      ['empty', 100],
      ['expired', 85],
      ['trivial', 60],
      ['stale', 40],
    ])
  })
})

function createProject(sessions: Session[]): Project {
  return { id: 'project', path: '/project', sessions }
}

function createSession(
  name: string,
  overrides: { expiresInDays?: number; messageCount: number; updated?: string }
): Session {
  const updated = overrides.updated ?? '2026-06-10T00:00:00.000Z'
  return {
    context: {
      latestContextTokens: null,
      latestModel: null,
      latestOutputTokens: null,
      models: null,
    },
    created: updated,
    id: `00000000-0000-0000-0000-${name.padEnd(12, '0').slice(0, 12)}`,
    messageCount: overrides.messageCount,
    name,
    projectPath: '/project',
    signals: {
      analysisComplete: true,
      archived: false,
      compactionCount: 0,
      expiresInDays: overrides.expiresInDays ?? 20,
      interrupted: false,
      lastToolFailed: false,
      pathExists: true,
    },
    updated,
  }
}
