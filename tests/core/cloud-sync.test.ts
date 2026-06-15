import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { stopSyncLoop, syncBidirectional } from '../../src/core/cloud-sync.js'

describe('stopSyncLoop', () => {
  it('does not throw when called before initCloudSync', () => {
    expect(() => stopSyncLoop()).not.toThrow()
  })

  it('is idempotent — calling twice does not throw', () => {
    stopSyncLoop()
    expect(() => stopSyncLoop()).not.toThrow()
  })
})

describe('syncBidirectional', () => {
  let dirA: string
  let dirB: string

  beforeEach(async () => {
    const root = await mkdtemp(join(tmpdir(), 'ccm-sync-test-'))
    dirA = join(root, 'a')
    dirB = join(root, 'b')
    await mkdir(dirA, { recursive: true })
    await mkdir(dirB, { recursive: true })
  })

  afterEach(async () => {
    const root = join(dirA, '..')
    await rm(root, { force: true, recursive: true })
  })

  it('copies files from A to B when B is empty', async () => {
    await writeFile(join(dirA, 'session.jsonl'), 'line1\n', 'utf8')

    await syncBidirectional(dirA, dirB)

    const content = await readFile(join(dirB, 'session.jsonl'), 'utf8')
    expect(content).toBe('line1\n')
  })

  it('copies files from B to A when A is empty', async () => {
    await writeFile(join(dirB, 'session.jsonl'), 'from-b\n', 'utf8')

    await syncBidirectional(dirA, dirB)

    const content = await readFile(join(dirA, 'session.jsonl'), 'utf8')
    expect(content).toBe('from-b\n')
  })

  it('keeps both copies when both exist and are identical size', async () => {
    const same = 'identical'
    await writeFile(join(dirA, 'file.jsonl'), same, 'utf8')
    await writeFile(join(dirB, 'file.jsonl'), same, 'utf8')

    await syncBidirectional(dirA, dirB)

    expect(await readFile(join(dirA, 'file.jsonl'), 'utf8')).toBe(same)
    expect(await readFile(join(dirB, 'file.jsonl'), 'utf8')).toBe(same)
  })

  it('propagates the larger file to the smaller side', async () => {
    const large = 'line1\nline2\n'
    const small = 'line1\n'
    await writeFile(join(dirA, 'transcript.jsonl'), large, 'utf8')
    await writeFile(join(dirB, 'transcript.jsonl'), small, 'utf8')

    await syncBidirectional(dirA, dirB)

    expect(await readFile(join(dirB, 'transcript.jsonl'), 'utf8')).toBe(large)
    expect(await readFile(join(dirA, 'transcript.jsonl'), 'utf8')).toBe(large)
  })

  it('propagates the larger file from B to A when B is larger', async () => {
    const large = 'b-content-extended\n'
    const small = 'b\n'
    await writeFile(join(dirA, 'transcript.jsonl'), small, 'utf8')
    await writeFile(join(dirB, 'transcript.jsonl'), large, 'utf8')

    await syncBidirectional(dirA, dirB)

    expect(await readFile(join(dirA, 'transcript.jsonl'), 'utf8')).toBe(large)
    expect(await readFile(join(dirB, 'transcript.jsonl'), 'utf8')).toBe(large)
  })

  it('recurses into subdirectories', async () => {
    const subA = join(dirA, 'memory')
    await mkdir(subA, { recursive: true })
    await writeFile(join(subA, 'notes.md'), '# Notes\n', 'utf8')

    await syncBidirectional(dirA, dirB)

    const content = await readFile(join(dirB, 'memory', 'notes.md'), 'utf8')
    expect(content).toBe('# Notes\n')
  })

  it('is a no-op when B does not exist', async () => {
    const nonexistentB = join(dirB, 'does-not-exist')
    await writeFile(join(dirA, 'file.jsonl'), 'data', 'utf8')

    // Should not throw — unreachable B is silently skipped.
    await expect(syncBidirectional(dirA, nonexistentB)).resolves.toBeUndefined()
  })

  it('skips the .ccm-link file during sync', async () => {
    await writeFile(join(dirA, '.ccm-link'), '/cloud/path', 'utf8')
    await writeFile(join(dirA, 'session.jsonl'), 'data', 'utf8')

    await syncBidirectional(dirA, dirB)

    // .ccm-link is the link-marker file; it must not be propagated.
    await expect(readFile(join(dirB, '.ccm-link'), 'utf8')).rejects.toThrow()
    expect(await readFile(join(dirB, 'session.jsonl'), 'utf8')).toBe('data')
  })
})
