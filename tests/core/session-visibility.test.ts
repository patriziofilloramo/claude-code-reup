import { describe, expect, it } from 'vitest'

import {
  filterResumeListProjects,
  isResumeListVisibleSession,
  isResumeVisibleSession,
} from '../../src/core/session/session-visibility.js'
import type { Project, Session } from '../../src/core/session/session-model.js'

function session(overrides: Partial<Session> = {}): Session {
  return {
    context: {
      latestContextTokens: null,
      latestModel: null,
      latestOutputTokens: null,
      models: null,
    },
    created: '2026-06-29T10:00:00.000Z',
    id: '00000000-0000-0000-0000-000000000001',
    messageCount: 1,
    name: 'Real session',
    projectPath: '/workspace/reup',
    signals: {
      analysisComplete: true,
      archived: false,
      compactionCount: 0,
      expiresInDays: 30,
      interrupted: false,
      lastToolFailed: false,
      pathExists: true,
    },
    updated: '2026-06-29T10:05:00.000Z',
    ...overrides,
  }
}

describe('resume list session visibility', () => {
  it('keeps zero-message lock placeholders out of resume-oriented lists', () => {
    expect(isResumeVisibleSession(session({ messageCount: 0 }))).toBe(false)
    expect(isResumeVisibleSession(session({ messageCount: 1 }))).toBe(true)
  })

  it('applies archived visibility only after rejecting non-resumable sessions', () => {
    const archived = session({ signals: { ...session().signals, archived: true } })
    const ghost = session({ messageCount: 0, signals: { ...session().signals, archived: true } })

    expect(isResumeListVisibleSession(archived)).toBe(false)
    expect(isResumeListVisibleSession(archived, { includeArchived: true })).toBe(true)
    expect(isResumeListVisibleSession(ghost, { includeArchived: true })).toBe(false)
  })

  it('drops projects that only contain non-resumable placeholders', () => {
    const real = session()
    const ghost = session({
      id: '00000000-0000-0000-0000-000000000002',
      messageCount: 0,
      name: 'New session',
    })
    const projects: Project[] = [
      { id: 'ghost-project', path: '/workspace/ghost', sessions: [ghost] },
      { id: 'real-project', path: '/workspace/reup', sessions: [ghost, real] },
    ]

    expect(filterResumeListProjects(projects)).toEqual([
      { id: 'real-project', path: '/workspace/reup', sessions: [real] },
    ])
  })
})
