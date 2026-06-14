import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { runCli } from '../../src/cli/run-cli.js'

describe('CLI entrypoint', () => {
  let originalClaudeDirectory: string | undefined
  let temporaryClaudeDirectory: string

  beforeEach(async () => {
    temporaryClaudeDirectory = await mkdtemp(join(tmpdir(), 'ccm-cli-test-'))
    originalClaudeDirectory = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = temporaryClaudeDirectory
    process.exitCode = undefined
  })

  afterEach(async () => {
    if (originalClaudeDirectory === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalClaudeDirectory
    process.exitCode = undefined
    vi.restoreAllMocks()
    await rm(temporaryClaudeDirectory, { force: true, recursive: true })
  })

  it('uses a compact human list by default and JSON only when requested', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await runCli(['list'])
    await runCli(['list', '--json'])

    expect(log).toHaveBeenCalledTimes(2)
    expect(log.mock.calls[0][0]).toBe('No sessions match.')
    expect(JSON.parse(String(log.mock.calls[1][0]))).toMatchObject({
      schemaVersion: 2,
      sessions: [],
    })
    expect(process.exitCode).toBeUndefined()
  })

  it('rejects unknown commands instead of accidentally opening the TUI', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    await runCli(['not-a-command'])

    expect(error).toHaveBeenCalledWith('ccm: unknown command: not-a-command')
    expect(process.exitCode).toBe(1)
  })

  it('rejects invalid command arguments before performing work', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    await runCli(['inbox', 'unexpected'])
    expect(error).toHaveBeenLastCalledWith('ccm: usage: ccm inbox')

    process.exitCode = undefined
    await runCli(['resume', 'not-a-session'])
    expect(error).toHaveBeenLastCalledWith('ccm: invalid or unknown session: not-a-session')
    expect(process.exitCode).toBe(1)
  })

  it('requires a selector for non-interactive resume calls', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    await runCli(['resume'])

    expect(error).toHaveBeenCalledWith(
      'ccm: a session selector is required outside an interactive terminal'
    )
    expect(process.exitCode).toBe(1)
  })

  it('creates a handoff from an unambiguous session prefix', async () => {
    const sessionId = '12345678-0000-0000-0000-000000000001'
    const projectDirectory = join(temporaryClaudeDirectory, 'projects', 'project')
    await mkdir(projectDirectory, { recursive: true })
    await writeFile(
      join(projectDirectory, `${sessionId}.jsonl`),
      [
        JSON.stringify({
          cwd: temporaryClaudeDirectory,
          message: { content: 'Complete the CLI milestone.' },
          timestamp: '2026-06-10T10:00:00.000Z',
          type: 'user',
        }),
        JSON.stringify({
          message: { content: [{ type: 'text', text: 'Implemented the commands.' }] },
          timestamp: '2026-06-10T10:05:00.000Z',
          type: 'assistant',
        }),
      ].join('\n')
    )
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await runCli(['handoff', '12345678'])

    expect(log).toHaveBeenCalledOnce()
    expect(String(log.mock.calls[0][0])).toContain('## Goal\n\nComplete the CLI milestone.')
    expect(process.exitCode).toBeUndefined()
  })

  it('prints exact IDs for shell completion without exposing session content', async () => {
    const sessionId = '12345678-0000-0000-0000-000000000001'
    const projectDirectory = join(temporaryClaudeDirectory, 'projects', 'project')
    await mkdir(projectDirectory, { recursive: true })
    await writeFile(
      join(projectDirectory, `${sessionId}.jsonl`),
      JSON.stringify({
        cwd: temporaryClaudeDirectory,
        message: { content: 'Private session title' },
        timestamp: '2026-06-10T10:00:00.000Z',
        type: 'user',
      })
    )
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await runCli(['__complete-session-ids', '1234'])

    expect(log).toHaveBeenCalledWith(sessionId)
    expect(String(log.mock.calls[0][0])).not.toContain('Private session title')
  })

  it('orders completion IDs by current directory before global active sessions', async () => {
    const currentSessionId = '12345678-0000-0000-0000-000000000001'
    const activeGlobalSessionId = '12345678-0000-0000-0000-000000000002'
    const currentProjectDirectory = join(temporaryClaudeDirectory, 'projects', 'current')
    const globalProjectDirectory = join(temporaryClaudeDirectory, 'projects', 'global')
    const activeSessionsDirectory = join(temporaryClaudeDirectory, 'sessions')
    await Promise.all([
      mkdir(currentProjectDirectory, { recursive: true }),
      mkdir(globalProjectDirectory, { recursive: true }),
      mkdir(activeSessionsDirectory, { recursive: true }),
    ])
    await Promise.all([
      writeFile(
        join(currentProjectDirectory, `${currentSessionId}.jsonl`),
        JSON.stringify({
          cwd: process.cwd(),
          message: { content: 'Current project session' },
          timestamp: '2026-01-01T10:00:00.000Z',
          type: 'user',
        })
      ),
      writeFile(
        join(globalProjectDirectory, `${activeGlobalSessionId}.jsonl`),
        JSON.stringify({
          cwd: temporaryClaudeDirectory,
          message: { content: 'Active global session' },
          timestamp: '2026-06-11T10:00:00.000Z',
          type: 'user',
        })
      ),
      writeFile(
        join(activeSessionsDirectory, 'active.json'),
        JSON.stringify({ pid: process.pid, sessionId: activeGlobalSessionId })
      ),
    ])
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await runCli(['__complete-session-ids', '12345678'])

    expect(log).toHaveBeenCalledWith(`${currentSessionId}\n${activeGlobalSessionId}`)
  })
})
