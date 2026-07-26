import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { readUserPrefsSync, writeUserPrefsSync } from '../../src/core/user-prefs.js'

const LEGACY_PRIVATE_DIR = ['swo', 'op'].join('')

describe('user preferences', () => {
  let originalClaudeDirectory: string | undefined
  let temporaryClaudeDirectory: string

  beforeEach(async () => {
    temporaryClaudeDirectory = await mkdtemp(join(tmpdir(), 'reup-prefs-test-'))
    originalClaudeDirectory = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = temporaryClaudeDirectory
    await mkdir(join(temporaryClaudeDirectory, 'reup'), { recursive: true })
  })

  afterEach(async () => {
    if (originalClaudeDirectory === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalClaudeDirectory
    await rm(temporaryClaudeDirectory, { force: true, recursive: true })
  })

  it('falls back to safe defaults for unsupported persisted values', async () => {
    await writeFile(
      join(temporaryClaudeDirectory, 'reup', 'prefs.json'),
      JSON.stringify({ autoCleanupOnStart: 'delete-everything', theme: '"><script>' })
    )

    expect(readUserPrefsSync()).toEqual({
      theme: 'dark',
    })
  })

  it('ignores removed preferences instead of keeping them dormant', async () => {
    await writeFile(
      join(temporaryClaudeDirectory, 'reup', 'prefs.json'),
      JSON.stringify({
        advancedDiscovery: 'on',
        autoCleanupOnStart: 'auto',
        crossDeviceSessionStorage: 'on',
        experimentalSharedSync: 'on',
        projectSearchPaths: ['/tmp/projects'],
        theme: 'dark',
      })
    )

    expect(readUserPrefsSync()).toEqual({ theme: 'dark' })
  })

  it('creates private preferences and repairs an older permissive file mode', async () => {
    const reupDirectory = join(temporaryClaudeDirectory, 'reup')
    const preferencesPath = join(reupDirectory, 'prefs.json')
    await writeFile(preferencesPath, JSON.stringify({ theme: 'dark' }))
    if (process.platform !== 'win32') await chmod(preferencesPath, 0o644)

    writeUserPrefsSync({ theme: 'light' })

    expect(readUserPrefsSync()).toEqual({ theme: 'light' })
    if (process.platform !== 'win32') {
      expect((await stat(reupDirectory)).mode & 0o777).toBe(0o700)
      expect((await stat(preferencesPath)).mode & 0o777).toBe(0o600)
    }
  })

  it('copies legacy private app data into the Reup directory on first read', async () => {
    await rm(join(temporaryClaudeDirectory, 'reup'), { force: true, recursive: true })
    await mkdir(join(temporaryClaudeDirectory, LEGACY_PRIVATE_DIR), { recursive: true })
    await writeFile(
      join(temporaryClaudeDirectory, LEGACY_PRIVATE_DIR, 'prefs.json'),
      JSON.stringify({ theme: 'terminal' })
    )

    expect(readUserPrefsSync().theme).toBe('terminal')
    expect(await readFile(join(temporaryClaudeDirectory, 'reup', 'prefs.json'), 'utf8')).toContain(
      'terminal'
    )
    expect(
      await readFile(join(temporaryClaudeDirectory, LEGACY_PRIVATE_DIR, 'prefs.json'), 'utf8')
    ).toContain('terminal')
  })
})
