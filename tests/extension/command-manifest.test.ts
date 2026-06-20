import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const extensionSource = readFileSync('extension/src/extension.ts', 'utf8')
const manifest = JSON.parse(readFileSync('extension/package.json', 'utf8')) as {
  activationEvents: string[]
  contributes: {
    commands: Array<{ command: string }>
    views: Record<string, Array<{ id: string; type?: string }>>
  }
}

describe('VS Code command manifest', () => {
  it('registers every contributed command and activation event', () => {
    const registeredCommands = new Set(
      [...extensionSource.matchAll(/registerCommand\('([^']+)'/g)].map((match) => match[1])
    )

    for (const { command } of manifest.contributes.commands) {
      expect(registeredCommands, `${command} must be registered`).toContain(command)
      expect(manifest.activationEvents).toContain(`onCommand:${command}`)
    }
  })

  it('declares the focused Session Inspector as a webview', () => {
    expect(manifest.contributes.views['swoop']).toContainEqual(
      expect.objectContaining({ id: 'swoop.inspector', type: 'webview' })
    )
    expect(manifest.activationEvents).toContain('onView:swoop.inspector')
  })
})
