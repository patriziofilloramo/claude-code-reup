import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { buildDiagnosticsReport } from '../../src/core/health/diagnostics.js'

const INDEXED_SESSION_ID = '00000000-0000-0000-0000-000000000001'
const ORPHANED_SESSION_ID = '11111111-1111-1111-1111-111111111111'

describe('diagnostics', () => {
  let originalClaudeDirectory: string | undefined
  let temporaryClaudeDirectory: string

  beforeEach(async () => {
    temporaryClaudeDirectory = await mkdtemp(join(tmpdir(), 'reup-diagnostics-test-'))
    originalClaudeDirectory = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = temporaryClaudeDirectory
  })

  afterEach(async () => {
    if (originalClaudeDirectory === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalClaudeDirectory
    await rm(temporaryClaudeDirectory, { force: true, recursive: true })
  })

  it('finds broken indices, orphaned transcripts, and abandoned locks', async () => {
    const indexedProjectDirectory = join(temporaryClaudeDirectory, 'projects', 'indexed-project')
    const brokenProjectDirectory = join(temporaryClaudeDirectory, 'projects', 'broken-project')
    await Promise.all([
      mkdir(indexedProjectDirectory, { recursive: true }),
      mkdir(brokenProjectDirectory, { recursive: true }),
    ])

    await writeFile(
      join(indexedProjectDirectory, 'sessions-index.json'),
      JSON.stringify({
        sessions: [
          {
            created: '2026-06-10T10:00:00.000Z',
            id: INDEXED_SESSION_ID,
            messageCount: 1,
            name: 'Indexed session',
            projectPath: temporaryClaudeDirectory,
            updated: '2026-06-10T10:00:00.000Z',
          },
        ],
      })
    )
    await mkdir(join(temporaryClaudeDirectory, '.claude-memory'), { recursive: true })
    await writeFile(join(indexedProjectDirectory, '.reup-link'), temporaryClaudeDirectory)
    await writeFile(join(indexedProjectDirectory, `${ORPHANED_SESSION_ID}.jsonl`), '{}')
    await writeFile(join(indexedProjectDirectory, 'reup.json.lock'), '2147483647')
    await writeFile(join(brokenProjectDirectory, 'sessions-index.json'), '{broken')

    const report = await buildDiagnosticsReport()

    expect(report.brokenIndices).toMatchObject([
      { projectId: 'broken-project', reason: 'index contains invalid JSON' },
    ])
    expect(report.orphanedTranscripts).toMatchObject([
      { projectId: 'indexed-project', sessionId: ORPHANED_SESSION_ID },
    ])
    expect(report.staleLocks).toMatchObject([
      { projectId: 'indexed-project', reason: 'owner process 2147483647 is not running' },
    ])
    expect(report.legacyProjectMemoryArtifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'link-marker',
          path: join(indexedProjectDirectory, '.reup-link'),
          projectId: 'indexed-project',
        }),
        expect.objectContaining({
          kind: 'project-memory-directory',
          path: join(temporaryClaudeDirectory, '.claude-memory'),
          projectId: 'indexed-project',
        }),
      ])
    )
  })

  it('does not report fresh invalid locks as abandoned', async () => {
    const projectDirectory = join(temporaryClaudeDirectory, 'projects', 'project')
    await mkdir(projectDirectory, { recursive: true })
    const lockPath = join(projectDirectory, 'reup.json.lock')
    await writeFile(lockPath, 'not-a-pid')
    const freshTimestamp = new Date()
    await utimes(lockPath, freshTimestamp, freshTimestamp)

    const report = await buildDiagnosticsReport()

    expect(report.staleLocks).toEqual([])
  })
})
