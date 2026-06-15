import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  CloudSyncConflictError,
  CloudSyncUnavailableError,
  createLinkAt,
  mirrorDirectory,
  removeLinkAt,
  replaceDirectoryWithLink,
  replaceLinkWithDirectory,
  stopSyncLoop,
  syncBidirectional,
} from '../../src/core/cloud-sync.js'

describe('stopSyncLoop', () => {
  it('does not throw when called before initCloudSync', () => {
    expect(() => stopSyncLoop()).not.toThrow()
  })

  it('is idempotent when called repeatedly', () => {
    stopSyncLoop()
    expect(() => stopSyncLoop()).not.toThrow()
  })
})

describe('syncBidirectional', () => {
  let dirA: string
  let dirB: string
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ccm-sync-test-'))
    dirA = join(root, 'a')
    dirB = join(root, 'b')
    await mkdir(dirA, { recursive: true })
    await mkdir(dirB, { recursive: true })
  })

  afterEach(async () => {
    await rm(root, { force: true, recursive: true })
  })

  it('copies files from A to B when B is empty', async () => {
    await writeFile(join(dirA, 'session.jsonl'), 'line1\n', 'utf8')

    await syncBidirectional(dirA, dirB)

    expect(await readFile(join(dirB, 'session.jsonl'), 'utf8')).toBe('line1\n')
  })

  it('copies files from B to A when A is empty', async () => {
    await writeFile(join(dirB, 'session.jsonl'), 'from-b\n', 'utf8')

    await syncBidirectional(dirA, dirB)

    expect(await readFile(join(dirA, 'session.jsonl'), 'utf8')).toBe('from-b\n')
  })

  it('keeps identical files unchanged', async () => {
    await writeFile(join(dirA, 'file.jsonl'), 'identical', 'utf8')
    await writeFile(join(dirB, 'file.jsonl'), 'identical', 'utf8')

    await syncBidirectional(dirA, dirB)

    expect(await readFile(join(dirA, 'file.jsonl'), 'utf8')).toBe('identical')
    expect(await readFile(join(dirB, 'file.jsonl'), 'utf8')).toBe('identical')
  })

  it('propagates an append-only extension from A to B', async () => {
    await writeFile(join(dirA, 'transcript.jsonl'), 'line1\nline2\n', 'utf8')
    await writeFile(join(dirB, 'transcript.jsonl'), 'line1\n', 'utf8')

    await syncBidirectional(dirA, dirB)

    expect(await readFile(join(dirB, 'transcript.jsonl'), 'utf8')).toBe('line1\nline2\n')
  })

  it('propagates an append-only extension from B to A', async () => {
    await writeFile(join(dirA, 'transcript.jsonl'), 'line1\n', 'utf8')
    await writeFile(join(dirB, 'transcript.jsonl'), 'line1\nline2\n', 'utf8')

    await syncBidirectional(dirA, dirB)

    expect(await readFile(join(dirA, 'transcript.jsonl'), 'utf8')).toBe('line1\nline2\n')
  })

  it('recurses into subdirectories', async () => {
    await mkdir(join(dirA, 'memory'))
    await writeFile(join(dirA, 'memory', 'notes.md'), '# Notes\n', 'utf8')

    await syncBidirectional(dirA, dirB)

    expect(await readFile(join(dirB, 'memory', 'notes.md'), 'utf8')).toBe('# Notes\n')
  })

  it('rejects when a sync directory is unavailable', async () => {
    await writeFile(join(dirA, 'file.jsonl'), 'data', 'utf8')

    await expect(syncBidirectional(dirA, join(root, 'missing'))).rejects.toBeInstanceOf(
      CloudSyncUnavailableError
    )
  })

  it('skips the legacy .ccm-link marker', async () => {
    await writeFile(join(dirA, '.ccm-link'), '/cloud/path', 'utf8')
    await writeFile(join(dirA, 'session.jsonl'), 'data', 'utf8')

    await syncBidirectional(dirA, dirB)

    await expect(readFile(join(dirB, '.ccm-link'), 'utf8')).rejects.toThrow()
    expect(await readFile(join(dirB, 'session.jsonl'), 'utf8')).toBe('data')
  })

  it('preserves and reports same-size independent edits', async () => {
    await writeFile(join(dirA, 'session.jsonl'), 'AAAA', 'utf8')
    await writeFile(join(dirB, 'session.jsonl'), 'BBBB', 'utf8')

    await expect(syncBidirectional(dirA, dirB)).rejects.toBeInstanceOf(CloudSyncConflictError)
    expect(await readFile(join(dirA, 'session.jsonl'), 'utf8')).toBe('AAAA')
    expect(await readFile(join(dirB, 'session.jsonl'), 'utf8')).toBe('BBBB')
  })

  it('preserves and reports divergent edits of different sizes', async () => {
    await writeFile(join(dirA, 'session.jsonl'), 'local edit\n', 'utf8')
    await writeFile(join(dirB, 'session.jsonl'), 'independent cloud edit\n', 'utf8')

    await expect(syncBidirectional(dirA, dirB)).rejects.toBeInstanceOf(CloudSyncConflictError)
    expect(await readFile(join(dirA, 'session.jsonl'), 'utf8')).toBe('local edit\n')
    expect(await readFile(join(dirB, 'session.jsonl'), 'utf8')).toBe('independent cloud edit\n')
  })
})

