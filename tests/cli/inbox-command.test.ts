import { describe, expect, it } from 'vitest'

import { formatInbox } from '../../src/cli/inbox-command.js'
import type { Project, Session } from '../../src/core/session/session-model.js'

function createSession(id: string, name: string, overrides: Partial<Session> = {}): Session {
  return {
    context: {
      latestContextTokens: null,
      latestModel: null,
      latestOutputTokens: null,
      models: [],
    },
    created: new Date().toISOString(),
    id,
    messageCount: 1,
    name,
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
    updated: new Date().toISOString(),
    ...overrides,
  }
}

describe('formatInbox', () => {
  it('shows active and actionable sessions while excluding clean and archived sessions', () => {
    const active = createSession('active-session', 'Active work')
    const interrupted = createSession('interrupted-session', 'Interrupted work', {
      signals: { ...active.signals, interrupted: true },
    })
    const archived = createSession('archived-session', 'Archived work', {
      signals: { ...active.signals, archived: true, interrupted: true },
    })
    const clean = createSession('clean-session', 'Clean work')
    const projects: Project[] = [
      { id: 'project', path: '/workspace', sessions: [clean, interrupted, archived, active] },
    ]

    const output = formatInbox(projects, new Set([active.id]))

    expect(output).toContain('Reup Inbox (2)')
    expect(output).toContain('Active work')
    expect(output).toContain('Interrupted work')
    expect(output).not.toContain('Archived work')
    expect(output).not.toContain('Clean work')
    expect(output.indexOf('Active work')).toBeLessThan(output.indexOf('Interrupted work'))
  })

  it('prints a concise clear state', () => {
    const clean = createSession('clean-session', 'Clean work')
    expect(formatInbox([{ id: 'project', path: '/workspace', sessions: [clean] }], new Set())).toBe(
      'Inbox clear. No active sessions or sessions needing attention.'
    )
  })
})
