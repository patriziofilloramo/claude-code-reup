import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const extensionSource = readFileSync('extension/src/extension.ts', 'utf8')
const statusBarSource = readFileSync('extension/src/status-bar.ts', 'utf8')
const manifest = JSON.parse(readFileSync('extension/package.json', 'utf8')) as {
  scripts: Record<string, string>
  version: string
}
const vscodeIgnore = readFileSync('extension/.vscodeignore', 'utf8')

describe('VS Code product quality guardrails', () => {
  it('keeps the status bar contextual and transcript-backed', () => {
    expect(statusBarSource).toContain('this.visible')
    expect(statusBarSource).toContain('summary.activeCount === 0 && summary.attentionCount === 0')
    expect(statusBarSource).toContain('formatContextTokens')
    expect(statusBarSource).not.toContain('accountUsage')
    expect(extensionSource).toContain('statusBar.setVisible(event.visible)')
    expect(extensionSource).toContain('statusBar.update(model)')
  })

  it('produces a pre-1.0 installable VSIX with smoke-test support', () => {
    expect(manifest.version).toBe('0.1.0')
    expect(manifest.scripts['package:vsix']).toContain('vsce package')
    expect(manifest.scripts['smoke:host']).toContain('run-smoke.mjs')
    expect(vscodeIgnore).toContain('node_modules/**')
    expect(vscodeIgnore).toContain('dist/smoke-test.cjs')
  })
})