describe('mirrorDirectory', () => {
  let destination: string
  let root: string
  let source: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ccm-mirror-test-'))
    source = join(root, 'source')
    destination = join(root, 'destination')
    await mkdir(source, { recursive: true })
    await mkdir(destination, { recursive: true })
  })

  afterEach(async () => {
    await rm(root, { force: true, recursive: true })
  })

  it('removes files no longer present in the authoritative source', async () => {
    await writeFile(join(source, 'current.jsonl'), 'current\n', 'utf8')
    await writeFile(join(destination, 'deleted.jsonl'), 'stale\n', 'utf8')

    await mirrorDirectory(source, destination)

    expect(await readFile(join(destination, 'current.jsonl'), 'utf8')).toBe('current\n')
    await expect(readFile(join(destination, 'deleted.jsonl'), 'utf8')).rejects.toThrow()
  })
})

describe('transactional link replacement', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ccm-link-test-'))
  })

  afterEach(async () => {
    await rm(root, { force: true, recursive: true })
  })

  it('creates and removes links without interpreting shell metacharacters', async () => {
    const target = join(root, 'target & data')
    const link = join(root, 'link & sessions')
    await mkdir(target)
    await writeFile(join(target, 'session.jsonl'), 'content\n', 'utf8')

    await createLinkAt(link, target)
    expect(await readFile(join(link, 'session.jsonl'), 'utf8')).toBe('content\n')

    await removeLinkAt(link)
    expect(await readFile(join(target, 'session.jsonl'), 'utf8')).toBe('content\n')
  })

  it('replaces a real directory with a link only after retaining a rollback copy', async () => {
    const localDirectory = join(root, 'local')
    const target = join(root, 'target')
    await mkdir(localDirectory)
    await mkdir(target)
    await writeFile(join(localDirectory, 'session.jsonl'), 'content\n', 'utf8')
    await writeFile(join(target, 'session.jsonl'), 'content\n', 'utf8')

    await replaceDirectoryWithLink(localDirectory, target)

    expect((await lstat(localDirectory)).isSymbolicLink()).toBe(true)
    expect(await readFile(join(localDirectory, 'session.jsonl'), 'utf8')).toBe('content\n')
  })

  it('stages a complete copy before replacing a link with a directory', async () => {
    const localDirectory = join(root, 'local')
    const target = join(root, 'target')
    await mkdir(target)
    await writeFile(join(target, 'session.jsonl'), 'content\n', 'utf8')
    await createLinkAt(localDirectory, target)

    await replaceLinkWithDirectory(localDirectory, target, target)

    expect((await lstat(localDirectory)).isSymbolicLink()).toBe(false)
    expect(await readFile(join(localDirectory, 'session.jsonl'), 'utf8')).toBe('content\n')
    expect(await readFile(join(target, 'session.jsonl'), 'utf8')).toBe('content\n')
  })
})
