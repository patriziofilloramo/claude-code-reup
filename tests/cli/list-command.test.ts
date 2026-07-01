import { describe, expect, it } from 'vitest'

import {
  createListedSessions,
  createSessionListDocument,
  filterListedSessions,
  formatSessionTable,
  parseListOptions,
  resolveOrgFilter,
  shortestUniqueIdPrefix,
} from '../../src/cli/list-command.js'
import type { ListOptions, ListedSession } from '../../src/cli/list-command.js'
import { applyOrgMetadata, filterProjectsByOrg } from '../../src/core/org/org-filters.js'
import type { OrgData } from '../../src/core/org/org-model.js'
import { emptyOrgData } from '../../src/core/org/org-prefs.js'
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
    projectPath: '/workspace/reup',
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
    path: '/workspace/reup',
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
          projectName: 'reup',
          projectPath: '/workspace/reup',
        }),
      ],
    })
  })

  it('does not list lock-only zero-message sessions as resumable rows', () => {
    const project: Project = {
      id: 'encoded-project',
      path: '/workspace/reup',
      sessions: [
        createSession({ name: 'Real session' }),
        createSession({
          id: '11111111-1111-1111-1111-111111111111',
          messageCount: 0,
          name: 'New session',
        }),
      ],
    }

    expect(createListedSessions([project], new Set()).map((session) => session.name)).toEqual([
      'Real session',
    ])
  })

  it('parses free-text queries and composable filters', () => {
    expect(
      parseListOptions([
        'release',
        'helper',
        '--active',
        '--attention',
        '--project',
        'reup',
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
        projectQuery: 'reup',
        query: 'release helper',
        status: 'interrupted',
      },
    })
  })

  it('parses --tag, --group, and --stack flags', () => {
    expect(parseListOptions(['--tag', 'deploy'])).toEqual({
      options: expect.objectContaining({ tag: 'deploy' }),
    })
    expect(parseListOptions(['--group', 'My Group'])).toEqual({
      options: expect.objectContaining({ group: 'My Group' }),
    })
    expect(parseListOptions(['--stack', 'Sprint 1'])).toEqual({
      options: expect.objectContaining({ stack: 'Sprint 1' }),
    })
    expect(parseListOptions(['--tag'])).toEqual({ error: '--tag requires a value' })
    expect(parseListOptions(['--group'])).toEqual({ error: '--group requires a value' })
    expect(parseListOptions(['--stack'])).toEqual({ error: '--stack requires a value' })
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
        defaultOptions({ attentionOnly: true, projectQuery: 'Reup', query: 'api', limit: 1 })
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
    expect(output).toContain('reup')
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

describe('resolveOrgFilter', () => {
  const orgData: OrgData = {
    ...emptyOrgData(),
    groups: [
      { id: 'g-alpha', name: 'Alpha Team' },
      { id: 'g-beta', name: 'Beta Team' },
      { id: 'g-other', name: 'Other' },
    ],
    stacks: [
      { id: 's-sprint1', name: 'Sprint 1', items: [] },
      { id: 's-sprint2', name: 'Sprint 2', items: [] },
      { id: 's-hotfix', name: 'Hotfix', items: [] },
    ],
  }

  it('resolves group name (case-insensitive substring) to groupId', () => {
    expect(resolveOrgFilter(orgData, { group: 'alpha' })).toEqual({
      filter: { groupId: 'g-alpha' },
    })
    expect(resolveOrgFilter(orgData, { group: 'Alpha Team' })).toEqual({
      filter: { groupId: 'g-alpha' },
    })
  })

  it('resolves stack name (case-insensitive substring) to stackId', () => {
    expect(resolveOrgFilter(orgData, { stack: 'hotfix' })).toEqual({
      filter: { stackId: 's-hotfix' },
    })
    expect(resolveOrgFilter(orgData, { stack: 'Sprint 1' })).toEqual({
      filter: { stackId: 's-sprint1' },
    })
  })

  it('normalizes tag to lowercase', () => {
    expect(resolveOrgFilter(orgData, { tag: 'Deploy' })).toEqual({ filter: { tag: 'deploy' } })
    expect(resolveOrgFilter(orgData, { tag: 'CI/CD' })).toEqual({ filter: { tag: 'ci/cd' } })
  })

  it('returns error when no group matches', () => {
    const result = resolveOrgFilter(orgData, { group: 'nonexistent' })
    expect(result).toEqual({ error: 'no group matching "nonexistent"' })
  })

  it('returns error when no stack matches', () => {
    const result = resolveOrgFilter(orgData, { stack: 'nonexistent' })
    expect(result).toEqual({ error: 'no stack matching "nonexistent"' })
  })

  it('returns error when multiple groups match', () => {
    const result = resolveOrgFilter(orgData, { group: 'team' })
    expect(result).toEqual({
      error: '"team" matches multiple groups: Alpha Team, Beta Team — be more specific',
    })
  })

  it('returns error when multiple stacks match', () => {
    const result = resolveOrgFilter(orgData, { stack: 'sprint' })
    expect(result).toEqual({
      error: '"sprint" matches multiple stacks: Sprint 1, Sprint 2 — be more specific',
    })
  })

  it('returns empty filter when no org options are set', () => {
    expect(resolveOrgFilter(orgData, {})).toEqual({ filter: {} })
    expect(resolveOrgFilter(emptyOrgData(), {})).toEqual({ filter: {} })
  })

  it('group takes priority over stack and tag when both are provided', () => {
    expect(resolveOrgFilter(orgData, { group: 'alpha', stack: 'hotfix', tag: 'prod' })).toEqual({
      filter: { groupId: 'g-alpha' },
    })
  })
})

describe('CLI org filter pipeline (3c integration)', () => {
  function makeSession(id: string, overrides: Partial<Session> = {}): Session {
    return {
      context: {
        latestContextTokens: null,
        latestModel: null,
        latestOutputTokens: null,
        models: [],
      },
      created: '2026-01-01T00:00:00.000Z',
      id,
      messageCount: 1,
      name: `Session ${id}`,
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

  const deploySession = makeSession('s1', { tags: ['deploy', 'prod'] })
  const plainSession = makeSession('s2', { name: 'Plain session' })
  const prodSession = makeSession('s3', { tags: ['prod'] })

  const projectA: Project = {
    id: 'proj-a',
    path: '/work/app-a',
    sessions: [deploySession, plainSession],
  }
  const projectB: Project = {
    id: 'proj-b',
    path: '/work/app-b',
    sessions: [prodSession],
  }
  const projectC: Project = {
    id: 'proj-c',
    path: '/work/app-c',
    sessions: [makeSession('s4')],
  }

  const orgData: OrgData = {
    ...emptyOrgData(),
    groups: [
      { id: 'g-work', name: 'Work' },
      { id: 'g-personal', name: 'Personal' },
    ],
    stacks: [
      {
        id: 'stack-launch',
        name: 'Launch week',
        items: [
          { kind: 'project', projectId: 'proj-a' },
          { kind: 'session', projectId: 'proj-b', sessionId: 's3' },
        ],
      },
    ],
    projectGroupAssignments: { 'proj-a': 'g-work', 'proj-b': 'g-work' },
  }

  function applyAndList(
    projects: Project[],
    filterOptions: Parameters<typeof resolveOrgFilter>[1]
  ): ListedSession[] {
    const filterResult = resolveOrgFilter(orgData, filterOptions)
    if ('error' in filterResult) throw new Error(filterResult.error)
    // Mirror the real pipeline: applyOrgMetadata populates group/groupName before filtering
    const withMeta = applyOrgMetadata(projects, orgData)
    const filtered = filterProjectsByOrg(withMeta, orgData, filterResult.filter)
    return createListedSessions(filtered, new Set())
  }

  it('--tag deploy returns only sessions with that tag', () => {
    const sessions = applyAndList([projectA, projectB, projectC], { tag: 'deploy' })
    expect(sessions.map((s) => s.id)).toEqual(['s1'])
  })

  it('--tag prod returns all sessions tagged prod across all projects', () => {
    const sessions = applyAndList([projectA, projectB, projectC], { tag: 'prod' })
    expect(sessions.map((s) => s.id)).toEqual(['s1', 's3'])
  })

  it('--group work returns all sessions from projects in the group', () => {
    const sessions = applyAndList([projectA, projectB, projectC], { group: 'work' })
    expect(sessions.map((s) => s.id)).toContain('s1')
    expect(sessions.map((s) => s.id)).toContain('s2')
    expect(sessions.map((s) => s.id)).toContain('s3')
    expect(sessions.map((s) => s.id)).not.toContain('s4')
  })

  it('--stack "launch week" returns stack members only', () => {
    const sessions = applyAndList([projectA, projectB, projectC], { stack: 'launch week' })
    // proj-a has a project-level item → all its sessions; proj-b contributes s3 only
    const ids = sessions.map((s) => s.id)
    expect(ids).toContain('s1')
    expect(ids).toContain('s2')
    expect(ids).toContain('s3')
    expect(ids).not.toContain('s4')
    // proj-b plainSession (s4 is in proj-c, not in stack)
  })

  it('serialized listed sessions include tags, group, and groupName', () => {
    const sessions = applyAndList([projectA], { tag: 'deploy' })
    const session = sessions.find((s) => s.id === 's1')!
    expect(session.tags).toEqual(['deploy', 'prod'])
    expect(session.group).toBe('g-work')
  })
})
