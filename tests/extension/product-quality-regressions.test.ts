import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const extensionSource = readFileSync('extension/src/extension.ts', 'utf8')
const statusBarSource = readFileSync('extension/src/status-bar.ts', 'utf8')
const manifest = JSON.parse(readFileSync('extension/package.json', 'utf8')) as {
  displayName: string
  icon: string
  scripts: Record<string, string>
  version: string
}
const vscodeIgnore = readFileSync('extension/.vscodeignore', 'utf8')
const activityBarIcon = readFileSync('extension/media/swoop.svg', 'utf8')
const brandIcon = readFileSync('extension/media/swoop-brand.svg', 'utf8')
const brandIconPng = readFileSync('extension/media/swoop-brand.png')

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
    expect(manifest.version).toMatch(/^0\.\d+\.\d+$/)
    expect(manifest.scripts['install:local']).toContain('install-local.mjs')
    expect(manifest.scripts['package:vsix']).toContain('package-vsix.mjs')
    expect(manifest.scripts['smoke:host']).toContain('run-smoke.mjs')
    expect(vscodeIgnore).toContain('node_modules/**')
    expect(vscodeIgnore).toContain('dist/smoke-test.cjs')
  })

  it('ships distinct Activity Bar and installable brand icons', () => {
    expect(manifest.displayName).toBe('Swoop for Claude Code')
    expect(manifest.icon).toBe('media/swoop-brand.png')
    expect(activityBarIcon).toContain('viewBox="0 0 256 256"')
    expect(activityBarIcon).not.toContain('<rect')
    expect(brandIcon).toContain('fill="#E68465"')
    expect(brandIcon).toContain('fill="#8AD9E8"')
    expect(brandIconPng.subarray(1, 4).toString('ascii')).toBe('PNG')
  })
})
