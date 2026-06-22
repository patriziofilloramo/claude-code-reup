import { describe, expect, it } from 'vitest'

import type { Project, Session } from '../../src/core/session/session-model.js'
import {
  filterProjectsBySmartView,
  nextSessionSmartView,
  primarySessionSmartView,
  SESSION_SMART_VIEWS,
  smartViewLabel,
} from '../../src/core/session/session-smart-view.js'

const NOW = Date.parse('2026-06-22T12:00:00.000Z')

function createSession(overrides: Partial<Session> = {}): Session {
  return {
    context: {
      latestContextTokens: 10_000,
      latestModel: null,
      latestOutputTokens: null,
      models: null,
    },
    created: '2026-06-01T12:00:00.000Z',
    id: '00000000-0000-0000-0000-000000000001',
    messageCount: 10,
    name: 'Session',
    projectPath: '/workspace/project',
    signals: {
      analysisComplete: true,
      archived: false,
      compactionCount: 0,
      expiresInDays: null,
      interrupted: false,
      lastToolFailed: false,
      pathExists: true,
    },
    updated: '2026-05-01T12:00:00.000Z',
    ...overrides,
  }
}

function createProject(sessions: Session[]): Project {
  return {
    group: 'group-1',
    groupName: 'Launch',
    id: 'project-1',
    isShared: false,
    path: '/workspace/project',
    projectTags: ['important'],
    sessions,
  }
}

describe('session smart views', () => {
  it('assigns one exclusive bucket using the shared priority order', () => {
    const session = createSession({
      context: {
        latestContextTokens: 200_000,
        latestModel: null,
        latestOutputTokens: null,
        models: null,
      },
      currentBranch: 'main',
      gitBranch: 'feature',
      signals: {
        ...createSession().signals,
        expiresInDays: 2,
        interrupted: true,
        pathExists: false,
      },
      updated: '2026-06-22T11:00:00.000Z',
    })

    expect(primarySessionSmartView(session, new Set([session.id]), NOW)).toBe('active')
    expect(primarySessionSmartView(session, new Set(), NOW)).toBe('attention')
  })

  it('covers branch, path, context, expiry, recency, and archived semantics', () => {
    expect(
      primarySessionSmartView(
        createSession({ currentBranch: 'main', gitBranch: 'feature' }),
        new Set(),
        NOW
      )
    ).toBe('branch-drift')
    expect(
      primarySessionSmartView(
        createSession({ signals: { ...createSession().signals, pathExists: false } }),
        new Set(),
        NOW
      )
    ).toBe('path-missing')
    expect(
      primarySessionSmartView(
        createSession({
          context: {
            latestContextTokens: 150_000,
            latestModel: null,
            latestOutputTokens: null,
            models: null,
          },
        }),
        new Set(),
        NOW
      )
    ).toBe('high-context')
    expect(
      primarySessionSmartView(
        createSession({ signals: { ...createSession().signals, expiresInDays: 7 } }),
        new Set(),
        NOW
      )
    ).toBe('expiring')
    expect(
      primarySessionSmartView(
        createSession({ updated: '2026-06-16T12:00:00.000Z' }),
        new Set(),
        NOW
      )
    ).toBe('recent')
    expect(
      primarySessionSmartView(
        createSession({ signals: { ...createSession().signals, archived: true } }),
        new Set(),
        NOW
      )
    ).toBeNull()
  })

  it('preserves project organization metadata while filtering sessions', () => {
    const matching = createSession({
      id: '00000000-0000-0000-0000-000000000002',
      signals: { ...createSession().signals, interrupted: true },
    })
    const project = createProject([createSession(), matching])

    expect(filterProjectsBySmartView([project], new Set(), 'attention', NOW)).toEqual([
      { ...project, sessions: [matching] },
    ])
    expect(filterProjectsBySmartView([project], new Set(), 'active', NOW)).toEqual([])
  })

  it('cycles through every bucket and then clears focus', () => {
    let current = null as ReturnType<typeof nextSessionSmartView>
    const visited: string[] = []

    for (let index = 0; index < SESSION_SMART_VIEWS.length; index += 1) {
      current = nextSessionSmartView(current)
      expect(current).not.toBeNull()
      visited.push(current as string)
    }

    expect(visited).toEqual(SESSION_SMART_VIEWS.map((view) => view.id))
    expect(nextSessionSmartView(current)).toBeNull()
    expect(smartViewLabel('attention')).toBe('Needs attention')
    expect(smartViewLabel(null)).toBeNull()
  })
})
