import { describe, expect, it } from 'vitest'

import { isInspectorMessage, renderInspectorHtml } from '../../extension/src/inspector-html.js'
import type { ExtensionSession } from '../../extension/src/swoop-data.js'
import { extractSessionPreview } from '../../src/core/session/session-preview.js'

describe('VS Code Session Inspector', () => {
  it('renders strict CSP, escaped content, advice, actions, and passive memory state', () => {
    const preview = extractSessionPreview([
      JSON.stringify({ message: { content: '<script>alert(1)</script>' }, type: 'user' }),
      JSON.stringify({
        message: { content: [{ text: 'Finished <unsafe> work', type: 'text' }] },
        type: 'assistant',
      }),
    ])

    const html = renderInspectorHtml(session({ title: 'Fix <links>' }), preview)

    expect(html).toContain("default-src 'none'")
    expect(html).toContain("script-src 'nonce-")
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('Session already active')
    expect(html).toContain('data-action="copyHandoff"')
    expect(html).toContain('data-action="editAlias"')
    expect(html).toContain('data-action="editTags"')
    expect(html).toContain('Project Memory: orange')
  })

  it('accepts only the Inspector message whitelist', () => {
    expect(isInspectorMessage({ type: 'resume' })).toBe(true)
    expect(isInspectorMessage({ path: '/project/file.ts', type: 'openFile' })).toBe(true)
    expect(isInspectorMessage({ type: 'delete' })).toBe(false)
    expect(isInspectorMessage({ path: 42, type: 'openFile' })).toBe(false)
    expect(isInspectorMessage('resume')).toBe(false)
  })
})

function session(overrides: Partial<ExtensionSession> = {}): ExtensionSession {
  return {
    advice: {
      code: 'already-active',
      explanation: 'Claude Code already has a live process attached to this session.',
      recommendedAction: 'inspect',
      severity: 'blocked',
      title: 'Session already active',
    },
    archived: false,
    branch: 'feat/demo',
    branchDrift: true,
    contextTokens: 12000,
    currentBranch: 'main',
    id: '00000000-0000-0000-0000-000000000001',
    isActive: true,
    memoryStatus: 'orange',
    messageCount: 42,
    needsAttention: true,
    planSummary: null,
    primaryStatus: 'interrupted',
    projectId: 'p--demo',
    projectName: 'demo',
    projectPath: 'P:\\Projects\\demo',
    tags: ['important'],
    title: 'Fix markdown',
    todoSummary: null,
    updated: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}
