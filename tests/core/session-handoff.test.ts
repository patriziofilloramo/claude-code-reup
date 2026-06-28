import { describe, expect, it } from 'vitest'

import {
  analyzeTranscriptForHandoff,
  formatHandoff,
} from '../../src/core/session/session-handoff.js'
import type { Session } from '../../src/core/session/session-model.js'

const SESSION_ID = '00000000-0000-0000-0000-000000000001'

describe('session handoff', () => {
  it('extracts supported continuation facts and ignores malformed lines', () => {
    const lines = [
      '{broken',
      JSON.stringify({ type: 'summary', summary: 'The CLI foundation is complete.' }),
      JSON.stringify({
        type: 'user',
        message: {
          content:
            '<system-reminder>internal context</system-reminder> Finish doctor and handoff commands.',
        },
      }),
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'I implemented the shared diagnostic core.' },
            {
              type: 'tool_use',
              name: 'Edit',
              input: { file_path: '/workspace/src/core/diagnostics.ts' },
            },
            {
              type: 'tool_use',
              name: 'TodoWrite',
              input: {
                todos: [
                  { content: 'Run verification', status: 'in_progress' },
                  { content: 'Implement diagnostics', status: 'completed' },
                ],
              },
            },
          ],
        },
      }),
    ]

    expect(analyzeTranscriptForHandoff(lines)).toEqual({
      changedFiles: ['/workspace/src/core/diagnostics.ts'],
      goal: 'Finish doctor and handoff commands.',
      openTodos: ['Run verification'],
      recentAssistantContext: 'I implemented the shared diagnostic core.',
      summary: 'The CLI foundation is complete.',
    })
  })

  it('formats an honest Markdown packet when optional facts are unavailable', () => {
    const session = createSession()
    const output = formatHandoff(session, {
      changedFiles: [],
      goal: 'Continue Milestone 4.',
      openTodos: [],
    })

    expect(output).toContain('# Reup Handoff: Milestone 4')
    expect(output).toContain('## Goal\n\nContinue Milestone 4.')
    expect(output).toContain('## Decisions and context\n\nNot available in the transcript.')
    expect(output).toContain('## Changed files detected in transcript\n\nNone detected.')
    expect(output).toContain(`claude --resume ${SESSION_ID}`)
  })
})

function createSession(): Session {
  return {
    context: {
      latestContextTokens: 42_000,
      latestModel: 'claude-sonnet-4-6',
      latestOutputTokens: 1_200,
      models: ['claude-sonnet-4-6'],
    },
    created: '2026-06-10T10:00:00.000Z',
    gitBranch: 'feat/milestone-4-cli',
    id: SESSION_ID,
    messageCount: 4,
    name: 'Milestone 4',
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
    updated: '2026-06-10T12:00:00.000Z',
  }
}
