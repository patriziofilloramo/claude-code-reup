import { describe, expect, it } from 'vitest'

import { findAutoArchiveCandidates, findCleanupCandidates } from '../../src/core/cleanup.js'
import type { Project, Session } from '../../src/core/session-model.js'

describe('cleanup candidate selection', () => {
  it('limits unattended archiving to high-confidence candidates', () => {
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
    const automaticCandidates = findAutoArchiveCandidates(candidates)

    expect(automaticCandidates.map((candidate) => candidate.session.name).sort()).toEqual([
      'empty',
      'expired',
    ])
  })
})

function createProject(sessions: Session[]): Project {
  return { id: 'project', isShared: false, path: '/project', sessions }
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
