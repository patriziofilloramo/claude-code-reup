import { describe, expect, it } from 'vitest'

import type { Project, Session } from '../../src/core/session/session-model.js'
import {
  filterSessionCandidates,
  rankSessionCandidates,
} from '../../src/core/session/session-ranking.js'

describe('session candidate ranking', () => {
  it('prioritizes the current directory, then active sessions, then recent activity', () => {
    const projects = [
      createProject('/workspace/current', [
        createSession('00000000-0000-0000-0000-000000000001', '/workspace/current', '2026-01-01'),
      ]),
      createProject('/workspace/other', [
        createSession('00000000-0000-0000-0000-000000000002', '/workspace/other', '2026-06-10'),
        createSession('00000000-0000-0000-0000-000000000003', '/workspace/other', '2026-06-11'),
      ]),
    ]

    const candidates = rankSessionCandidates(
      projects,
      new Set(['00000000-0000-0000-0000-000000000002']),
      '/workspace/current/packages/app'
    )

    expect(candidates.map(({ session }) => session.id.slice(-1))).toEqual(['1', '2', '3'])
    expect(candidates[0].inCurrentDirectory).toBe(true)
    expect(candidates[1].active).toBe(true)
  })

  it('keeps archived sessions discoverable but behind equivalent visible sessions', () => {
    const visible = createSession(
      '00000000-0000-0000-0000-000000000001',
      '/workspace',
      '2026-06-10'
    )
    const archived = createSession(
      '00000000-0000-0000-0000-000000000002',
      '/workspace',
      '2026-06-11'
    )
    archived.signals.archived = true

    const candidates = rankSessionCandidates(
      [createProject('/workspace', [archived, visible])],
      new Set(),
      '/workspace'
    )

    expect(candidates.map(({ session }) => session.id.slice(-1))).toEqual(['1', '2'])
  })

  it('filters session and project fields without changing relevance order', () => {
    const projects = [
      createProject('/workspace/api', [
        {
          ...createSession('00000000-0000-0000-0000-000000000001', '/workspace/api'),
          name: 'Fix API',
        },
      ]),
      createProject('/workspace/web', [
        {
          ...createSession('00000000-0000-0000-0000-000000000002', '/workspace/web'),
          gitBranch: 'feat/search',
          name: 'Polish interface',
        },
      ]),
    ]
    const candidates = rankSessionCandidates(projects, new Set(), '/workspace/api')

    expect(filterSessionCandidates(candidates, 'api')).toHaveLength(1)
    expect(filterSessionCandidates(candidates, 'search')[0].session.name).toBe('Polish interface')
    expect(filterSessionCandidates(candidates, '').map(({ session }) => session.id)).toEqual(
      candidates.map(({ session }) => session.id)
    )
  })
})

function createProject(path: string, sessions: Session[]): Project {
  return { id: path.replaceAll('/', '-'), path, sessions }
}

function createSession(id: string, projectPath: string, updated = '2026-06-10'): Session {
  return {
    context: {
      latestContextTokens: null,
      latestModel: null,
      latestOutputTokens: null,
      models: [],
    },
    created: updated,
    id,
    messageCount: 1,
    name: id,
    projectPath,
    signals: {
      analysisComplete: true,
      archived: false,
      compactionCount: 0,
      expiresInDays: 20,
      interrupted: false,
      lastToolFailed: false,
      pathExists: true,
    },
    updated,
  }
}
