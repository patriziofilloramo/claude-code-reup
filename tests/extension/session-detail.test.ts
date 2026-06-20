import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { describe, expect, it } from 'vitest'

import { renderSessionDetailMarkdown } from '../../extension/src/session-detail-markdown.js'
import type { ExtensionSession } from '../../extension/src/swoop-data.js'
import { extractSessionPreview } from '../../src/core/session/session-preview.js'

function session(overrides: Partial<ExtensionSession> = {}): ExtensionSession {
  return {
    advice: {
      code: 'already-active',
      explanation: 'Already active',
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
    messageCount: 42,
    needsAttention: true,
    planSummary: null,
    primaryStatus: 'interrupted',
    projectId: 'p--demo',
    projectName: 'demo',
    projectPath: 'P:\\Projects\\demo',
    tags: [],
    title: 'Fix markdown',
    todoSummary: null,
    updated: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function userText(text: string): string {
  return JSON.stringify({ message: { content: text }, type: 'user' })
}

function assistantText(text: string): string {
  return JSON.stringify({ message: { content: [{ text, type: 'text' }] }, type: 'assistant' })
}

describe('VS Code session detail renderer', () => {
  it('renders a read-only resume card with session facts and preview content', () => {
    const preview = extractSessionPreview([
      userText('Please fix the markdown rendering.'),
      assistantText('## Done\n\n- Added detail renderer\n- Added tests'),
    ])

    const markdown = renderSessionDetailMarkdown(session(), preview)

    expect(markdown).toContain('# Swoop Resume Card')
    expect(markdown).toContain('**Session:** Fix markdown')
    expect(markdown).toContain('**Status:** interrupted - active')
    expect(markdown).toContain('## What You Asked For')
    expect(markdown).toContain('Please fix the markdown rendering.')
    expect(markdown).toContain('## Where Claude Left Off')
    expect(markdown).toContain('## Done')
    expect(markdown).toContain('Read-only local view')
    expect(markdown).not.toContain('Â')
  })

  it('escapes markdown-sensitive title and path metadata', () => {
    const markdown = renderSessionDetailMarkdown(
      session({
        projectPath: 'C:\\repo`name',
        title: 'Fix [links] and *stars*',
      }),
      extractSessionPreview([])
    )

    expect(markdown).toContain('Fix \\[links\\] and \\*stars\\*')
    expect(markdown).toContain('`C:\\repo\\`name`')
  })

  it('renders touched files as editor-openable file links', () => {
    const projectPath = process.cwd()
    const touchedFile = join(projectPath, 'src', 'index.ts')
    const preview = {
      ...extractSessionPreview([]),
      touchedFiles: [touchedFile],
    }

    const markdown = renderSessionDetailMarkdown(session({ projectPath }), preview)

    expect(markdown).toContain('## Files Touched')
    expect(markdown).toContain(pathToFileURL(touchedFile).href)
    expect(markdown).toContain(touchedFile.replace(/\\/g, '\\\\'))
  })
})
