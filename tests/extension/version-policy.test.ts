import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const policySource = readFileSync('scripts/check-extension-version.mjs', 'utf8')
const workflow = readFileSync('.github/workflows/ci.yml', 'utf8')
const tasks = JSON.parse(readFileSync('.vscode/tasks.json', 'utf8')) as {
  tasks: Array<{ command: string; label: string }>
}

describe('VS Code extension release policy', () => {
  it('checks bundled sources and packaged assets against the base version', () => {
    expect(policySource).toContain('sourceMap.sources')
    expect(policySource).toContain("path.startsWith('extension/media/')")
    expect(policySource).toContain('npm version patch --prefix extension')
    expect(workflow).toContain('Check VS Code extension version policy')
    expect(workflow).toContain('EXTENSION_VERSION_BASE')
  })

  it('offers a one-command local installation task', () => {
    expect(tasks.tasks).toContainEqual(
      expect.objectContaining({
        command: 'npm run install:extension',
        label: 'Install Swoop VS Code Extension Locally',
      })
    )
  })
})
