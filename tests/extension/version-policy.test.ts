import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const policySource = readFileSync('scripts/check-extension-version.mjs', 'utf8')
const syncSource = readFileSync('scripts/sync-version.mjs', 'utf8')
const syncCheckSource = readFileSync('scripts/check-version-sync.mjs', 'utf8')
const workflow = readFileSync('.github/workflows/ci.yml', 'utf8')
const rootManifest = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }
const extensionManifest = JSON.parse(readFileSync('extension/package.json', 'utf8')) as {
  version: string
}
const tasks = JSON.parse(readFileSync('.vscode/tasks.json', 'utf8')) as {
  tasks: Array<{ command: string; label: string }>
}

describe('product version release policy', () => {
  it('checks installable product changes against the canonical root version', () => {
    expect(policySource).toContain('sourceMap.sources')
    expect(policySource).toContain("path.startsWith('extension/media/')")
    expect(policySource).toContain("path.startsWith('src/')")
    expect(policySource).toContain('npm run version:patch')
    expect(workflow).toContain('Check product version policy')
    expect(workflow).toContain('PRODUCT_VERSION_BASE')
  })

  it('keeps CLI/TUI/Web and VS Code on one synced product version', () => {
    expect(rootManifest.version).toBe(extensionManifest.version)
    expect(syncSource).toContain('extension/package.json')
    expect(syncSource).toContain('src/config/version.ts')
    expect(syncCheckSource).toContain('Version sync check passed')
  })

  it('offers a one-command local installation task', () => {
    expect(tasks.tasks).toContainEqual(
      expect.objectContaining({
        command: 'npm run install:extension',
        label: 'Install Reup VS Code Extension Locally',
      })
    )
  })
})
