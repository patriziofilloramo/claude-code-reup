import { describe, expect, it } from 'vitest'

import type { Project, Session } from '../../src/core/session/session-model.js'
import {
  calculateMaximumVisibleSessions,
  createVisibleWindow,
  deriveSearchResults,
} from '../../src/tui/session-view.js'

function createSession(overrides: Partial<Session> = {}): Session {
  return {
    context: {
      latestContextTokens: null,
      latestModel: null,
      latestOutputTokens: null,
      models: [],
    },
    created: '2026-01-01T00:00:00.000Z',
    id: '00000000-0000-0000-0000-000000000001',
    messageCount: 1,
    name: 'Default session',
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
    updated: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('createVisibleWindow', () => {
  const items = ['a', 'b', 'c', 'd', 'e', 'f']

  it('returns short lists unchanged', () => {
    expect(createVisibleWindow(items.slice(0, 3), 1, 4)).toEqual([['a', 'b', 'c'], 1])
  })

  it('centres the selected item when space exists on both sides', () => {
    expect(createVisibleWindow(items, 3, 3)).toEqual([['c', 'd', 'e'], 1])
  })

  it('clamps the window and relative selection at both list boundaries', () => {
    expect(createVisibleWindow(items, -10, 3)).toEqual([['a', 'b', 'c'], 0])
    expect(createVisibleWindow(items, 99, 3)).toEqual([['d', 'e', 'f'], 2])
  })
})

describe('calculateMaximumVisibleSessions', () => {
  it('uses compact one-line rows while reserving selected-session details', () => {
    expect(calculateMaximumVisibleSessions(6, true)).toBe(5)
    expect(calculateMaximumVisibleSessions(12, true)).toBe(11)
    expect(calculateMaximumVisibleSessions(6, false)).toBe(6)
    expect(calculateMaximumVisibleSessions(1, false)).toBe(2)
  })
})

describe('deriveSearchResults', () => {
  const activeSession = createSession({
    alias: 'Release helper',
    context: {
      latestContextTokens: 42_000,
      latestModel: 'claude-sonnet-4-6',
      latestOutputTokens: 1_200,
      models: ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6'],
    },
    currentBranch: 'main',
    gitBranch: 'feat/release',
    id: '00000000-0000-0000-0000-000000000001',
  })
  const archivedSession = createSession({
    id: '00000000-0000-0000-0000-000000000002',
    name: 'Old migration',
    signals: { ...createSession().signals, archived: true },
  })
  const releaseProject: Project = {
    id: 'release-project',
    path: '/work/release-dashboard',
    sessions: [activeSession, archivedSession],
  }
  const unrelatedProject: Project = {
    id: 'docs-project',
    path: '/work/documentation',
    sessions: [createSession({ id: '00000000-0000-0000-0000-000000000003', name: 'Write docs' })],
  }

  it('hides archived sessions by default and reveals them on request', () => {
    expect(deriveSearchResults([releaseProject], '', false)[0]?.sessions).toEqual([activeSession])
    expect(deriveSearchResults([releaseProject], '', true)[0]?.sessions).toEqual([
      activeSession,
      archivedSession,
    ])
  })

  it('keeps all visible sessions when a project ID or path matches', () => {
    expect(deriveSearchResults([releaseProject, unrelatedProject], 'DASHBOARD', false)).toEqual([
      { ...releaseProject, sessions: [activeSession] },
    ])
    expect(
      deriveSearchResults([releaseProject, unrelatedProject], 'release-project', true)
    ).toEqual([releaseProject])
  })

  it('keeps only matching sessions and their parent projects', () => {
    expect(
      deriveSearchResults([releaseProject, unrelatedProject], 'RELEASE HELPER', false)
    ).toEqual([{ ...releaseProject, sessions: [activeSession] }])
    expect(deriveSearchResults([releaseProject, unrelatedProject], 'write docs', false)).toEqual([
      unrelatedProject,
    ])
  })

  it('matches stable IDs, branches, paths, and model history without case sensitivity', () => {
    for (const query of ['00000000-0000', 'FEAT/', 'MAIN', '/PROJECT', 'HAIKU']) {
      expect(deriveSearchResults([releaseProject], query, false)[0]?.sessions).toEqual([
        activeSession,
      ])
    }
    expect(deriveSearchResults([releaseProject], 'missing', false)).toEqual([])
  })

  it('does not reveal archived session matches unless requested', () => {
    expect(deriveSearchResults([releaseProject], 'old migration', false)).toEqual([])
    expect(deriveSearchResults([releaseProject], 'old migration', true)).toEqual([
      { ...releaseProject, sessions: [archivedSession] },
    ])
  })
})

describe('deriveSearchResults search qualifiers', () => {
  const activeSession = createSession({
    gitBranch: 'feat/release',
    id: '00000000-0000-0000-0000-000000000001',
  })
  const archivedSession = createSession({
    id: '00000000-0000-0000-0000-000000000002',
    name: 'Old migration',
    signals: { ...createSession().signals, archived: true },
  })
  const interruptedSession = createSession({
    id: '00000000-0000-0000-0000-000000000003',
    name: 'Stuck work',
    signals: { ...createSession().signals, interrupted: true },
  })
  const releaseProject = {
    id: 'release-project',
    path: '/work/release-dashboard',
    sessions: [activeSession, archivedSession, interruptedSession],
  }
  const docsProject = {
    id: 'docs-project',
    path: '/work/documentation',
    sessions: [createSession({ id: '00000000-0000-0000-0000-000000000004', name: 'Write docs' })],
  }

  it('is:active filters to only sessions currently running', () => {
    const activeIds = new Set(['00000000-0000-0000-0000-000000000001'])
    const results = deriveSearchResults(
      [releaseProject, docsProject],
      'is:active',
      false,
      activeIds
    )
    expect(results).toEqual([{ ...releaseProject, sessions: [activeSession] }])
  })

  it('is:archived shows only archived sessions regardless of showArchivedSessions flag', () => {
    const results = deriveSearchResults([releaseProject], 'is:archived', false)
    expect(results).toEqual([{ ...releaseProject, sessions: [archivedSession] }])
  })

  it('branch: filters by git branch substring', () => {
    const results = deriveSearchResults([releaseProject, docsProject], 'branch:feat/', false)
    expect(results).toEqual([{ ...releaseProject, sessions: [activeSession] }])
  })

  it('project: filters by project path substring', () => {
    const results = deriveSearchResults(
      [releaseProject, docsProject],
      'project:documentation',
      false
    )
    expect(results).toEqual([{ ...docsProject, sessions: docsProject.sessions }])
  })

  it('status: filters by primaryStatus', () => {
    const results = deriveSearchResults([releaseProject], 'status:interrupted', false)
    expect(results).toEqual([{ ...releaseProject, sessions: [interruptedSession] }])
  })

  it('combines qualifier and text search', () => {
    const activeIds = new Set(['00000000-0000-0000-0000-000000000001'])
    const results = deriveSearchResults(
      [releaseProject, docsProject],
      'is:active release',
      false,
      activeIds
    )
    expect(results).toEqual([{ ...releaseProject, sessions: [activeSession] }])
  })

  it('tag: filters to sessions with a matching tag', () => {
    const taggedSession = createSession({
      id: '00000000-0000-0000-0000-000000000010',
      name: 'Deploy task',
      tags: ['deploy', 'prod'],
    })
    const untaggedSession = createSession({
      id: '00000000-0000-0000-0000-000000000011',
      name: 'Refactor auth',
    })
    const project: Project = {
      id: 'my-project',
      path: '/work/app',
      sessions: [taggedSession, untaggedSession],
    }

    const results = deriveSearchResults([project], 'tag:deploy', false)
    expect(results).toEqual([{ ...project, sessions: [taggedSession] }])
  })

  it('#tagname is equivalent to tag:<tagname>', () => {
    const taggedSession = createSession({
      id: '00000000-0000-0000-0000-000000000012',
      name: 'Deploy task',
      tags: ['deploy'],
    })
    const project: Project = {
      id: 'my-project',
      path: '/work/app',
      sessions: [taggedSession],
    }

    expect(deriveSearchResults([project], '#deploy', false)).toEqual([
      { ...project, sessions: [taggedSession] },
    ])
  })

  it('tag: returns no results when no session matches', () => {
    const project: Project = {
      id: 'my-project',
      path: '/work/app',
      sessions: [createSession({ id: '00000000-0000-0000-0000-000000000013', tags: ['prod'] })],
    }
    expect(deriveSearchResults([project], 'tag:staging', false)).toEqual([])
  })

  it('free-text search also matches session tags', () => {
    const taggedSession = createSession({
      id: '00000000-0000-0000-0000-000000000014',
      name: 'Boring task',
      tags: ['urgent'],
    })
    const project: Project = {
      id: 'my-project',
      path: '/work/app',
      sessions: [taggedSession],
    }

    expect(deriveSearchResults([project], 'urgent', false)).toEqual([
      { ...project, sessions: [taggedSession] },
    ])
  })
})
