import { describe, expect, it } from 'vitest'

import { isInspectorMessage, renderInspectorHtml } from '../../extension/src/inspector-html.js'
import type { ExtensionSession } from '../../extension/src/reup-data.js'
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
    expect(html).toContain('memory-orange')
    expect(html).toContain('Project Memory needs linking on one or more devices')
    expect(html).not.toContain('Project Memory: orange')
    expect(html).toContain('● active')
    expect(html).toContain('#important')
  })

  it('accepts only the Inspector message whitelist', () => {
    expect(isInspectorMessage({ type: 'resume' })).toBe(true)
    expect(isInspectorMessage({ path: '/project/file.ts', type: 'openFile' })).toBe(true)
    expect(isInspectorMessage({ type: 'delete' })).toBe(false)
    expect(isInspectorMessage({ path: 42, type: 'openFile' })).toBe(false)
    expect(isInspectorMessage('resume')).toBe(false)
  })

  it('hides healthy status text and renders each Project Memory state semantically', () => {
    const preview = extractSessionPreview([])
    const none = renderInspectorHtml(
      session({ isActive: false, memoryStatus: 'none', primaryStatus: 'ok' }),
      preview
    )
    expect(none).not.toContain('>ok<')
    expect(none).not.toContain('class="pill memory')

    const green = renderInspectorHtml(session({ memoryStatus: 'green' }), preview)
    expect(green).toContain('Project Memory is synced through shared storage')
    expect(green).not.toContain('Project Memory: green')

    const grey = renderInspectorHtml(session({ memoryStatus: 'grey' }), preview)
    expect(grey).toContain('Project Memory shared storage is currently unavailable')
  })

  it('renders structured plan markdown instead of flattening it into one paragraph', () => {
    const preview = extractSessionPreview([
      JSON.stringify({
        message: {
          content: [
            {
              text: [
                '# Plan',
                '',
                '## Steps',
                '',
                '1. First step',
                '2. Second `step`',
                '',
                '| Name | Value |',
                '| --- | --- |',
                '| Package | `reup` |',
                '',
                '```ts',
                'const unsafe = "<script>"',
                '```',
              ].join('\n'),
              type: 'text',
            },
          ],
        },
        type: 'assistant',
      }),
    ])
    preview.automaticContext.plan = {
      text: preview.lastResponse ?? '',
      timestamp: null,
    }

    const html = renderInspectorHtml(session(), preview)

    expect(html).toContain('<h1>Plan</h1>')
    expect(html).toContain('<h2>Steps</h2>')
    expect(html).toContain('<ol><li>First step</li><li>Second <code>step</code></li></ol>')
    expect(html).toContain('<table>')
    expect(html).toContain('<th>Name</th>')
    expect(html).toContain('<td><code>reup</code></td>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('const unsafe = "<script>"')
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
