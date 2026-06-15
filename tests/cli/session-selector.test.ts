import { describe, expect, it } from 'vitest'

import { selectSession } from '../../src/cli/session-selector.js'
import type { Project, Session } from '../../src/core/session/session-model.js'

const FIRST_ID = '00000000-0000-0000-0000-000000000001'
const SECOND_ID = '11111111-1111-1111-1111-111111111111'
const THIRD_ID = '00000000-0000-0000-0000-000000000002'

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

describe('selectSession', () => {
  const projects: Project[] = [
    {
      id: 'project',
      path: '/workspace',
      sessions: [createSession(FIRST_ID), createSession(SECOND_ID), createSession(THIRD_ID)],
    },
  ]

  it('resolves full IDs and unique prefixes', () => {
    expect(selectSession(projects, FIRST_ID)).toMatchObject({
      result: { session: { id: FIRST_ID } },
    })
    expect(selectSession(projects, '11111111')).toMatchObject({
      result: { session: { id: SECOND_ID } },
    })
  })

  it('rejects short, ambiguous, and unknown selectors', () => {
    expect(selectSession(projects, '0000000')).toEqual({
      error: 'session prefix must contain at least 8 characters',
    })
    expect(selectSession(projects, '00000000')).toEqual({
      error: 'session prefix is ambiguous: 00000000',
    })
    expect(selectSession(projects, 'ffffffff')).toEqual({
      error: 'invalid or unknown session: ffffffff',
    })
  })
})
