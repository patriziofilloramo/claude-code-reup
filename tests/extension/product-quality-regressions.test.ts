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
const activityBarIcon = readFileSync('extension/media/reup.svg', 'utf8')
const brandIcon = readFileSync('extension/media/reup-brand.svg', 'utf8')
const brandIconPng = readFileSync('extension/media/reup-brand.png')
const brandSource = readFileSync('src/brand.ts', 'utf8')
const brandGenerator = readFileSync('extension/scripts/generate-brand-assets.mjs', 'utf8')
const marketplaceGenerator = readFileSync(
  'extension/scripts/generate-marketplace-assets.mjs',
  'utf8'
)
const packageVsixSource = readFileSync('extension/scripts/package-vsix.mjs', 'utf8')
const extensionReadme = readFileSync('extension/README.md', 'utf8')
const dashboardWorkflow = readFileSync('extension/media/marketplace/dashboard-workflow.gif')
const workspaceCockpit = readFileSync('extension/media/marketplace/workspace-cockpit.png')

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
    expect(vscodeIgnore).toContain('README.md')
    expect(vscodeIgnore).toContain('media/marketplace/**')
  })

  it('generates every extension icon from the canonical Reup mark', () => {
    expect(manifest.displayName).toBe('Reup for Claude Code')
    expect(manifest.icon).toBe('media/reup-brand.png')
    expect(manifest.scripts['generate:brand']).toContain('generate-brand-assets.mjs')
    expect(manifest.scripts.compile).toContain('generate:brand')
    expect(brandGenerator).toContain('readBrandDefinition')
    expect(brandGenerator).toContain("'reup-brand.svg'")
    expect(brandGenerator).toContain("'reup-brand.png'")
    expect(brandGenerator).toContain("'reup.svg'")

    const canonicalPath = brandSource.match(/export const REUP_PATH\s*=\s*['"]([^'"]+)['"]/)?.[1]
    const accentPath = brandSource.match(
      /export const REUP_ACCENT_PATH\s*=\s*['"]([^'"]+)['"]/
    )?.[1]
    expect(canonicalPath).toBeTruthy()
    expect(accentPath).toBeTruthy()
    expect(activityBarIcon).toContain('viewBox="0 0 256 256"')
    expect(activityBarIcon).toContain(`d="${canonicalPath}"`)
    expect(activityBarIcon).toContain(`d="${accentPath}"`)
    expect(activityBarIcon).toContain('<rect')
    expect(activityBarIcon).toContain('rx="44"')
    expect(brandIcon).toContain('fill="#101315"')
    expect(brandIcon).toContain(`fill="#47D7A1" d="${canonicalPath}"`)
    expect(brandIcon).toContain(`fill="#F0B85A" d="${accentPath}"`)
    expect(brandIcon.match(/<path/g)).toHaveLength(2)
    expect(brandIconPng.subarray(1, 4).toString('ascii')).toBe('PNG')
  })

  it('keeps the marketplace page credible until public HTTPS media exists', () => {
    expect(manifest.scripts['generate:marketplace']).toContain('generate-marketplace-assets.mjs')
    expect(manifest.scripts.compile).toContain('generate:marketplace')
    expect(marketplaceGenerator).toContain('readBrandDefinition')
    expect(marketplaceGenerator).toContain('dashboard-workflow.gif')
    expect(marketplaceGenerator).toContain('workspace-cockpit.png')
    expect(extensionReadme).toContain('Reup for Claude Code')
    expect(extensionReadme).toContain('local control surface')
    expect(extensionReadme).toContain('Reup: Open Dashboard')
    expect(extensionReadme).toContain('All command IDs use the `reup.*` namespace')
    expect(extensionReadme).not.toContain('media/marketplace/dashboard-workflow.gif')
    expect(extensionReadme).not.toContain('media/marketplace/workspace-cockpit.png')
    expect(extensionReadme).not.toContain('data:image')
    expect(extensionReadme).not.toContain('raw.githubusercontent.com')
    expect(extensionReadme).not.toContain('canonical mark')
    expect(packageVsixSource).not.toContain('buildPackagedReadme')
    expect(packageVsixSource).not.toContain("'--readme-path'")
    expect(packageVsixSource).not.toContain("'--no-rewrite-relative-links'")
    expect(packageVsixSource).not.toContain('.README.vsix.md')
    expect(packageVsixSource).toContain('process.execPath')
    expect(packageVsixSource).toContain('shell: false')
    expect(packageVsixSource).not.toContain('vsce.cmd')
    expect(dashboardWorkflow.subarray(0, 6).toString('ascii')).toMatch(/^GIF8[79]a$/)
    expect(workspaceCockpit.subarray(1, 4).toString('ascii')).toBe('PNG')
  })
})
