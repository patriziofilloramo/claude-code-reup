import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const extensionSource = readFileSync('extension/src/extension.ts', 'utf8')
const detailSource = readFileSync('extension/src/session-detail.ts', 'utf8')
const loggerSource = readFileSync('extension/src/logger.ts', 'utf8')
const manifest = JSON.parse(readFileSync('extension/package.json', 'utf8')) as {
  activationEvents: string[]
}
const treeSource = readFileSync('extension/src/session-tree.ts', 'utf8')

describe('VS Code extension lifecycle guardrails', () => {
  it('registers long-lived providers and logger as disposables', () => {
    expect(loggerSource).toContain('export interface SwoopLogger extends vscode.Disposable')
    expect(treeSource).toContain('implements vscode.TreeDataProvider<TreeNode>, vscode.Disposable')
    expect(detailSource).toContain(
      'implements vscode.TextDocumentContentProvider, vscode.Disposable'
    )
    expect(extensionSource).toContain('logger,')
    expect(extensionSource).toContain('detailProvider,')
    expect(extensionSource).toContain('treeProvider,')
  })

  it('drops cached Resume Cards when their virtual document closes', () => {
    expect(detailSource).toContain('onDidCloseTextDocument')
    expect(detailSource).toContain('document.uri.scheme === DETAIL_SCHEME')
    expect(detailSource).toContain('this.sessionsByUri.delete(document.uri.toString())')
    expect(detailSource).toContain('this.sessionsByUri.clear()')
  })

  it('opens Resume Cards as Markdown previews with a raw-document fallback', () => {
    expect(detailSource).toContain("executeCommand('markdown.showPreview', uri)")
    expect(detailSource).toContain('openTextDocument(uri)')
    expect(detailSource).toContain('showTextDocument(document')
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
