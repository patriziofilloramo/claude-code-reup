import { describe, expect, it } from 'vitest'

import { serializeProject, serializeSession } from '../../src/web/api-model.js'
import type { Project, Session } from '../../src/core/session/session-model.js'

const NO_ACTIVE_SESSIONS: ReadonlySet<string> = new Set()

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

    expect(serializeProject(project, NO_ACTIVE_SESSIONS).sessions.map((item) => item.name)).toEqual(
      ['Real session']
    )
  })

  it('keeps the interrupted status for a session that is not currently live', () => {
    const dangling = session({ signals: { ...session().signals, interrupted: true } })

    expect(serializeSession(dangling, false).primaryStatus).toBe('interrupted')
  })

  it('does not report interrupted for a live session with just a dangling tool call', () => {
    // A live session's transcript very often ends on a tool_use in flight —
    // the same condition primaryStatus reads as "interrupted". For an
    // attached session that is normal mid-turn state, not an abandoned one.
    const dangling = session({ signals: { ...session().signals, interrupted: true } })

    expect(serializeSession(dangling, true).primaryStatus).toBe('ok')
  })

  it('keeps reporting interrupted for a live session whose last tool call actually failed', () => {
    // lastToolFailed is a real, independent signal — it is not corrected just
    // because the session happens to still be live afterward.
    const failed = session({
      signals: { ...session().signals, interrupted: true, lastToolFailed: true },
    })

    expect(serializeSession(failed, true).primaryStatus).toBe('interrupted')
  })

  it('falls through to the next applicable status once interrupted is corrected for a live session', () => {
    const heavilyCompacted = session({
      signals: { ...session().signals, compactionCount: 5, interrupted: true },
    })

    expect(serializeSession(heavilyCompacted, true).primaryStatus).toBe('heavily-compacted')
  })

  it('threads liveness through serializeProject for every session in the list', () => {
    const project: Project = {
      id: 'project',
      path: '/workspace/reup',
      sessions: [session({ signals: { ...session().signals, interrupted: true } })],
    }

    expect(serializeProject(project, new Set([session().id])).sessions[0]?.primaryStatus).toBe('ok')
    expect(serializeProject(project, NO_ACTIVE_SESSIONS).sessions[0]?.primaryStatus).toBe(
      'interrupted'
    )
  })
})
