import { describe, expect, it } from 'vitest'

import { extractSessionPreview } from '../../src/core/session/session-preview.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function userText(text: string) {
  return JSON.stringify({ type: 'user', message: { content: text } })
}

function userBlocks(blocks: object[]) {
  return JSON.stringify({ type: 'user', message: { content: blocks } })
}

function assistantText(text: string) {
  return JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'text', text }] },
  })
}

function assistantWithTools(text: string, tools: { id: string; name: string; input?: object }[]) {
  return JSON.stringify({
    type: 'assistant',
    message: {
      content: [
        { type: 'text', text },
        ...tools.map((t) => ({ type: 'tool_use', id: t.id, name: t.name, input: t.input ?? {} })),
      ],
    },
  })
}

function toolResult(toolUseId: string, isError = false) {
  return userBlocks([{ type: 'tool_result', tool_use_id: toolUseId, is_error: isError }])
}

function editTool(id: string, filePath: string) {
  return { id, name: 'Edit', input: { file_path: filePath } }
}

function writeTool(id: string, filePath: string) {
  return { id, name: 'Write', input: { file_path: filePath } }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('extractSessionPreview', () => {
  it('returns empty preview for an empty transcript', () => {
    expect(extractSessionPreview([])).toMatchObject({
      goal: null,
      lastResponse: null,
      pendingToolName: null,
      touchedFiles: [],
    })
    expect(extractSessionPreview([]).automaticContext.todos.items).toEqual([])
  })

  it('ignores malformed JSONL lines without throwing', () => {
    const lines = ['{broken', 'not json at all', userText('hello')]
    expect(extractSessionPreview(lines).goal).toBe('hello')
  })

  it('extracts the last human turn as the goal', () => {
    const lines = [
      userText('first request'),
      assistantText('first reply'),
      userText('second request — build the auth layer'),
    ]
    expect(extractSessionPreview(lines).goal).toBe('second request — build the auth layer')
  })

  it('extracts the last assistant text as the last response', () => {
    const lines = [
      assistantText('first response'),
      toolResult('t1'),
      assistantText('second response — completed the auth middleware'),
    ]
    expect(extractSessionPreview(lines).lastResponse).toBe(
      'second response — completed the auth middleware'
    )
  })

  it('strips <system-reminder> injections from goal and response', () => {
    const lines = [
      userText('<system-reminder>internal context</system-reminder> Implement the API router.'),
      assistantText('Done. <system-reminder>more internal</system-reminder> I added the routes.'),
    ]
    const preview = extractSessionPreview(lines)
    expect(preview.goal).toBe('Implement the API router.')
    expect(preview.lastResponse).toBe('Done. I added the routes.')
  })

  it('does not capture context usage reports as the goal', () => {
    const lines = [
      userText('build the feature'),
      assistantText('built it'),
      userBlocks([
        {
          type: 'text',
          text: '## Context Usage\n**Model:** claude-sonnet-4-6\nTokens: 50k',
        },
      ]),
    ]
    expect(extractSessionPreview(lines).goal).toBe('build the feature')
  })

  it('records no pending tool when all tool calls are resolved', () => {
    const lines = [
      assistantWithTools('writing file', [editTool('t1', '/proj/src/auth.ts')]),
      toolResult('t1'),
    ]
    const preview = extractSessionPreview(lines)
    expect(preview.pendingToolName).toBeNull()
    expect(preview.touchedFiles).toEqual(['/proj/src/auth.ts'])
  })

  it('records the unresolved tool name when the session is interrupted', () => {
    const lines = [
      assistantWithTools('editing files', [
        editTool('t1', '/proj/src/a.ts'),
        writeTool('t2', '/proj/src/b.ts'),
      ]),
      toolResult('t1'),
      // t2 never resolved
    ]
    const preview = extractSessionPreview(lines)
    expect(preview.pendingToolName).toBe('Write')
  })

  it('returns null pendingToolName when multiple tools all resolve', () => {
    const lines = [
      assistantWithTools('parallel edits', [
        editTool('t1', '/proj/a.ts'),
        editTool('t2', '/proj/b.ts'),
      ]),
      toolResult('t1'),
      toolResult('t2'),
    ]
    expect(extractSessionPreview(lines).pendingToolName).toBeNull()
  })

  it('deduplicates touched files and returns the most recently touched first', () => {
    const lines = [
      assistantWithTools('first pass', [
        editTool('t1', '/proj/a.ts'),
        editTool('t2', '/proj/b.ts'),
      ]),
      toolResult('t1'),
      toolResult('t2'),
      assistantWithTools('second pass', [
        editTool('t3', '/proj/a.ts'),
        editTool('t4', '/proj/c.ts'),
      ]),
      toolResult('t3'),
      toolResult('t4'),
    ]
    // a.ts touched again last, so it appears first; b.ts is oldest unique touch
    expect(extractSessionPreview(lines).touchedFiles).toEqual([
      '/proj/c.ts',
      '/proj/a.ts',
      '/proj/b.ts',
    ])
  })

  it('caps touched files at 8 entries', () => {
    const tools = Array.from({ length: 12 }, (_, i) => editTool(`t${i}`, `/proj/file${i}.ts`))
    const lines = [assistantWithTools('many edits', tools), ...tools.map((t) => toolResult(t.id))]
    expect(extractSessionPreview(lines).touchedFiles).toHaveLength(8)
  })

  it('truncates goal at a sentence boundary when possible', () => {
    // Sentence boundary at position 152 (63% of 240 limit) — above the 55% threshold.
    const longGoal = 'x'.repeat(150) + '. ' + 'y'.repeat(300)
    const preview = extractSessionPreview([userText(longGoal)])
    expect(preview.goal).toMatch(/\.$/) // ends at sentence boundary
    expect(preview.goal!.length).toBeLessThanOrEqual(240)
    expect(preview.goal).not.toMatch(/…$/) // not a hard-cut ellipsis
  })

  it('falls back to hard truncation with ellipsis when no sentence boundary found', () => {
    const continuous = 'a'.repeat(400)
    const preview = extractSessionPreview([userText(continuous)])
    expect(preview.goal).toMatch(/…$/)
    expect(preview.goal!.length).toBeLessThanOrEqual(241) // 240 chars + ellipsis
  })

  it('ignores tool-result-only user events when tracking the goal', () => {
    const lines = [
      userText('the real goal'),
      assistantWithTools('doing work', [editTool('t1', '/proj/x.ts')]),
      toolResult('t1'), // pure tool result, not a new goal
    ]
    expect(extractSessionPreview(lines).goal).toBe('the real goal')
  })

  it('handles transcripts with no text content gracefully', () => {
    const lines = [
      JSON.stringify({ type: 'system', subtype: 'compact_boundary' }),
      JSON.stringify({ type: 'summary', summary: 'A prior summary.' }),
    ]
    const preview = extractSessionPreview(lines)
    expect(preview.goal).toBeNull()
    expect(preview.lastResponse).toBeNull()
    expect(preview.pendingToolName).toBeNull()
    expect(preview.touchedFiles).toHaveLength(0)
  })
})
