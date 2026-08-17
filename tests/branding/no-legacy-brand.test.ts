import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { APP } from '../../src/config/app.js'
import { getReupDirectory } from '../../src/core/project/claude-paths.js'

const LEGACY_NAME = ['swo', 'op'].join('')
const LEGACY_ENV_PREFIX = ['SW', 'OOP'].join('')
const REPOSITORY_ROOT = process.cwd()
const PUBLIC_DOCUMENTS = ['CHANGELOG.md', 'README.md', 'ROADMAP.md', 'extension/README.md']
const PUBLIC_DIRECTORIES = ['Documents', 'src']

describe('Reup branding', () => {
  it('publishes the canonical package and executable names', async () => {
    const packageJson = JSON.parse(await readRepositoryFile('package.json')) as {
      bin: Record<string, string>
      name: string
    }

    expect(packageJson.name).toBe('@patriziofilloramo/reup')
    expect(packageJson.bin).toEqual({ reup: './dist/index.js' })
  })

  it('publishes the canonical VS Code extension identity', async () => {
    const manifest = JSON.parse(await readRepositoryFile('extension/package.json')) as {
      contributes: {
        commands: Array<{ command: string }>
        viewsContainers: Record<string, unknown>
      }
      displayName: string
      name: string
      publisher: string
    }

    expect(manifest.name).toBe('reup-vscode')
    expect(manifest.displayName).toBe('Reup for Claude Code')
    expect(manifest.publisher).toBe('reup-local')
    expect(Object.keys(manifest.contributes.viewsContainers)).toEqual(['activitybar'])
    expect(manifest.contributes.commands.every((entry) => entry.command.startsWith('reup.'))).toBe(
      true
    )
  })

  it('uses Reup identifiers for persistent data and environment variables', () => {
    expect(getReupDirectory()).toMatch(/[\\/]reup$/)
    expect(APP.debugEnvVar).toBe('REUP_DEBUG')
    expect(APP.legacyDebugEnvVar).toBe(`${LEGACY_ENV_PREFIX}_DEBUG`)
    expect(APP.noOpenEnvVar).toBe('REUP_NO_OPEN')
    expect(APP.legacyNoOpenEnvVar).toBe(`${LEGACY_ENV_PREFIX}_NO_OPEN`)
    expect(APP.portEnvVar).toBe('REUP_PORT')
    expect(APP.legacyPortEnvVar).toBe(`${LEGACY_ENV_PREFIX}_PORT`)
    expect(APP.themeEnvVar).toBe('REUP_THEME')
    expect(APP.legacyThemeEnvVar).toBe(`${LEGACY_ENV_PREFIX}_THEME`)
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
    expect(await readRepositoryFile('src/core/session/session-metadata.ts')).toContain('reup.json')
    expect(APP.themeEnvVar).toBe('REUP_THEME')
    expect(await readRepositoryFile('src/web/ui.html')).toContain('<title>Reup</title>')
  })

  it('keeps hidden migration helpers for browser and VS Code state', async () => {
    const clientConfig = await readRepositoryFile('src/web/client/01-config.js')
    const extensionConfig = await readRepositoryFile('extension/src/configuration.ts')

    expect(clientConfig).toContain("CONFIRM_RESUME_PREFERENCE = 'reup:confirmResume'")
    expect(clientConfig).toContain("RAIL_STORAGE_KEY = 'reup:rail:'")
    expect(clientConfig).toContain('migrateLegacyLocalStorageKeys()')
    expect(extensionConfig).toContain("const CONFIG_SECTION = 'reup'")
    expect(extensionConfig).toContain('getMigratedGlobalState')
  })

  it('uses the Reup restore mark instead of the old S-curve asset direction', async () => {
    const brandSource = await readRepositoryFile('src/brand.ts')

    expect(brandSource).toContain("BRAND_COLOR = '#47D7A1'")
    expect(brandSource).toContain("BRAND_COLOR_DEEP = '#101315'")
    expect(brandSource).toContain("BRAND_COLOR_MID = '#F0B85A'")
    expect(brandSource).toContain('REUP_ACCENT_PATH')
    expect(brandSource).not.toContain('S-curve')
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
