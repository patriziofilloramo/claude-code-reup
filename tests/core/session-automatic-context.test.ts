import { describe, expect, it } from 'vitest'

import { extractAutomaticSessionContext } from '../../src/core/session/session-automatic-context.js'

function event(payload: Record<string, unknown>): string {
  return JSON.stringify({
    cwd: '/workspace/app',
    entrypoint: 'claude-vscode',
    gitBranch: 'feat/checkout',
    sessionId: '00000000-0000-0000-0000-000000000001',
    timestamp: '2026-06-16T10:00:00.000Z',
    userType: 'external',
    version: '2.1.177',
    ...payload,
  })
}

function assistantTool(id: string, name: string, input: Record<string, unknown> = {}): object {
  return { id, input, name, type: 'tool_use' }
}

function userToolResult(
  toolUseId: string,
  result: Record<string, unknown> = {},
  isError = false
): string {
  return event({
    message: {
      content: [{ is_error: isError, tool_use_id: toolUseId, type: 'tool_result' }],
      role: 'user',
    },
    toolUseResult: result,
    type: 'user',
  })
}

describe('extractAutomaticSessionContext', () => {
  it('extracts zero-effort facts from native Claude Code transcript artifacts', () => {
    const context = extractAutomaticSessionContext([
      '{broken',
      event({ lastPrompt: 'Implement checkout flow', type: 'last-prompt' }),
      event({ summary: 'Checkout parser is half built.', type: 'summary' }),
      event({ subtype: 'compact_boundary', type: 'system' }),
      event({
        attachment: {
          content: 'Older planning artifact.',
          planWasEdited: false,
          type: 'plan_mode',
        },
        type: 'attachment',
      }),
      event({
        message: {
          content: [
            { text: 'Working on the feature.', type: 'text' },
            assistantTool('plan-1', 'ExitPlanMode', {
              plan: '1. Add parser. 2. Wire preview. 3. Test everything.',
            }),
            assistantTool('todo-1', 'TodoWrite', {
              todos: [
                {
                  activeForm: 'Adding parser',
                  content: 'Add parser',
                  status: 'in_progress',
                },
                { content: 'Write tests', status: 'pending' },
                { content: 'Draft plan', status: 'completed' },
              ],
            }),
            assistantTool('edit-1', 'Edit', { file_path: '/workspace/app/src/parser.ts' }),
            assistantTool('read-1', 'Read', { file_path: '/workspace/app/src/model.ts' }),
            assistantTool('grep-1', 'Grep', { pattern: 'TodoWrite' }),
            assistantTool('agent-1', 'Agent', {
              agentId: 'agent-123',
              agentType: 'Plan',
            }),
          ],
          role: 'assistant',
        },
        permissionMode: 'default',
        slug: 'checkout-context',
        type: 'assistant',
      }),
      userToolResult('edit-1', {
        durationMs: 42_000,
        filePath: '/workspace/app/src/parser.ts',
        truncated: true,
      }),
      userToolResult('read-1'),
      userToolResult('grep-1', { interrupted: true }),
    ])

    expect(context.execution).toEqual({
      cwd: '/workspace/app',
      entrypoint: 'claude-vscode',
      gitBranch: 'feat/checkout',
      permissionMode: 'default',
      slug: 'checkout-context',
      version: '2.1.177',
    })
    expect(context.plan).toMatchObject({
      source: 'assistant-tool',
      text: '1. Add parser. 2. Wire preview. 3. Test everything.',
      wasEdited: null,
    })
    expect(context.todos).toMatchObject({
      counts: { completed: 1, in_progress: 1, pending: 1, unknown: 0 },
      source: 'assistant-tool',
    })
    expect(context.todos.items.map((todo) => todo.content)).toEqual([
      'Add parser',
      'Write tests',
      'Draft plan',
    ])
    expect(context.touchedFiles).toEqual(['/workspace/app/src/parser.ts'])
    expect(context.readFiles).toEqual(['/workspace/app/src/model.ts'])
    expect(context.researchActions).toEqual([{ kind: 'grep', query: 'TodoWrite' }])
    expect(context.toolHealth.pending.map((tool) => tool.name)).toEqual([
      'ExitPlanMode',
      'TodoWrite',
      'Agent',
    ])
    expect(context.toolHealth.slow).toContainEqual(
      expect.objectContaining({ durationMs: 42000, name: 'Edit' })
    )
    expect(context.toolHealth.truncated).toContainEqual(expect.objectContaining({ name: 'Edit' }))
    expect(context.toolHealth.interrupted).toContainEqual(expect.objectContaining({ name: 'Grep' }))
    expect(context.agentActivity).toMatchObject({
      agentIds: ['agent-123'],
      agentNames: ['Plan'],
      sidechainEventCount: 0,
      taskToolUseCount: 1,
    })
    expect(context.summaries).toEqual({
      compactBoundaryCount: 1,
      latestPrompt: 'Implement checkout flow',
      latestSummary: 'Checkout parser is half built.',
    })
  })

  it('uses tool-result plans and latest todo states when available', () => {
    const context = extractAutomaticSessionContext([
      event({
        message: {
          content: [assistantTool('tool-1', 'ExitPlanMode', { plan: 'Original plan.' })],
          role: 'assistant',
        },
        type: 'assistant',
      }),
      event({
        message: {
          content: [{ tool_use_id: 'tool-1', type: 'tool_result' }],
          role: 'user',
        },
        timestamp: '2026-06-16T10:01:00.000Z',
        toolUseResult: {
          newTodos: [{ content: 'Ship it', status: 'completed' }],
          plan: 'Edited and accepted plan.',
          planWasEdited: true,
        },
        type: 'user',
      }),
    ])

    expect(context.plan).toEqual({
      source: 'tool-result',
      text: 'Edited and accepted plan.',
      updatedAt: '2026-06-16T10:01:00.000Z',
      wasEdited: true,
    })
    expect(context.todos).toMatchObject({
      counts: { completed: 1, in_progress: 0, pending: 0, unknown: 0 },
      source: 'tool-result',
    })
    expect(context.toolHealth.pending).toEqual([])
  })

  it('preserves native plan markdown structure', () => {
    const context = extractAutomaticSessionContext([
      event({
        message: {
          content: [
            assistantTool('plan-1', 'ExitPlanMode', {
              plan: '## Plan\n\n- Keep the inspector stable\n- Render `TodoWrite` clearly',
            }),
          ],
          role: 'assistant',
        },
        type: 'assistant',
      }),
    ])

    expect(context.plan?.text).toBe(
      '## Plan\n\n- Keep the inspector stable\n- Render `TodoWrite` clearly'
    )
  })

  it('deduplicates recent file and research facts while preserving newest first', () => {
    const context = extractAutomaticSessionContext([
      event({
        message: {
          content: [
            assistantTool('edit-1', 'Edit', { file_path: '/workspace/a.ts' }),
            assistantTool('edit-2', 'Write', { file_path: '/workspace/b.ts' }),
            assistantTool('edit-3', 'Edit', { file_path: '/workspace/a.ts' }),
            assistantTool('read-1', 'Read', { file_path: '/workspace/readme.md' }),
            assistantTool('read-2', 'Read', { file_path: '/workspace/readme.md' }),
            assistantTool('grep-1', 'Grep', { pattern: 'first' }),
            assistantTool('grep-2', 'Grep', { pattern: 'first' }),
            assistantTool('glob-1', 'Glob', { pattern: '**/*.ts' }),
          ],
          role: 'assistant',
        },
        type: 'assistant',
      }),
    ])

    expect(context.touchedFiles).toEqual(['/workspace/a.ts', '/workspace/b.ts'])
    expect(context.readFiles).toEqual(['/workspace/readme.md'])
    expect(context.researchActions).toEqual([
      { kind: 'glob', query: '**/*.ts' },
      { kind: 'grep', query: 'first' },
    ])
  })
})
