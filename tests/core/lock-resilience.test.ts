import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, open, readFile, rm, unlink, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { setSessionArchived } from '../../src/core/session/session-metadata.js'

const SESSION_ID = '00000000-0000-0000-0000-000000000001'
const PROJECT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

describe('lock resilience', () => {
  let originalClaudeConfigDirectory: string | undefined
  let temporaryClaudeDirectory: string

  beforeEach(async () => {
    temporaryClaudeDirectory = await mkdtemp(join(tmpdir(), 'reup-lock-test-'))
    originalClaudeConfigDirectory = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = temporaryClaudeDirectory
    await mkdir(join(temporaryClaudeDirectory, 'projects', PROJECT_ID), { recursive: true })
  })

  afterEach(async () => {
    if (originalClaudeConfigDirectory === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDirectory
    await rm(temporaryClaudeDirectory, { force: true, recursive: true })
  })

  it('recovers from an empty lock file (writer crashed before writing PID)', async () => {
    const lockPath = join(temporaryClaudeDirectory, 'projects', PROJECT_ID, 'reup.json.lock')
    await writeFile(lockPath, '') // simulate crash between O_EXCL creation and PID write
    const staleTimestamp = new Date(Date.now() - 10_000)
    await utimes(lockPath, staleTimestamp, staleTimestamp)
    await expect(setSessionArchived(PROJECT_ID, SESSION_ID, true)).resolves.toBeUndefined()
  })

  it('does not steal a fresh empty lock from a live writer', async () => {
    const lockPath = join(temporaryClaudeDirectory, 'projects', PROJECT_ID, 'reup.json.lock')
    const lockFile = await open(lockPath, 'wx')

    const liveWriter = (async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 100))
      await lockFile.writeFile(String(process.pid))
      await new Promise<void>((resolve) => setTimeout(resolve, 100))
      await lockFile.close()
      await unlink(lockPath)
    })()

    await expect(setSessionArchived(PROJECT_ID, SESSION_ID, true)).resolves.toBeUndefined()
    await liveWriter
  })

  it('waits for an abandoned empty lock to cross the stale threshold before recovering', async () => {
    const lockPath = join(temporaryClaudeDirectory, 'projects', PROJECT_ID, 'reup.json.lock')
    await writeFile(lockPath, '')
    const almostStaleTimestamp = new Date(Date.now() - 4_900)
    await utimes(lockPath, almostStaleTimestamp, almostStaleTimestamp)

    const startedAt = Date.now()
    await expect(setSessionArchived(PROJECT_ID, SESSION_ID, true)).resolves.toBeUndefined()
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(80)
  })

  it('recovers from a lock with an impossible PID (dead process)', async () => {
    const lockPath = join(temporaryClaudeDirectory, 'projects', PROJECT_ID, 'reup.json.lock')
    // PID 2147483647 (INT32_MAX) is well beyond any OS limit and always ESRCH
    await writeFile(lockPath, '2147483647')
    await expect(setSessionArchived(PROJECT_ID, SESSION_ID, true)).resolves.toBeUndefined()
  })

  it('preserves both updates from independent concurrent writers', async () => {
    // Resetting the module cache gives each writer its own in-process queue, so
    // coordination must happen through the cross-process file lock.
    vi.resetModules()
    const writerA = await import('../../src/core/session/session-metadata.js')
    vi.resetModules()
    const writerB = await import('../../src/core/session/session-metadata.js')

    await Promise.all([
      writerA.setSessionAlias(PROJECT_ID, SESSION_ID, 'concurrent alias'),
      writerB.setSessionArchived(PROJECT_ID, SESSION_ID, true),
    ])

    const metadataContent = await readFile(
      join(temporaryClaudeDirectory, 'projects', PROJECT_ID, 'reup.json'),
      'utf8'
    )
    const metadata = JSON.parse(metadataContent) as {
      sessions?: Record<string, { alias?: string; archived?: boolean }>
    }
    expect(metadata.sessions?.[SESSION_ID]).toEqual({
      alias: 'concurrent alias',
      archived: true,
    })
  })

  it('retries sidecar replacement while another process briefly holds the file open', async () => {
    const sidecarPath = join(temporaryClaudeDirectory, 'projects', PROJECT_ID, 'reup.json')
    await writeFile(sidecarPath, JSON.stringify({ sessions: {} }))

    const heldSidecar = await open(sidecarPath, 'r')
    const releaseSidecar = new Promise<void>((resolve) => {
      setTimeout(() => {
        void heldSidecar.close().finally(resolve)
      }, 120)
    })

    try {
      await expect(setSessionArchived(PROJECT_ID, SESSION_ID, true)).resolves.toBeUndefined()
    } finally {
      await releaseSidecar
    }

    const metadata = JSON.parse(await readFile(sidecarPath, 'utf8')) as {
      sessions?: Record<string, { archived?: boolean }>
    }
    expect(metadata.sessions?.[SESSION_ID]?.archived).toBe(true)
  })
})
