import { describe, expect, it } from 'vitest'

import {
  createListedSessions,
  createSessionListDocument,
  filterListedSessions,
  formatSessionTable,
  parseListOptions,
  shortestUniqueIdPrefix,
} from '../../src/cli/list-command.js'
import type { ListOptions, ListedSession } from '../../src/cli/list-command.js'
import type { Project, Session } from '../../src/core/session/session-model.js'

const GENERATED_AT = '2026-06-10T15:00:00.000Z'
const SESSION_ID = '00000000-0000-0000-0000-000000000001'

function createSession(overrides: Partial<Session> = {}): Session {
  return {
    context: {
      latestContextTokens: 42_000,
      latestModel: 'claude-sonnet-4-6',
      latestOutputTokens: 1_200,
      models: ['claude-sonnet-4-6'],
    },
    created: '2026-06-10T10:00:00.000Z',
    id: SESSION_ID,
    messageCount: 4,
    name: 'Build the CLI',
    projectPath: '/workspace/ccm',
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

function defaultOptions(overrides: Partial<ListOptions> = {}): ListOptions {
  return {
    activeOnly: false,
    archivedOnly: false,
    attentionOnly: false,
    json: false,
    ...overrides,
  }
}

function listedSessions(): ListedSession[] {
  const project: Project = {
    id: 'encoded-project',
    path: '/workspace/ccm',
    sessions: [
      createSession({ alias: 'CLI foundation', gitBranch: 'feat/milestone-4-cli' }),
      createSession({
        id: '11111111-1111-1111-1111-111111111111',
        name: 'Archived migration',
        signals: { ...createSession().signals, archived: true },
      }),
      createSession({
        id: '22222222-2222-2222-2222-222222222222',
        name: 'Interrupted API',
        signals: { ...createSession().signals, interrupted: true },
      }),
    ],
  }
  return createListedSessions([project], new Set([SESSION_ID]))
}

describe('list command', () => {
  it('flattens projects into stable, self-contained JSON records', () => {
    const [session] = listedSessions()

    expect(createSessionListDocument([session], GENERATED_AT)).toEqual({
      generatedAt: GENERATED_AT,
      schemaVersion: 2,
      sessions: [
        expect.objectContaining({
          active: true,
          alias: 'CLI foundation',
          context: {
            latestContextTokens: 42_000,
            latestModel: 'claude-sonnet-4-6',
            latestOutputTokens: 1_200,
            models: ['claude-sonnet-4-6'],
          },
          id: SESSION_ID,
          primaryStatus: 'ok',
          projectId: 'encoded-project',
          projectName: 'ccm',
          projectPath: '/workspace/ccm',
        }),
      ],
    })
  })

  it('parses free-text queries and composable filters', () => {
    expect(
      parseListOptions([
        'release',
        'helper',
        '--active',
        '--attention',
        '--project',
        'ccm',
        '--status',
        'interrupted',
        '--limit',
        '5',
        '--json',
      ])
    ).toEqual({
      options: {
        activeOnly: true,
        archivedOnly: false,
        attentionOnly: true,
        json: true,
        limit: 5,
        projectQuery: 'ccm',
        query: 'release helper',
        status: 'interrupted',
      },
    })
  })

  it('rejects unknown options and invalid values', () => {
    expect(parseListOptions(['--unknown'])).toEqual({ error: 'unknown list option: --unknown' })
    expect(parseListOptions(['--limit', '0'])).toEqual({
      error: '--limit requires a positive integer',
    })
    expect(parseListOptions(['--status', 'missing'])).toEqual({
      error: '--status must be one of: ok, interrupted, expiring, path-missing, heavily-compacted',
    })
  })

  it('excludes archived sessions by default and combines filters with AND semantics', () => {
    const sessions = listedSessions()

    expect(filterListedSessions(sessions, defaultOptions()).map((session) => session.name)).toEqual(
      ['Build the CLI', 'Interrupted API']
    )
    expect(
      filterListedSessions(sessions, defaultOptions({ archivedOnly: true })).map(
        (session) => session.name
      )
    ).toEqual(['Archived migration'])
    expect(
      filterListedSessions(
        sessions,
        defaultOptions({ attentionOnly: true, projectQuery: 'CCM', query: 'api', limit: 1 })
      ).map((session) => session.name)
    ).toEqual(['Interrupted API'])
    expect(
      filterListedSessions(sessions, defaultOptions({ query: 'SONNET' })).map(
        (session) => session.name
      )
    ).toEqual(['Build the CLI', 'Interrupted API'])
  })

  it('formats a compact table that remains readable without colour', () => {
    const output = formatSessionTable(listedSessions().slice(0, 1))

    expect(output).toContain('ID PREFIX')
    expect(output).toContain('STATE')
    expect(output).toContain('PROJECT')
    expect(output).toContain('SESSION')
    expect(output).toContain('● active')
    expect(output).toContain('ccm')
    expect(output).toContain('CLI foundation')
    expect(output).toContain(SESSION_ID.slice(0, 8))
    expect(output).not.toContain('\u001b[')
  })

  it('lengthens displayed ID prefixes until they are globally unambiguous', () => {
    const sessions = listedSessions()
    const collidingSession = {
      ...sessions[0],
      id: '00000000-1000-0000-0000-000000000001',
    }
    const allSessions = [sessions[0], collidingSession, ...sessions.slice(1)]

    expect(shortestUniqueIdPrefix(sessions[0].id, allSessions)).toBe('00000000-0')
    expect(formatSessionTable([sessions[0]], false, allSessions)).toContain('00000000-0')
  })

  it('keeps multiline session names on one compact table row', () => {
    const [session] = listedSessions()
    const output = formatSessionTable([
      { ...session, alias: undefined, name: 'First line\nSecond line' },
    ])

    expect(output).toContain('First line Second line')
    expect(output.split('\n')).toHaveLength(2)
  })
})
