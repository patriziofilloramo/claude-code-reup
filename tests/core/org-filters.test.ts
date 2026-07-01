import { describe, expect, it } from 'vitest'

import {
  applyOrgMetadata,
  countGroupProjects,
  countStackSessions,
  filterProjectsByOrg,
} from '../../src/core/org/org-filters.js'
import type { OrgData } from '../../src/core/org/org-model.js'
import type { Project, Session } from '../../src/core/session/session-model.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSession(id: string, tags?: string[], archived = false): Session {
  return {
    id,
    name: `Session ${id}`,
    projectPath: '/some/path',
    created: '2024-01-01T00:00:00Z',
    updated: '2024-01-01T00:00:00Z',
    messageCount: 1,
    tags,
    context: {
      latestContextTokens: null,
      latestModel: null,
      latestOutputTokens: null,
      models: null,
    },
    signals: {
      analysisComplete: true,
      archived,
      compactionCount: null,
      expiresInDays: null,
      interrupted: null,
      lastToolFailed: null,
      pathExists: true,
    },
  }
}

function makeProject(id: string, sessions: Session[], projectTags?: string[]): Project {
  return {
    id,
    path: `/projects/${id}`,
    sessions,
    projectTags,
  }
}

function makeOrgData(partial?: Partial<OrgData>): OrgData {
  return {
    schemaVersion: 1,
    groups: [],
    stacks: [],
    tagPalette: [],
    projectGroupAssignments: {},
    ...partial,
  }
}

// ---------------------------------------------------------------------------
// applyOrgMetadata
// ---------------------------------------------------------------------------

describe('applyOrgMetadata', () => {
  it('populates group field for assigned projects', () => {
    const projects = [makeProject('proj-a', []), makeProject('proj-b', [])]
    const orgData = makeOrgData({ projectGroupAssignments: { 'proj-a': 'group-1' } })

    const result = applyOrgMetadata(projects, orgData)

    expect(result[0]!.group).toBe('group-1')
    expect(result[1]!.group).toBeUndefined()
  })

  it('does not mutate the original project objects', () => {
    const project = makeProject('proj-a', [])
    const orgData = makeOrgData({ projectGroupAssignments: { 'proj-a': 'group-1' } })

    const result = applyOrgMetadata([project], orgData)

    expect(project.group).toBeUndefined()
    expect(result[0]).not.toBe(project)
    expect(result[0]!.group).toBe('group-1')
  })

  it('returns projects unchanged when no assignments exist', () => {
    const projects = [makeProject('proj-a', [])]
    const result = applyOrgMetadata(projects, makeOrgData())
    expect(result[0]).toBe(projects[0])
  })
})

// ---------------------------------------------------------------------------
// filterProjectsByOrg — group filter
// ---------------------------------------------------------------------------

