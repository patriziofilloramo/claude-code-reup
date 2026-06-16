import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const handoffSource = readFileSync('extension/src/handoff.ts', 'utf8')
const extensionSource = readFileSync('extension/src/extension.ts', 'utf8')
const manifest = JSON.parse(readFileSync('extension/package.json', 'utf8')) as {
  activationEvents: string[]
  contributes: {
    commands: Array<{ command: string; title: string }>
    menus: { 'view/item/context': Array<{ command: string; when: string }> }
  }
}

describe('VS Code handoff command guardrails', () => {
  it('registers a session-scoped copy handoff command', () => {
    expect(manifest.activationEvents).toContain('onCommand:swoop.tree.copyHandoff')
    expect(manifest.contributes.commands).toContainEqual(
      expect.objectContaining({
        command: 'swoop.tree.copyHandoff',
        title: 'Copy Handoff',
      })
    )
    expect(manifest.contributes.menus['view/item/context']).toContainEqual(
      expect.objectContaining({
        command: 'swoop.tree.copyHandoff',
        when: 'view == swoop.sessions && viewItem == swoopSession',
      })
    )
    expect(extensionSource).toContain("registerCommand('swoop.tree.copyHandoff'")
  })

  it('reuses core handoff generation and copies only to the clipboard', () => {
    expect(handoffSource).toContain('formatHandoff')
    expect(handoffSource).toContain('readTranscriptHandoffContext')
    expect(handoffSource).toContain('vscode.env.clipboard.writeText')
    expect(handoffSource).not.toContain('writeFile')
    expect(handoffSource).not.toContain('appendFile')
  })
})
