import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { readUserPrefsSync } from '../../src/core/user-prefs.js'

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
      advancedDiscovery: 'off',
      autoCleanupOnStart: 'off',
      crossDeviceSessionStorage: 'off',
      projectSearchPaths: [],
      theme: 'dark',
    })
  })

  it('migrates the old experimental sync flag to the cross-device storage preference', async () => {
    await writeFile(
      join(temporaryClaudeDirectory, 'reup', 'prefs.json'),
      JSON.stringify({ experimentalSharedSync: 'on', theme: 'dark' })
    )

    expect(readUserPrefsSync().crossDeviceSessionStorage).toBe('on')
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
