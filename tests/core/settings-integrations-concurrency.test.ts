import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  isAttentionHookConfigured,
  removeAttentionHook,
  setupAttentionHook,
} from '../../src/core/session/attention-hooks-integration.js'
import {
  isUsageStatusLineConfigured,
  removeUsageStatusLine,
  setupUsageStatusLine,
} from '../../src/core/usage/usage-statusline-integration.js'

describe('Claude settings integration concurrency', () => {
  let claudeDirectory: string
  let previousConfigDirectory: string | undefined

  beforeEach(async () => {
    claudeDirectory = await mkdtemp(join(tmpdir(), 'reup-settings-concurrency-test-'))
    previousConfigDirectory = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = claudeDirectory
  })

  afterEach(async () => {
    if (previousConfigDirectory === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = previousConfigDirectory
    await rm(claudeDirectory, { force: true, recursive: true })
  })

  it('preserves status-line and attention changes made concurrently', async () => {
    await Promise.all([setupUsageStatusLine(), setupAttentionHook()])

    const settings = await readSettings()
    expect(settings['statusLine']).toMatchObject({ type: 'command' })
    expect(settings['hooks']).toBeDefined()
    await expect(isUsageStatusLineConfigured()).resolves.toBe(true)
    await expect(isAttentionHookConfigured()).resolves.toBe(true)
  })

  it('removes status-line and attention changes concurrently without restoring stale values', async () => {
    await setupUsageStatusLine()
    await setupAttentionHook()

    await Promise.all([removeUsageStatusLine(), removeAttentionHook()])

    const settings = await readSettings()
    expect(settings['statusLine']).toBeUndefined()
    expect(settings['hooks']).toBeUndefined()
    await expect(isUsageStatusLineConfigured()).resolves.toBe(false)
    await expect(isAttentionHookConfigured()).resolves.toBe(false)
  })

  async function readSettings(): Promise<Record<string, unknown>> {
    return JSON.parse(await readFile(join(claudeDirectory, 'settings.json'), 'utf8')) as Record<
      string,
      unknown
    >
  }
})
