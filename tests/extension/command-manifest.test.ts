import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const extensionSource = readFileSync('extension/src/extension.ts', 'utf8')
const legacyCommandPrefix = ['swo', 'op'].join('')
const manifest = JSON.parse(readFileSync('extension/package.json', 'utf8')) as {
  activationEvents: string[]
  contributes: {
    commands: Array<{ command: string }>
    views: Record<string, Array<{ icon?: string; id: string; type?: string }>>
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

  it('does not expose pre-production command aliases', () => {
    const publicCommandIds = manifest.contributes.commands.map((entry) => entry.command)

    expect(publicCommandIds.every((command) => command.startsWith('reup.'))).toBe(true)
    expect(publicCommandIds.some((command) => command.startsWith(`${legacyCommandPrefix}.`))).toBe(
      false
    )
    expect(extensionSource).not.toContain(`registerCommand('${legacyCommandPrefix}.`)
  })

  it('declares the focused Session Inspector as a webview', () => {
    expect(manifest.contributes.views['reup']).toContainEqual(
      expect.objectContaining({
        icon: 'media/reup.svg',
        id: 'reup.inspector',
        type: 'webview',
      })
    )
    expect(manifest.activationEvents).toContain('onView:reup.inspector')
  })

  it('keeps every Reup view identifiable when users move it', () => {
    for (const view of manifest.contributes.views['reup']) {
      expect(view.icon).toBe('media/reup.svg')
    }
  })
})
