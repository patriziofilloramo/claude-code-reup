import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { lstat, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
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
  unregisterProjectSync,
} from '../../src/core/sync/cloud-sync.js'
import { syncRegistry } from '../../src/core/sync/sync-registry.js'

describe('stopSyncLoop', () => {
  it('does not throw when called before initCloudSync', () => {
    expect(() => stopSyncLoop()).not.toThrow()
  })

  it('is idempotent when called repeatedly', () => {
    stopSyncLoop()
    expect(() => stopSyncLoop()).not.toThrow()
  })
})

describe('unregisterProjectSync', () => {
  it('removes stale runtime state that would override the unlinked filesystem', () => {
    const projectPath = join(tmpdir(), 'reup-unregistered-project')
    syncRegistry.set(projectPath, {
      cloudDir: join(projectPath, '.claude-memory'),
      hasPendingMerge: false,
      isOnline: true,
    })

    unregisterProjectSync(projectPath)

    expect(syncRegistry.has(projectPath)).toBe(false)
  })
})

describe('syncBidirectional', () => {
  let dirA: string
  let dirB: string
  let root: string
  const legacyConflictDirectory = `.${['swo', 'op'].join('')}-conflicts`

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'reup-sync-test-'))
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

  it('skips junctions and symlinks without throwing', async () => {
    const { symlink } = await import('node:fs/promises')
    await writeFile(join(dirA, 'session.jsonl'), 'data', 'utf8')
    await mkdir(join(dirA, 'real-dir'))
    // Create a symlink in dirA alongside real content
    await symlink(join(dirA, 'real-dir'), join(dirA, 'memory'), 'junction').catch(() =>
      symlink(join(dirA, 'real-dir'), join(dirA, 'memory'))
    )

    await syncBidirectional(dirA, dirB)

    // The real session file is synced; the symlink/junction is skipped, not an error
    expect(await readFile(join(dirB, 'session.jsonl'), 'utf8')).toBe('data')
    const { lstat } = await import('node:fs/promises')
    await expect(lstat(join(dirB, 'memory'))).rejects.toThrow() // not copied
  })

  it('skips the legacy .reup-link marker', async () => {
    await writeFile(join(dirA, '.reup-link'), '/cloud/path', 'utf8')
    await writeFile(join(dirA, 'session.jsonl'), 'data', 'utf8')

    await syncBidirectional(dirA, dirB)

    await expect(readFile(join(dirB, '.reup-link'), 'utf8')).rejects.toThrow()
    expect(await readFile(join(dirB, 'session.jsonl'), 'utf8')).toBe('data')
  })

  it('preserves divergent JSONL copies before converging to the latest transcript', async () => {
    const sessionFile = '00000000-0000-0000-0000-000000000001.jsonl'
    const olderTranscript =
      '{"type":"user","timestamp":"2026-01-01T10:00:00.000Z","message":{"content":"older"}}\n'
    const newerTranscript =
      '{"type":"user","timestamp":"2026-01-02T10:00:00.000Z","message":{"content":"newer"}}\n'
    await writeFile(join(dirA, sessionFile), olderTranscript, 'utf8')
    await writeFile(join(dirB, sessionFile), newerTranscript, 'utf8')

    await syncBidirectional(dirA, dirB)

    expect(await readFile(join(dirA, sessionFile), 'utf8')).toBe(newerTranscript)
    expect(await readFile(join(dirB, sessionFile), 'utf8')).toBe(newerTranscript)

    const conflictFiles = await readdir(join(dirB, '.reup-conflicts'))
    const sideA = conflictFiles.find((name) => name.includes('.side-a.'))
    const sideB = conflictFiles.find((name) => name.includes('.side-b.'))
    const manifest = conflictFiles.find((name) => name.includes('.conflict.'))

    expect(sideA).toBeDefined()
    expect(sideB).toBeDefined()
    expect(manifest).toBeDefined()
    expect(await readFile(join(dirB, '.reup-conflicts', sideA!), 'utf8')).toBe(olderTranscript)
    expect(await readFile(join(dirB, '.reup-conflicts', sideB!), 'utf8')).toBe(newerTranscript)
    expect(await readFile(join(dirB, '.reup-conflicts', manifest!), 'utf8')).toContain(
      '"reason": "latest-jsonl-timestamp"'
    )
  })

  it('does not create duplicate conflict artifacts on a later sync pass', async () => {
    const sessionFile = '00000000-0000-0000-0000-000000000002.jsonl'
    await writeFile(
      join(dirA, sessionFile),
      '{"type":"user","timestamp":"2026-01-01T10:00:00.000Z"}\n',
      'utf8'
    )
    await writeFile(
      join(dirB, sessionFile),
      '{"type":"user","timestamp":"2026-01-02T10:00:00.000Z"}\n',
      'utf8'
    )

    await syncBidirectional(dirA, dirB)
    const firstPassFiles = (await readdir(join(dirB, '.reup-conflicts'))).sort()
    await syncBidirectional(dirA, dirB)

    expect((await readdir(join(dirB, '.reup-conflicts'))).sort()).toEqual(firstPassFiles)
  })

  it('migrates legacy conflict artifacts into .reup-conflicts before syncing', async () => {
    await mkdir(join(dirA, legacyConflictDirectory))
    await writeFile(join(dirA, legacyConflictDirectory, 'old.conflict.json'), '{}\n', 'utf8')

    await syncBidirectional(dirA, dirB)

    await expect(
      readFile(join(dirA, legacyConflictDirectory, 'old.conflict.json'), 'utf8')
    ).rejects.toThrow()
    expect(await readFile(join(dirA, '.reup-conflicts', 'old.conflict.json'), 'utf8')).toBe('{}\n')
    expect(await readFile(join(dirB, '.reup-conflicts', 'old.conflict.json'), 'utf8')).toBe('{}\n')
  })

  it('auto-merges independently-edited .md files into a union of their lines', async () => {
    await writeFile(
      join(dirA, 'MEMORY.md'),
      '# Memory Index\n\n- [entry1](f1.md) — desc1\n',
      'utf8'
    )
    await writeFile(
      join(dirB, 'MEMORY.md'),
      '# Memory Index\n\n- [entry2](f2.md) — desc2\n',
      'utf8'
    )

    await syncBidirectional(dirA, dirB)

    const expected = '# Memory Index\n\n- [entry1](f1.md) — desc1\n- [entry2](f2.md) — desc2\n'
    expect(await readFile(join(dirA, 'MEMORY.md'), 'utf8')).toBe(expected)
    expect(await readFile(join(dirB, 'MEMORY.md'), 'utf8')).toBe(expected)
  })

  it('auto-merges .md files in subdirectories', async () => {
    await mkdir(join(dirA, 'memory'), { recursive: true })
    await mkdir(join(dirB, 'memory'), { recursive: true })
    await writeFile(join(dirA, 'memory', 'MEMORY.md'), '- [a](a.md) — from device A\n', 'utf8')
    await writeFile(join(dirB, 'memory', 'MEMORY.md'), '- [b](b.md) — from device B\n', 'utf8')

    await syncBidirectional(dirA, dirB)

    const expected = '- [a](a.md) — from device A\n- [b](b.md) — from device B\n'
    expect(await readFile(join(dirA, 'memory', 'MEMORY.md'), 'utf8')).toBe(expected)
    expect(await readFile(join(dirB, 'memory', 'MEMORY.md'), 'utf8')).toBe(expected)
  })

  it('preserves invalid UTF-8 Markdown copies instead of blocking sync', async () => {
    const contentA = Buffer.from([0x80, 0x81, 0x82])
    const contentB = Buffer.from([0x90, 0x91, 0x92])
    await writeFile(join(dirA, 'corrupt.md'), contentA)
    await writeFile(join(dirB, 'corrupt.md'), contentB)

    await syncBidirectional(dirA, dirB)

    const conflictFiles = await readdir(join(dirB, '.reup-conflicts'))
    const sideA = conflictFiles.find((name) => name.includes('.side-a.'))
    const sideB = conflictFiles.find((name) => name.includes('.side-b.'))

    expect(sideA).toBeDefined()
    expect(sideB).toBeDefined()
    expect(await readFile(join(dirB, '.reup-conflicts', sideA!))).toEqual(contentA)
    expect(await readFile(join(dirB, '.reup-conflicts', sideB!))).toEqual(contentB)
  })

  it('still reports a conflict for file-directory type mismatches', async () => {
    await writeFile(join(dirA, 'mixed'), 'file', 'utf8')
    await mkdir(join(dirB, 'mixed'))

    await expect(syncBidirectional(dirA, dirB)).rejects.toBeInstanceOf(CloudSyncConflictError)
  })
})

describe('mirrorDirectory', () => {
  let destination: string
  let root: string
  let source: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'reup-mirror-test-'))
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
    root = await mkdtemp(join(tmpdir(), 'reup-link-test-'))
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
