import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const extensionSource = readFileSync('extension/src/extension.ts', 'utf8')
const detailSource = readFileSync('extension/src/session-detail.ts', 'utf8')
const inspectorHtmlSource = readFileSync('extension/src/inspector-html.ts', 'utf8')
const loggerSource = readFileSync('extension/src/logger.ts', 'utf8')
const manifest = JSON.parse(readFileSync('extension/package.json', 'utf8')) as {
  activationEvents: string[]
}
const treeSource = readFileSync('extension/src/session-tree.ts', 'utf8')

describe('VS Code extension lifecycle guardrails', () => {
  it('registers long-lived providers and logger as disposables', () => {
    expect(loggerSource).toContain('export interface SwoopLogger extends vscode.Disposable')
    expect(treeSource).toContain('implements vscode.TreeDataProvider<TreeNode>, vscode.Disposable')
    expect(detailSource).toContain('implements vscode.WebviewViewProvider, vscode.Disposable')
    expect(extensionSource).toContain('logger,')
    expect(extensionSource).toContain('inspectorProvider,')
    expect(extensionSource).toContain('treeProvider,')
  })

  it('drops preview state and webview resources on disposal', () => {
    expect(detailSource).toContain('this.previewCache.clear()')
    expect(detailSource).toContain('this.view = null')
    expect(detailSource).toContain('for (const disposable of this.viewDisposables.splice(0))')
  })

  it('does not rebuild the Inspector DOM or apply stale previews on every refresh', () => {
    expect(detailSource).toContain('private lastRenderKey: string | null = null')
    expect(detailSource).toContain('if (this.lastRenderKey === renderKey) return')
    expect(detailSource).toContain('const requestId = ++this.renderRequestId')
    expect(detailSource).toContain('if (requestId !== this.renderRequestId')
    expect(extensionSource).toContain('inspectorProvider.refreshSelected(model.sessions)')
  })

  it('opens a focused Inspector with strict message validation', () => {
    expect(detailSource).toContain("const INSPECTOR_VIEW_ID = 'swoop.inspector'")
    expect(extensionSource).toContain('registerWebviewViewProvider')
    expect(detailSource).toContain('isInspectorMessage(message)')
    expect(inspectorHtmlSource).toContain("default-src 'none'")
  })

  it('activates for tree context commands as well as top-level commands', () => {
    expect(manifest.activationEvents).toEqual(
      expect.arrayContaining([
        'onCommand:swoop.tree.copySessionId',
        'onCommand:swoop.tree.resumeSession',
        'onCommand:swoop.tree.revealProjectFolder',
      ])
    )
  })
})
