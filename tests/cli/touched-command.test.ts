import { describe, expect, it } from 'vitest'

import {
  TOUCHED_SCHEMA_VERSION,
  createTouchedDocument,
  formatTouchedTable,
  orderCandidatesByMatch,
  parseTouchedOptions,
} from '../../src/cli/touched-command.js'
import type { TouchedResult } from '../../src/cli/touched-command.js'
import type { TouchedFileMatch } from '../../src/core/session/session-file-search.js'
import type { Session } from '../../src/core/session/session-model.js'
import type { RankedSession } from '../../src/core/session/session-ranking.js'

function result(overrides: Partial<TouchedResult> = {}): TouchedResult {
  return {
    active: false,
    gitBranch: 'main',
    lastTouchedAt: '2026-06-10T12:00:00.000Z',
    matchCount: 1,
    matchedPaths: ['/workspace/repo/src/core/session/session-query.ts'],
    projectId: 'workspace-repo',
    projectName: 'repo',
    projectPath: '/workspace/repo',
    sessionId: '00000000-0000-0000-0000-000000000001',
    sessionName: 'Build the lookup',
    ...overrides,
  }
}

describe('parseTouchedOptions', () => {
  it('joins free arguments into the path query', () => {
    const parsed = parseTouchedOptions(['core/session', 'query'])
    expect('options' in parsed && parsed.options.query).toBe('core/session query')
  })

  it('reads the json, archived and limit flags', () => {
    const parsed = parseTouchedOptions(['a.ts', '--json', '--archived', '--limit', '5'])
    if ('error' in parsed) throw new Error(parsed.error)
    expect(parsed.options).toMatchObject({
      query: 'a.ts',
      json: true,
      includeArchived: true,
      limit: 5,
    })
  })

  it('treats a missing path as the interactive (empty-query) mode', () => {
    expect(parseTouchedOptions([])).toEqual({
      options: { query: '', json: false, includeArchived: false },
    })
    expect(parseTouchedOptions(['--archived'])).toEqual({
      options: { query: '', json: false, includeArchived: true },
    })
  })

  it('rejects an invalid limit and unknown options', () => {
    expect(parseTouchedOptions(['a.ts', '--limit', '0'])).toEqual({
      error: '--limit requires a positive integer',
    })
    expect(parseTouchedOptions(['a.ts', '--bogus'])).toEqual({
      error: 'unknown touched option: --bogus',
    })
  })

  it('rejects machine-output and limit flags without a path', () => {
    expect(parseTouchedOptions(['--json'])).toEqual({ error: '--json requires a path' })
    expect(parseTouchedOptions(['--limit', '5'])).toEqual({ error: '--limit requires a path' })
  })
})

describe('orderCandidatesByMatch', () => {
  function session(id: string): Session {
    return {
      context: {
        latestContextTokens: null,
        latestModel: null,
        latestOutputTokens: null,
        models: null,
      },
      created: '2026-06-10T10:00:00.000Z',
      id,
      messageCount: 4,
      name: id,
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
    }
  }

  const project = { id: 'workspace-repo', path: '/workspace/repo', sessions: [], isShared: false }

  function candidate(id: string): RankedSession {
    return { active: false, inCurrentDirectory: true, project, session: session(id) }
  }

  function match(id: string): TouchedFileMatch {
    return {
      project,
      session: session(id),
      matchedPaths: [],
      matchCount: 1,
      lastTouchedAt: null,
      gitBranch: null,
    }
  }

  it('follows the match relevance order, not the resume ranking', () => {
    const candidates = [candidate('a'), candidate('b'), candidate('c')]
    const ordered = orderCandidatesByMatch([match('c'), match('a')], candidates)
    expect(ordered.map((entry) => entry.session.id)).toEqual(['c', 'a'])
  })

  it('drops sessions that did not match and skips matches with no candidate', () => {
    const ordered = orderCandidatesByMatch([match('x'), match('a')], [candidate('a')])
    expect(ordered.map((entry) => entry.session.id)).toEqual(['a'])
  })
})

describe('createTouchedDocument', () => {
  it('wraps results in a stable, versioned document', () => {
    const document = createTouchedDocument('session-query', [result()], '2026-06-10T15:00:00.000Z')
    expect(document).toEqual({
      generatedAt: '2026-06-10T15:00:00.000Z',
      query: 'session-query',
      schemaVersion: TOUCHED_SCHEMA_VERSION,
      results: [result()],
    })
  })
})

describe('formatTouchedTable', () => {
  it('reports when nothing matched', () => {
    expect(formatTouchedTable('ghost', [])).toBe('No sessions touched a file matching "ghost".')
  })

  it('orders columns project before session, with an active marker', () => {
    const table = formatTouchedTable('session-query', [result({ active: true })])
    const header = table.split('\n')[0]!
    expect(header.indexOf('PROJECT')).toBeGreaterThanOrEqual(0)
    expect(header.indexOf('PROJECT')).toBeLessThan(header.indexOf('SESSION'))
    expect(table).toContain('Build the lookup')
    expect(table).toContain('repo')
    expect(table).toContain('●')
  })

  it('shows the branch and the real touch time, like the file picker', () => {
    const table = formatTouchedTable('session-query', [result({ gitBranch: 'feat/x' })])
    expect(table).toContain('BRANCH')
    expect(table).toContain('feat/x')
    expect(table).toContain('WHEN')
  })

  it('hides the branch column when no branch was recorded', () => {
    const table = formatTouchedTable('session-query', [result({ gitBranch: null })])
    expect(table).not.toContain('BRANCH')
  })

  it('shows the matched path when the query is only a fragment of it', () => {
    const table = formatTouchedTable('session-query', [result()])
    expect(table).toContain('TOUCHED')
    expect(table).toContain('src/core/session/session-query.ts')
  })

  it('hides the touched column when the query already names the file', () => {
    const table = formatTouchedTable('src/core/session/session-query.ts', [result()])
    expect(table).not.toContain('TOUCHED')
    expect(table).toContain('Build the lookup')
  })

  it('summarises additional matched paths', () => {
    const table = formatTouchedTable('core', [
      result({
        matchedPaths: ['/workspace/repo/src/a.ts', '/workspace/repo/src/b.ts'],
      }),
    ])
    expect(table).toContain('src/a.ts (+1 more)')
  })

  it('falls back to the basename when the path is outside the project', () => {
    const table = formatTouchedTable('shared', [
      result({ matchedPaths: ['/elsewhere/shared-config.ts'] }),
    ])
    expect(table).toContain('shared-config.ts')
  })
})
