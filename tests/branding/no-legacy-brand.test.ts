import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { APP } from '../../src/config/app.js'
import { getSwoopDirectory } from '../../src/core/project/claude-paths.js'

const LEGACY_NAME = ['c', 'c', 'm'].join('')
const REPOSITORY_ROOT = process.cwd()
const PUBLIC_DOCUMENTS = ['CHANGELOG.md', 'CLAUDE.md', 'README.md', 'ROADMAP.md']
const PUBLIC_DIRECTORIES = ['Documents', 'src']

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
    const publicSurfaceFiles = [
      ...PUBLIC_DOCUMENTS,
      ...(await Promise.all(PUBLIC_DIRECTORIES.map(listRepositoryFiles))).flat(),
    ]

    for (const filePath of publicSurfaceFiles) {
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

async function listRepositoryFiles(relativeDirectory: string): Promise<string[]> {
  const entries = await readdir(join(REPOSITORY_ROOT, relativeDirectory), { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const relativePath = join(relativeDirectory, entry.name)

    if (entry.isDirectory()) {
      files.push(...(await listRepositoryFiles(relativePath)))
    } else if (entry.isFile()) {
      files.push(relativePath)
    }
  }

  return files
}
