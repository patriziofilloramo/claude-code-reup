import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  hookScriptPath,
  inspectAttentionHookHealth,
  isAttentionHookConfigured,
  removeAttentionHook,
  ensureAttentionHook,
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

  it('registers one entry per hook event and is idempotent', async () => {
    const first = await setupAttentionHook()
    expect(first.changed).toBe(true)
    expect(await isAttentionHookConfigured()).toBe(true)

    const second = await setupAttentionHook()
    expect(second).toEqual({ changed: false, reason: 'already-configured' })

    const settings = await readSettings()
    for (const hookEvent of ['Notification', 'Stop', 'UserPromptSubmit']) {
      const entries = hooksOf(settings, hookEvent)
      expect(entries).toHaveLength(1)
      expect(JSON.stringify(entries[0])).toContain('attention capture')
    }
  })

  /**
   * Observed on a real machine: the hooks pointed at an npm-linked install on
   * a drive that was no longer mounted. Claude Code kept running the command,
   * node kept failing, and nothing reported it for three weeks — every turn
   * boundary and needs-input alert silently lost, while `status` reported the
   * hooks configured. Registration alone was never proof they worked.
   */
  it('reports registered hooks as broken when their script no longer exists', async () => {
    await setupAttentionHook()
    expect(await inspectAttentionHookHealth()).toMatchObject({ state: 'ready' })
    // Still registered by the settings check, which is exactly the blind spot.
    expect(await isAttentionHookConfigured()).toBe(true)

    const { goneCommand, gonePath } = await breakInstalledCommand()

    expect(await isAttentionHookConfigured()).toBe(true)
    expect(await inspectAttentionHookHealth()).toEqual({
      command: goneCommand,
      missingPath: gonePath,
      state: 'broken',
    })
  })

  /**
   * The path in a hook entry goes stale for ordinary reasons — a Node version
   * manager moves the npm global root, an installer relocates — and the
   * failure is silent, so waiting for the user to notice cost three weeks
   * once. Repair maintains an entry the user already consented to.
   */
  it('repoints its own hooks at the running install when their script is gone', async () => {
    await setupAttentionHook()
    await breakInstalledCommand()
    expect(await inspectAttentionHookHealth()).toMatchObject({ state: 'broken' })

    expect(await ensureAttentionHook()).toBe('repaired')
    expect(await inspectAttentionHookHealth()).toMatchObject({ state: 'ready' })

    // Repaired, not stacked: still exactly one Reup entry per event.
    const settings = await readSettings()
    for (const hookEvent of ['Notification', 'Stop', 'UserPromptSubmit']) {
      expect(hooksOf(settings, hookEvent)).toHaveLength(1)
    }
  })

  /**
   * Installing unasked is deliberate, and replaced an earlier rule that never
   * did. Reup reads turn boundaries from these hooks; leaving them to a command
   * the user has to discover meant shipping features that silently did nothing,
   * which is the failure this project keeps rediscovering. It is safe because
   * the entry is Reup's own and appended, and `attention remove` restores the
   * previous configuration exactly — and the surfaces that do it say so.
   */
  it('installs its hooks when none are configured', async () => {
    expect(await inspectAttentionHookHealth()).toEqual({ state: 'not-configured' })

    expect(await ensureAttentionHook()).toBe('installed')
    expect(await inspectAttentionHookHealth()).toMatchObject({ state: 'ready' })
  })

  /**
   * Automatic installation must never overrule an explicit removal, or there
   * is no way to refuse: the next launch would put back exactly what the user
   * just took out.
   */
  it('respects an explicit removal instead of reinstalling', async () => {
    await setupAttentionHook()
    await removeAttentionHook()
    expect(await isAttentionHookConfigured()).toBe(false)

    expect(await ensureAttentionHook()).toBe('unchanged')
    expect(await isAttentionHookConfigured()).toBe(false)

    // Asking for them back is still an explicit act, and it sticks.
    await setupAttentionHook()
    expect(await isAttentionHookConfigured()).toBe(true)
    expect(await ensureAttentionHook()).toBe('unchanged')
  })

  it('leaves healthy hooks and the settings file completely alone', async () => {
    await setupAttentionHook()
    const before = JSON.stringify(await readSettings())

    expect(await ensureAttentionHook()).toBe('unchanged')
    expect(JSON.stringify(await readSettings())).toBe(before)
  })

  it('reads the script path only from a command Reup itself wrote', async () => {
    expect(hookScriptPath('node "C:/a/dist/index.js" attention capture')).toBe('C:/a/dist/index.js')
    // A command Reup did not write is not Reup's to judge: null means "cannot
    // check", and must never be reported as a broken install.
    expect(hookScriptPath('some-other-tool --notify')).toBeNull()
    expect(hookScriptPath('node "C:/a/dist/index.js" something else')).toBeNull()
  })

  it('repairs a partially registered integration without duplicating entries', async () => {
    await setupAttentionHook()
    // Simulate the user (or an older Reup) removing one of the three events.
    const settings = await readSettings()
    delete (settings['hooks'] as Record<string, unknown>)['Stop']
    await writeSettings(settings)
    expect(await isAttentionHookConfigured()).toBe(false)

    const repair = await setupAttentionHook()
    expect(repair.changed).toBe(true)
    expect(await isAttentionHookConfigured()).toBe(true)
    expect(hooksOf(await readSettings(), 'Notification')).toHaveLength(1)
  })

  it('preserves hooks the user configured themselves', async () => {
    const userHook = { hooks: [{ command: 'notify-send done', type: 'command' }] }
    const userStopHook = { hooks: [{ command: 'echo done', type: 'command' }] }
    await writeSettings({
      hooks: { Notification: [userHook], Stop: [userStopHook] },
      statusLine: { command: 'existing', type: 'command' },
    })

    await setupAttentionHook()
    let settings = await readSettings()
    expect(hooksOf(settings, 'Notification')).toHaveLength(2)
    expect(hooksOf(settings, 'Notification')[0]).toEqual(userHook)
    expect(hooksOf(settings, 'Stop')).toHaveLength(2)
    expect(hooksOf(settings, 'Stop')[0]).toEqual(userStopHook)

    const removal = await removeAttentionHook()
    expect(removal.changed).toBe(true)

    settings = await readSettings()
    expect(hooksOf(settings, 'Notification')).toEqual([userHook])
    expect(hooksOf(settings, 'Stop')).toEqual([userStopHook])
    expect((settings['hooks'] as Record<string, unknown>)['UserPromptSubmit']).toBeUndefined()
    expect(settings['statusLine']).toEqual({ command: 'existing', type: 'command' })
    expect(await isAttentionHookConfigured()).toBe(false)
  })

  it('removes the hooks object entirely when Reup owned every entry', async () => {
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

  /** Repoints the registered hooks at a script path that does not exist. */
  async function breakInstalledCommand(): Promise<{ goneCommand: string; gonePath: string }> {
    const integrationPath = join(claudeDirectory, 'reup', 'attention-integration.json')
    const integration = JSON.parse(await readFile(integrationPath, 'utf8')) as Record<
      string,
      unknown
    >
    const gonePath = join(claudeDirectory, 'gone', 'dist', 'index.js').replaceAll('\\', '/')
    const goneCommand = `node "${gonePath}" attention capture`
    await writeFile(
      integrationPath,
      JSON.stringify({ ...integration, installedCommand: goneCommand }),
      'utf8'
    )
    const settings = await readSettings()
    for (const hookEvent of ['Notification', 'Stop', 'UserPromptSubmit']) {
      const entry = hooksOf(settings, hookEvent)[0] as { hooks: { command: string }[] }
      entry.hooks[0]!.command = goneCommand
    }
    await writeSettings(settings)
    return { goneCommand, gonePath }
  }

  async function writeSettings(value: unknown): Promise<void> {
    await mkdir(claudeDirectory, { recursive: true })
    await writeFile(join(claudeDirectory, 'settings.json'), JSON.stringify(value))
  }

  function hooksOf(settings: Record<string, unknown>, hookEvent = 'Notification'): unknown[] {
    const hooks = settings['hooks'] as Record<string, unknown> | undefined
    return (hooks?.[hookEvent] as unknown[]) ?? []
  }
})
