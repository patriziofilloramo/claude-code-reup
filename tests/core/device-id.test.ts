import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { getOrCreateDeviceId } from '../../src/core/device-id.js'

describe('getOrCreateDeviceId', () => {
  let claudeDirectory: string
  let originalClaudeDirectory: string | undefined

  beforeEach(async () => {
    claudeDirectory = await mkdtemp(join(tmpdir(), 'ccm-device-id-test-'))
    originalClaudeDirectory = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = claudeDirectory
  })

  afterEach(async () => {
    if (originalClaudeDirectory === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalClaudeDirectory
    await rm(claudeDirectory, { force: true, recursive: true })
  })

  it('returns the OS hostname on first call', async () => {
    const id = await getOrCreateDeviceId()
    expect(id).toBe(hostname())
  })

  it('persists the id to disk so subsequent calls return the same value', async () => {
    const first = await getOrCreateDeviceId()
    const second = await getOrCreateDeviceId()
    expect(second).toBe(first)
  })

  it('writes the id file under the ccm subdirectory', async () => {
    await getOrCreateDeviceId()
    const stored = await readFile(join(claudeDirectory, 'ccm', 'device-id'), 'utf8')
    expect(stored.trim()).toBe(hostname())
  })

  it('reads an existing id file without overwriting it', async () => {
    const customId = 'my-custom-device'
    const ccmDir = join(claudeDirectory, 'ccm')
    await mkdir(ccmDir, { recursive: true })
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(ccmDir, 'device-id'), customId, 'utf8')

    const id = await getOrCreateDeviceId()
    expect(id).toBe(customId)
  })
})
