import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const source = readFileSync('extension/src/refresh-controller.ts', 'utf8')
const extensionSource = readFileSync('extension/src/extension.ts', 'utf8')
const manifest = JSON.parse(readFileSync('extension/package.json', 'utf8')) as {
  contributes: { configuration: { properties: Record<string, unknown> } }
}

describe('VS Code refresh controller guardrails', () => {
  it('keeps automatic refresh wiring isolated and disposable', () => {
    expect(source).toContain('implements vscode.Disposable')
    expect(source).toContain('clearInterval')
    expect(source).toContain('clearTimeout')
    expect(source).toContain('watcherDisposables')
    expect(source).toContain('this.watcher?.dispose()')
    expect(source).toContain('pendingRefreshReason')
    expect(extensionSource).toContain('new SwoopRefreshController')
    expect(extensionSource).toContain('refreshController,')
  })

  it('supports manual, watcher, and interval modes from configuration', () => {
    expect(manifest.contributes.configuration.properties['swoop.refreshMode']).toMatchObject({
      default: 'manual',
      enum: ['manual', 'watch', 'interval'],
    })
    expect(source).toContain("configured === 'watch' || configured === 'interval'")
    expect(source).toContain('vscode.workspace.createFileSystemWatcher')
    expect(source).toContain('setInterval')
  })
})
