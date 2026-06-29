import { describe, expect, it } from 'vitest'

import { serializeProject } from '../../src/web/api-model.js'
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

describe('web API model serialization', () => {
  it('does not send lock-only zero-message sessions to the browser project list', () => {
    const project: Project = {
      id: 'project',
      path: '/workspace/reup',
      sessions: [
        session(),
        session({
          id: '00000000-0000-0000-0000-000000000002',
          messageCount: 0,
          name: 'New session',
        }),
      ],
    }

    expect(serializeProject(project, false).sessions.map((item) => item.name)).toEqual([
      'Real session',
    ])
  })
})
