import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  isAttentionHookConfigured,
  removeAttentionHook,
  setupAttentionHook,
} from '../../src/core/session/attention-hooks-integration.js'

describe('attention hook integration', () => {
  let claudeDirectory: string
  let previousConfigDir: string | undefined

  beforeEach(async () => {
    claudeDirectory = await mkdtemp(join(tmpdir(), 'reup-attention-hook-test-'))
    previousConfigDir = process.env['CLAUDE_CONFIG_DIR']
    process.env['CLAUDE_CONFIG_DIR'] = claudeDirectory
  })

  afterEach(async () => {
    if (previousConfigDir === undefined) delete process.env['CLAUDE_CONFIG_DIR']
    else process.env['CLAUDE_CONFIG_DIR'] = previousConfigDir
    await rm(claudeDirectory, { force: true, recursive: true })
  })

  it('registers exactly one Notification hook entry and is idempotent', async () => {
    const first = await setupAttentionHook()
    expect(first.changed).toBe(true)
    expect(await isAttentionHookConfigured()).toBe(true)

    const second = await setupAttentionHook()
    expect(second).toEqual({ changed: false, reason: 'already-configured' })

    const settings = await readSettings()
    const notification = hooksOf(settings)
    expect(notification).toHaveLength(1)
    expect(JSON.stringify(notification[0])).toContain('attention capture')
  })

  it('preserves hooks the user configured themselves', async () => {
    const userHook = { hooks: [{ command: 'notify-send done', type: 'command' }] }
    await writeSettings({
      hooks: { Notification: [userHook], Stop: [{ hooks: [] }] },
      statusLine: { command: 'existing', type: 'command' },
    })

    await setupAttentionHook()
    let settings = await readSettings()
    expect(hooksOf(settings)).toHaveLength(2)
    expect(hooksOf(settings)[0]).toEqual(userHook)

    const removal = await removeAttentionHook()
    expect(removal.changed).toBe(true)

    settings = await readSettings()
    expect(hooksOf(settings)).toEqual([userHook])
    expect((settings['hooks'] as Record<string, unknown>)['Stop']).toEqual([{ hooks: [] }])
    expect(settings['statusLine']).toEqual({ command: 'existing', type: 'command' })
    expect(await isAttentionHookConfigured()).toBe(false)
  })

  it('removes the Notification list entirely when Reup owned its only entry', async () => {
    await setupAttentionHook()
    await removeAttentionHook()

    const settings = await readSettings()
    expect(settings['hooks']).toBeUndefined()
  })

  it('reports not-configured when nothing was ever installed', async () => {
    expect(await removeAttentionHook()).toEqual({ changed: false, reason: 'not-configured' })
    expect(await isAttentionHookConfigured()).toBe(false)
  })

  async function readSettings(): Promise<Record<string, unknown>> {
    return JSON.parse(await readFile(join(claudeDirectory, 'settings.json'), 'utf8'))
  }

  async function writeSettings(value: unknown): Promise<void> {
    await mkdir(claudeDirectory, { recursive: true })
    await writeFile(join(claudeDirectory, 'settings.json'), JSON.stringify(value))
  }

  function hooksOf(settings: Record<string, unknown>): unknown[] {
    const hooks = settings['hooks'] as Record<string, unknown> | undefined
    return (hooks?.['Notification'] as unknown[]) ?? []
  }
})
