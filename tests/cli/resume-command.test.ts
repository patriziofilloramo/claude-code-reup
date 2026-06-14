import { describe, expect, it } from 'vitest'

import { selectResumeTarget } from '../../src/cli/resume-command.js'
import type { Project, Session } from '../../src/core/session-model.js'

const FIRST_ID = '00000000-0000-0000-0000-000000000001'
const SECOND_ID = '11111111-1111-1111-1111-111111111111'
const UNKNOWN_FULL_ID = '22222222-2222-2222-2222-222222222222'

describe('selectResumeTarget', () => {
  const projects: Project[] = [
    {
      id: 'project',
      path: '/workspace',
      sessions: [createSession(FIRST_ID), createSession(SECOND_ID)],
    },
  ]

  it('expands an unambiguous prefix to an exact session ID and recorded path', () => {
    expect(selectResumeTarget(projects, '11111111')).toEqual({
      result: {
        projectPath: '/workspace',
        sessionId: SECOND_ID,
      },
    })
  })

  it('preserves direct resume for a valid full ID absent from discovery', () => {
    expect(selectResumeTarget(projects, UNKNOWN_FULL_ID)).toEqual({
      result: { sessionId: UNKNOWN_FULL_ID },
    })
  })

  it('rejects ambiguous and unknown prefixes', () => {
    const ambiguousProjects: Project[] = [
      {
        ...projects[0],
        sessions: [
          createSession('00000000-0000-0000-0000-000000000001'),
          createSession('00000000-0000-0000-0000-000000000002'),
        ],
      },
    ]

    expect(selectResumeTarget(ambiguousProjects, '00000000')).toEqual({
      error: 'session prefix is ambiguous: 00000000',
    })
    expect(selectResumeTarget(projects, 'ffffffff')).toEqual({
      error: 'invalid or unknown session: ffffffff',
    })
  })
})

function createSession(id: string): Session {
  return {
    context: {
      latestContextTokens: null,
      latestModel: null,
      latestOutputTokens: null,
      models: [],
    },
    created: '2026-06-10T10:00:00.000Z',
    id,
    messageCount: 1,
    name: id,
    projectPath: '/workspace',
    signals: {
      analysisComplete: true,
      archived: false,
      compactionCount: 0,
      expiresInDays: 20,
      interrupted: false,
      lastToolFailed: false,
      pathExists: true,
    },
    updated: '2026-06-10T10:00:00.000Z',
  }
}
