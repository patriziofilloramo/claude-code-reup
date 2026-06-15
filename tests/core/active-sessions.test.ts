import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { getActiveSessions } from '../../src/core/active-sessions.js'

const LIVE_SESSION_ID = '11111111-1111-4111-8111-111111111111'
const DEAD_SESSION_ID = '22222222-2222-4222-8222-222222222222'

describe('getActiveSessions', () => {
  let activeSessionsDirectory: string
  let originalClaudeConfigDirectory: string | undefined
  let temporaryClaudeDirectory: string

  beforeEach(async () => {
    temporaryClaudeDirectory = await mkdtemp(join(tmpdir(), 'ccm-active-test-'))
    activeSessionsDirectory = join(temporaryClaudeDirectory, 'sessions')
    originalClaudeConfigDirectory = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = temporaryClaudeDirectory
  })

  afterEach(async () => {
    if (originalClaudeConfigDirectory === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDirectory
    await rm(temporaryClaudeDirectory, { force: true, recursive: true })
  })

  it('returns empty set when sessions directory does not exist', async () => {
    const activeSessionIds = await getActiveSessions()
    expect(activeSessionIds.size).toBe(0)
  })

  it('includes session whose PID is the current process', async () => {
    await mkdir(activeSessionsDirectory, { recursive: true })
    await writeFile(
      join(activeSessionsDirectory, 'live.json'),
      JSON.stringify({ sessionId: LIVE_SESSION_ID, pid: process.pid })
    )
    const activeSessionIds = await getActiveSessions()
    expect(activeSessionIds.has(LIVE_SESSION_ID)).toBe(true)
  })

  it('excludes session with a dead PID on Unix', async () => {
    if (process.platform === 'win32') return // Windows EPERM semantics differ
    await mkdir(activeSessionsDirectory, { recursive: true })
    await writeFile(
      join(activeSessionsDirectory, 'dead.json'),
      JSON.stringify({ sessionId: DEAD_SESSION_ID, pid: 2147483647 })
    )
    const activeSessionIds = await getActiveSessions()
    expect(activeSessionIds.has(DEAD_SESSION_ID)).toBe(false)
  })

  it('skips files with missing required fields', async () => {
    await mkdir(activeSessionsDirectory, { recursive: true })
    await writeFile(
      join(activeSessionsDirectory, 'no-pid.json'),
      JSON.stringify({ sessionId: 'x' })
    )
    await writeFile(
      join(activeSessionsDirectory, 'no-session.json'),
      JSON.stringify({ pid: process.pid })
    )
    const activeSessionIds = await getActiveSessions()
    expect(activeSessionIds.size).toBe(0)
  })

  it('skips non-JSON and malformed files', async () => {
    await mkdir(activeSessionsDirectory, { recursive: true })
    await writeFile(join(activeSessionsDirectory, 'garbage.json'), 'not json at all')
    await writeFile(join(activeSessionsDirectory, 'ignore.txt'), '{"sessionId":"x","pid":1}')
    const activeSessionIds = await getActiveSessions()
    expect(activeSessionIds.size).toBe(0)
  })

  it('skips live lock records with an invalid session ID', async () => {
    await mkdir(activeSessionsDirectory, { recursive: true })
    await writeFile(
      join(activeSessionsDirectory, 'invalid-id.json'),
      JSON.stringify({ sessionId: '../../outside', pid: process.pid })
    )

    const activeSessionIds = await getActiveSessions()

    expect(activeSessionIds.size).toBe(0)
  })
})
