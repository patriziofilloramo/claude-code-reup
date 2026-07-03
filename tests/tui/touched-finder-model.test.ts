import { describe, expect, it } from 'vitest'

import type {
  TouchedFileMatch,
  TouchedFileSummary,
} from '../../src/core/session/session-file-search.js'
import type { Project, Session } from '../../src/core/session/session-model.js'
import { buildTouchedSessionRows, filterTouchedFiles } from '../../src/tui/touched-finder-model.js'

function summary(overrides: Partial<TouchedFileSummary> = {}): TouchedFileSummary {
  return {
    path: '/workspace/repo/src/core/session/session-query.ts',
    sessionCount: 1,
    lastTouchedAt: '2026-06-10T12:00:00.000Z',
    gitBranch: 'main',
    ...overrides,
  }
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    context: {
      latestContextTokens: null,
      latestModel: null,
      latestOutputTokens: null,
      models: null,
    },
    created: '2026-06-10T10:00:00.000Z',
    id: '00000000-0000-0000-0000-000000000001',
    messageCount: 4,
    name: 'session',
    projectPath: '/workspace/repo',
    signals: {
      analysisComplete: true,
      archived: false,
      compactionCount: 0,
      expiresInDays: 28,
      interrupted: false,
      lastToolFailed: false,
      pathExists: true,
    },
    updated: '2026-06-10T12:00:00.000Z',
    ...overrides,
  }
}

const project: Project = {
  id: 'workspace-repo',
  path: '/workspace/repo',
  sessions: [],
}

function match(overrides: Partial<TouchedFileMatch> = {}): TouchedFileMatch {
  return {
    project,
    session: session(),
    matchedPaths: ['/workspace/repo/a.ts'],
    matchCount: 1,
    lastTouchedAt: null,
    gitBranch: null,
    ...overrides,
  }
}

describe('filterTouchedFiles', () => {
  it('returns every file for a blank query', () => {
    const files = [summary({ path: '/a.ts' }), summary({ path: '/b.ts' })]
    expect(filterTouchedFiles(files, '   ')).toHaveLength(2)
  })

  it('matches a case-insensitive substring of the path', () => {
    const files = [
      summary({ path: '/workspace/repo/src/Session-Query.ts' }),
      summary({ path: '/workspace/repo/README.md' }),
    ]
    const filtered = filterTouchedFiles(files, 'session-query')
    expect(filtered.map((file) => file.path)).toEqual(['/workspace/repo/src/Session-Query.ts'])
  })
})

describe('buildTouchedSessionRows', () => {
  it('preserves match order and flags active sessions', () => {
    const rows = buildTouchedSessionRows(
      [
        match({ session: session({ id: 'aaaaaaaa-0000-0000-0000-000000000000' }) }),
        match({ session: session({ id: 'bbbbbbbb-0000-0000-0000-000000000000' }) }),
      ],
      new Set(['bbbbbbbb-0000-0000-0000-000000000000'])
    )
    expect(rows.map((row) => row.active)).toEqual([false, true])
    expect(rows.map((row) => row.id)).toEqual(['aaaaaaaa', 'bbbbbbbb'])
  })

  it('prefers the matched-write branch, then session branches', () => {
    expect(buildTouchedSessionRows([match({ gitBranch: 'feat/edit' })], new Set())[0]!.branch).toBe(
      'feat/edit'
    )
    expect(
      buildTouchedSessionRows(
        [match({ gitBranch: null, session: session({ gitBranch: 'feat/session' }) })],
        new Set()
      )[0]!.branch
    ).toBe('feat/session')
    expect(
      buildTouchedSessionRows(
        [match({ gitBranch: null, session: session({ currentBranch: 'feat/current' }) })],
        new Set()
      )[0]!.branch
    ).toBe('feat/current')
    expect(buildTouchedSessionRows([match({ gitBranch: null })], new Set())[0]!.branch).toBeNull()
  })

  it('derives the project display name from the project path', () => {
    const rows = buildTouchedSessionRows([match()], new Set())
    expect(rows[0]!.project).toBe('repo')
  })
})