describe('filterProjectsByOrg — group', () => {
  it('returns projects belonging to the specified group', () => {
    const projects = [makeProject('proj-a', []), makeProject('proj-b', [])]
    const orgData = makeOrgData({
      groups: [{ id: 'g1', name: 'Work' }],
      projectGroupAssignments: { 'proj-a': 'g1' },
    })

    const result = filterProjectsByOrg(projects, orgData, { groupId: 'g1' })

    expect(result).toHaveLength(1)
    expect(result[0]!.id).toBe('proj-a')
  })

  it('returns empty array when no projects belong to the group', () => {
    const projects = [makeProject('proj-a', [])]
    const orgData = makeOrgData({ groups: [{ id: 'g1', name: 'Work' }] })

    const result = filterProjectsByOrg(projects, orgData, { groupId: 'g1' })

    expect(result).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// filterProjectsByOrg — stack filter
// ---------------------------------------------------------------------------

describe('filterProjectsByOrg — stack', () => {
  it('returns the full project when a project item is in the stack', () => {
    const sessions = [makeSession('s1'), makeSession('s2')]
    const project = makeProject('proj-a', sessions)
    const orgData = makeOrgData({
      stacks: [
        { id: 'stack-1', name: 'Sprint', items: [{ kind: 'project', projectId: 'proj-a' }] },
      ],
    })

    const result = filterProjectsByOrg([project], orgData, { stackId: 'stack-1' })

    expect(result).toHaveLength(1)
    expect(result[0]!.sessions).toHaveLength(2)
  })

  it('returns only matching sessions when a session item is in the stack', () => {
    const sessions = [makeSession('s1'), makeSession('s2')]
    const project = makeProject('proj-a', sessions)
    const orgData = makeOrgData({
      stacks: [
        {
          id: 'stack-1',
          name: 'Sprint',
          items: [{ kind: 'session', projectId: 'proj-a', sessionId: 's1' }],
        },
      ],
    })

    const result = filterProjectsByOrg([project], orgData, { stackId: 'stack-1' })

    expect(result).toHaveLength(1)
    expect(result[0]!.sessions).toHaveLength(1)
    expect(result[0]!.sessions[0]!.id).toBe('s1')
  })

  it('returns empty array for an unknown stack', () => {
    const project = makeProject('proj-a', [makeSession('s1')])
    const result = filterProjectsByOrg([project], makeOrgData(), { stackId: 'no-such-stack' })
    expect(result).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// filterProjectsByOrg — tag filter
// ---------------------------------------------------------------------------

describe('filterProjectsByOrg — tag', () => {
  it('matches sessions that have the tag directly', () => {
    const sessions = [makeSession('s1', ['bug']), makeSession('s2', ['feature'])]
    const project = makeProject('proj-a', sessions)

    const result = filterProjectsByOrg([project], makeOrgData(), { tag: 'bug' })

    expect(result).toHaveLength(1)
    expect(result[0]!.sessions).toHaveLength(1)
    expect(result[0]!.sessions[0]!.id).toBe('s1')
  })

  it('matches all sessions in a project that has the project-level tag', () => {
    const sessions = [makeSession('s1'), makeSession('s2')]
    const project = makeProject('proj-a', sessions, ['bug'])

    const result = filterProjectsByOrg([project], makeOrgData(), { tag: 'bug' })

    expect(result).toHaveLength(1)
    expect(result[0]!.sessions).toHaveLength(2)
  })

  it('returns empty array when no sessions match the tag', () => {
    const project = makeProject('proj-a', [makeSession('s1', ['feature'])])

    const result = filterProjectsByOrg([project], makeOrgData(), { tag: 'bug' })

    expect(result).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// filterProjectsByOrg — no filter
// ---------------------------------------------------------------------------

describe('filterProjectsByOrg — no filter', () => {
  it('returns the original array when no filter is set', () => {
    const projects = [makeProject('proj-a', [])]
    const result = filterProjectsByOrg(projects, makeOrgData(), {})
    expect(result).toBe(projects)
  })
})

// ---------------------------------------------------------------------------
// countStackSessions — dedup
// ---------------------------------------------------------------------------

describe('countStackSessions', () => {
  it('counts all non-archived sessions from a project item', () => {
    const sessions = [makeSession('s1'), makeSession('s2'), makeSession('s3', undefined, true)]
    const project = makeProject('proj-a', sessions)
    const stack = {
      id: 'stack-1',
      name: 'Sprint',
      items: [{ kind: 'project' as const, projectId: 'proj-a' }],
    }

    expect(countStackSessions(stack, [project])).toBe(2)
  })

  it('counts a session item once even when the project is also in the stack', () => {
    const sessions = [makeSession('s1'), makeSession('s2')]
    const project = makeProject('proj-a', sessions)
    const stack = {
      id: 'stack-1',
      name: 'Sprint',
      items: [
        { kind: 'project' as const, projectId: 'proj-a' },
        { kind: 'session' as const, projectId: 'proj-a', sessionId: 's1' },
      ],
    }

    // Both sessions come from the project; session s1 is also referenced directly.
    // Expected: 2 unique (proj-a:s1) + (proj-a:s2) — no double count.
    expect(countStackSessions(stack, [project])).toBe(2)
  })

  it('counts sessions across multiple projects', () => {
    const projectA = makeProject('proj-a', [makeSession('s1'), makeSession('s2')])
    const projectB = makeProject('proj-b', [makeSession('s3')])
    const stack = {
      id: 'stack-1',
      name: 'Sprint',
      items: [
        { kind: 'project' as const, projectId: 'proj-a' },
        { kind: 'project' as const, projectId: 'proj-b' },
      ],
    }

    expect(countStackSessions(stack, [projectA, projectB])).toBe(3)
  })

  it('returns 0 for an empty stack', () => {
    const project = makeProject('proj-a', [makeSession('s1')])
    const stack = { id: 'stack-1', name: 'Sprint', items: [] }
    expect(countStackSessions(stack, [project])).toBe(0)
  })

  it('returns 0 when stack references non-existent projects', () => {
    const stack = {
      id: 'stack-1',
      name: 'Sprint',
      items: [{ kind: 'project' as const, projectId: 'no-such-project' }],
    }
    expect(countStackSessions(stack, [])).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// countGroupProjects
// ---------------------------------------------------------------------------

describe('countGroupProjects', () => {
  it('counts projects assigned to the group', () => {
    const group = { id: 'g1', name: 'Work' }
    const orgData = makeOrgData({
      groups: [group],
      projectGroupAssignments: { 'proj-a': 'g1', 'proj-b': 'g1', 'proj-c': 'g2' },
    })
    expect(countGroupProjects(group, orgData)).toBe(2)
  })

  it('returns 0 when no projects are assigned to the group', () => {
    const group = { id: 'g1', name: 'Empty' }
    expect(countGroupProjects(group, makeOrgData())).toBe(0)
  })
})
