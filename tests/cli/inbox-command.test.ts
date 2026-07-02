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
    const expiring = createSession('expiring-session', 'Expiring work', {
      signals: { ...active.signals, expiresInDays: 2 },
    })
    const archived = createSession('archived-session', 'Archived work', {
      signals: { ...active.signals, archived: true, expiresInDays: 2 },
    })
    const clean = createSession('clean-session', 'Clean work')
    const projects: Project[] = [
      { id: 'project', path: '/workspace', sessions: [clean, expiring, archived, active] },
    ]

    const output = formatInbox(projects, new Set([active.id]))

    expect(output).toContain('Reup Inbox (2)')
    expect(output).toContain('Active work')
    expect(output).toContain('Expiring work')
    expect(output).not.toContain('Archived work')
    expect(output).not.toContain('Clean work')
    expect(output.indexOf('Active work')).toBeLessThan(output.indexOf('Expiring work'))
  })

  it('no longer lists sessions for the historical interrupted flag alone', () => {
    // A stale transcript with an old unresolved tool_use must not clutter the
    // inbox forever; live needs-input detection replaced it.
    const interrupted = createSession('interrupted-session', 'Interrupted work', {
      signals: {
        ...createSession('x', 'x').signals,
        interrupted: true,
      },
    })
    expect(
      formatInbox([{ id: 'project', path: '/workspace', sessions: [interrupted] }], new Set())
    ).toBe('Inbox clear. No active sessions or sessions needing attention.')
  })

  it('lists and prioritizes sessions waiting for input, with a needs input label', () => {
    const active = createSession('active-session', 'Active work')
    const waiting = createSession('waiting-session', 'Waiting work')
    const projects: Project[] = [{ id: 'project', path: '/workspace', sessions: [active, waiting] }]

    const output = formatInbox(projects, new Set([active.id, waiting.id]), new Set([waiting.id]))

    expect(output).toContain('Reup Inbox (2)')
    expect(output).toContain('needs input')
    expect(output.indexOf('Waiting work')).toBeLessThan(output.indexOf('Active work'))
  })

  it('prints a concise clear state', () => {
    const clean = createSession('clean-session', 'Clean work')
    expect(formatInbox([{ id: 'project', path: '/workspace', sessions: [clean] }], new Set())).toBe(
      'Inbox clear. No active sessions or sessions needing attention.'
    )
  })
})
