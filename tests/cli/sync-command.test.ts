import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { linkProjectForTUI, runSyncCommand } from '../../src/cli/sync-command.js'

const ACTIVE_SESSION_ID = '11111111-1111-4111-8111-111111111111'

describe('sync command safety', () => {
  let originalClaudeConfigDirectory: string | undefined
  let projectPath: string
  let temporaryRoot: string

  beforeEach(async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), 'swoop-sync-command-test-'))
    projectPath = join(temporaryRoot, 'active-project')
    originalClaudeConfigDirectory = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = join(temporaryRoot, 'claude')

    await mkdir(join(process.env.CLAUDE_CONFIG_DIR, 'sessions'), { recursive: true })
    await mkdir(projectPath)
    await writeFile(
      join(process.env.CLAUDE_CONFIG_DIR, 'sessions', 'active.json'),
      JSON.stringify({
        cwd: projectPath,
        pid: process.pid,
        sessionId: ACTIVE_SESSION_ID,
        startedAt: Date.now(),
      })
    )
  })

  afterEach(async () => {
    if (originalClaudeConfigDirectory === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDirectory
    await rm(temporaryRoot, { force: true, recursive: true })
  })

  it('refuses to link an active path even when it is not in the discovered project list', async () => {
    const result = await linkProjectForTUI(projectPath, [])

    expect(result).toEqual({
      ok: false,
      message: 'cannot change sync configuration while this project has an active session',
    })
    await expect(access(join(projectPath, '.claude-memory'))).rejects.toThrow()
  })
})

describe('sync command interface', () => {
  let originalStdinIsTTY: boolean | undefined
  let originalStdoutIsTTY: boolean | undefined

  beforeEach(() => {
    originalStdinIsTTY = process.stdin.isTTY
    originalStdoutIsTTY = process.stdout.isTTY
  })

  afterEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', {
      configurable: true,
      value: originalStdinIsTTY,
    })
    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: originalStdoutIsTTY,
    })
    process.exitCode = undefined
    vi.restoreAllMocks()
  })

  it('fails cleanly outside an interactive terminal instead of starting Ink', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: false })
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: false })
    const writeError = vi.spyOn(console, 'error').mockImplementation(() => {})

    await runSyncCommand([])

    expect(process.exitCode).toBe(1)
    expect(writeError).toHaveBeenCalledWith(
      'swoop: swoop sync requires an interactive terminal; use `swoop sync link <path>` or `swoop sync unlink <path>` in scripts'
    )
  })
})
