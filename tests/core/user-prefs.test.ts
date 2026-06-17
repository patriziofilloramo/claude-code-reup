import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { readUserPrefsSync } from '../../src/core/user-prefs.js'

describe('user preferences', () => {
  let originalClaudeDirectory: string | undefined
  let temporaryClaudeDirectory: string

  beforeEach(async () => {
    temporaryClaudeDirectory = await mkdtemp(join(tmpdir(), 'swoop-prefs-test-'))
    originalClaudeDirectory = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = temporaryClaudeDirectory
    await mkdir(join(temporaryClaudeDirectory, 'swoop'), { recursive: true })
  })

  afterEach(async () => {
    if (originalClaudeDirectory === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalClaudeDirectory
    await rm(temporaryClaudeDirectory, { force: true, recursive: true })
  })

  it('falls back to safe defaults for unsupported persisted values', async () => {
    await writeFile(
      join(temporaryClaudeDirectory, 'swoop', 'prefs.json'),
      JSON.stringify({ autoCleanupOnStart: 'delete-everything', theme: '"><script>' })
    )

    expect(readUserPrefsSync()).toEqual({
      autoCleanupOnStart: 'off',
      crossDeviceSessionStorage: 'off',
      theme: 'dark',
    })
  })

  it('migrates the old experimental sync flag to the cross-device storage preference', async () => {
    await writeFile(
      join(temporaryClaudeDirectory, 'swoop', 'prefs.json'),
      JSON.stringify({ experimentalSharedSync: 'on', theme: 'dark' })
    )

    expect(readUserPrefsSync().crossDeviceSessionStorage).toBe('on')
  })
})
