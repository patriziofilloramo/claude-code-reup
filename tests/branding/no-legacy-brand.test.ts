import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { APP } from '../../src/config/app.js'
import { getSwoopDirectory } from '../../src/core/project/claude-paths.js'

const LEGACY_NAME = ['c', 'c', 'm'].join('')
const REPOSITORY_ROOT = process.cwd()

describe('Swoop branding', () => {
  it('publishes the canonical package and executable names', async () => {
    const packageJson = JSON.parse(await readRepositoryFile('package.json')) as {
      bin: Record<string, string>
      name: string
    }

    expect(packageJson.name).toBe('claude-code-swoop')
    expect(packageJson.bin).toEqual({ swoop: './dist/index.js' })
  })

  it('uses Swoop identifiers for persistent data and environment variables', () => {
    expect(getSwoopDirectory()).toMatch(/[\\/]swoop$/)
    expect(APP.cloudLinkFile).toBe('.swoop-link')
    expect(APP.debugEnvVar).toBe('SWOOP_DEBUG')
    expect(APP.noOpenEnvVar).toBe('SWOOP_NO_OPEN')
    expect(APP.portEnvVar).toBe('SWOOP_PORT')
  })

  it('does not expose the legacy name in critical public surfaces', async () => {
    const criticalFiles = [
      'src/cli/completion-command.ts',
      'src/config/labels.ts',
      'src/config/theme.ts',
      'src/core/project/project-sidecar-lock.ts',
      'src/core/session/session-metadata.ts',
      'src/web/ui.html',
    ]

    for (const filePath of criticalFiles) {
      expect(await readRepositoryFile(filePath), filePath).not.toContain(LEGACY_NAME)
    }
  })

  it('uses the canonical sidecar, theme environment variable, and web title', async () => {
    expect(await readRepositoryFile('src/core/session/session-metadata.ts')).toContain('swoop.json')
    expect(await readRepositoryFile('src/config/theme.ts')).toContain('SWOOP_THEME')
    expect(await readRepositoryFile('src/web/ui.html')).toContain('<title>Swoop</title>')
  })
})

function readRepositoryFile(relativePath: string): Promise<string> {
  return readFile(join(REPOSITORY_ROOT, relativePath), 'utf8')
}
