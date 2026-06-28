import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  removeUsageStatusLine,
  setupUsageStatusLine,
} from '../../src/core/usage/usage-statusline-integration.js'

describe('usage status-line integration', () => {
  let originalClaudeDirectory: string | undefined
  let temporaryClaudeDirectory: string

  beforeEach(async () => {
    temporaryClaudeDirectory = await mkdtemp(join(tmpdir(), 'reup-statusline-test-'))
    originalClaudeDirectory = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = temporaryClaudeDirectory
  })

  afterEach(async () => {
    if (originalClaudeDirectory === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalClaudeDirectory
    await rm(temporaryClaudeDirectory, { force: true, recursive: true })
  })

  it('installs idempotently and removes a new Reup status line', async () => {
    expect(await setupUsageStatusLine()).toMatchObject({ changed: true, replacedExisting: false })
    expect(await setupUsageStatusLine()).toEqual({
      changed: false,
      reason: 'already-configured',
    })

    const configured = await readSettings()
    expect(configured['statusLine']).toMatchObject({
      command: expect.stringContaining('usage capture'),
      refreshInterval: 10,
      type: 'command',
    })
    expect((configured['statusLine'] as { command: string }).command).not.toContain('\\')

    expect(await removeUsageStatusLine()).toEqual({
      changed: true,
      restoredPrevious: false,
    })
    expect(await readSettings()).not.toHaveProperty('statusLine')
  })

  it('requires explicit replacement and restores the previous value exactly', async () => {
    const previousStatusLine = {
      command: '~/.claude/my-statusline.sh',
      padding: 2,
      refreshInterval: 5,
      type: 'command',
    }
    await writeSettings({ statusLine: previousStatusLine, theme: 'dark' })

    await expect(setupUsageStatusLine()).rejects.toThrow('rerun with --replace')
    expect(await readSettings()).toEqual({ statusLine: previousStatusLine, theme: 'dark' })

    expect(await setupUsageStatusLine(true)).toMatchObject({
      changed: true,
      replacedExisting: true,
    })
    expect(await removeUsageStatusLine()).toEqual({
      changed: true,
      restoredPrevious: true,
    })
    expect(await readSettings()).toEqual({ statusLine: previousStatusLine, theme: 'dark' })
  })

  it('refreshes a Reup-owned command after the executable path changes', async () => {
    const previousStatusLine = { command: 'original-statusline', type: 'command' }
    const oldCcmCommand = 'node "/old/location/index.js" usage capture'
    await writeSettings({ statusLine: { command: oldCcmCommand, type: 'command' } })
    await mkdir(join(temporaryClaudeDirectory, 'reup'), { recursive: true })
    await writeFile(
      join(temporaryClaudeDirectory, 'reup', 'statusline-integration.json'),
      JSON.stringify({
        hadPreviousStatusLine: true,
        installedCommand: oldCcmCommand,
        previousStatusLine,
        schemaVersion: 1,
      })
    )

    await expect(setupUsageStatusLine()).resolves.toMatchObject({
      changed: true,
      replacedExisting: true,
    })
    expect((await readSettings())['statusLine']).toMatchObject({
      command: expect.not.stringContaining('/old/location/'),
      type: 'command',
    })

    await removeUsageStatusLine()
    expect(await readSettings()).toEqual({ statusLine: previousStatusLine })
  })

  it('upgrades a Reup-owned status line that predates periodic refresh', async () => {
    await setupUsageStatusLine()
    const configured = await readSettings()
    const statusLine = configured['statusLine'] as { command: string; type: 'command' }
    await writeSettings({ statusLine: { command: statusLine.command, type: statusLine.type } })

    await expect(setupUsageStatusLine()).resolves.toMatchObject({
      changed: true,
      replacedExisting: false,
    })
    expect((await readSettings())['statusLine']).toMatchObject({
      command: statusLine.command,
      refreshInterval: 10,
      type: 'command',
    })
  })

  it('refuses to overwrite a status line changed after setup', async () => {
    await setupUsageStatusLine()
    await writeSettings({ statusLine: { command: 'new-user-command', type: 'command' } })

    await expect(removeUsageStatusLine()).rejects.toThrow('refusing to overwrite it')
    expect(await readSettings()).toEqual({
      statusLine: { command: 'new-user-command', type: 'command' },
    })
  })

  it('accepts settings written with a UTF-8 byte-order mark', async () => {
    const settingsPath = join(temporaryClaudeDirectory, 'settings.json')
    await mkdir(temporaryClaudeDirectory, { recursive: true })
    await writeFile(settingsPath, `\uFEFF${JSON.stringify({ theme: 'dark' })}`)

    await expect(setupUsageStatusLine()).resolves.toMatchObject({ changed: true })
    await expect(removeUsageStatusLine()).resolves.toMatchObject({ changed: true })
    await expect(readSettings()).resolves.toEqual({ theme: 'dark' })
  })

  async function readSettings(): Promise<Record<string, unknown>> {
    return JSON.parse(
      await readFile(join(temporaryClaudeDirectory, 'settings.json'), 'utf8')
    ) as Record<string, unknown>
  }

  async function writeSettings(settings: Record<string, unknown>): Promise<void> {
    await mkdir(temporaryClaudeDirectory, { recursive: true })
    await writeFile(join(temporaryClaudeDirectory, 'settings.json'), JSON.stringify(settings))
  }
})
