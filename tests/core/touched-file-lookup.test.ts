import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { getClaudeProjectsDirectory } from '../../src/core/project/claude-paths.js'
import {
  collectTouchedFiles,
  extractTouchedPathsFromLines,
  pathMatchKey,
  searchTouchedFiles,
} from '../../src/core/session/session-file-search.js'
import type { Project, Session } from '../../src/core/session/session-model.js'

function assistantToolUse(name: string, input: Record<string, unknown>): string {
  return JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', name, input }] },
  })
}

function edit(path: string): string {
  return assistantToolUse('Edit', { file_path: path })
}

/** An edit event carrying the real timestamp and branch the transcript records. */
function editAt(path: string, timestamp: string, gitBranch: string): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp,
    gitBranch,
    message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: path } }] },
  })
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    context: {
      latestContextTokens: null,
      latestModel: null,
      latestOutputTokens: null,
      models: null,
    },
    created: '2026-06-10T10:00:00.000Z',
    id: overrides.id ?? '00000000-0000-0000-0000-000000000001',
    messageCount: 4,
    name: 'session',
    projectPath: '/workspace/repo',
    signals: {
      analysisComplete: true,
      archived: false,
      compactionCount: 0,
      expiresInDays: 28,
      interrupted: false,
      lastToolFailed: false,
      pathExists: true,
    },
    updated: '2026-06-10T12:00:00.000Z',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Pure extraction
// ---------------------------------------------------------------------------

describe('extractTouchedPathsFromLines', () => {
  it('collects paths from every write-like tool', () => {
    const lines = [
      assistantToolUse('Edit', { file_path: '/repo/a.ts' }),
      assistantToolUse('Write', { file_path: '/repo/b.ts' }),
      assistantToolUse('MultiEdit', { file_path: '/repo/c.ts' }),
      assistantToolUse('NotebookEdit', { notebook_path: '/repo/d.ipynb' }),
    ]
    expect(extractTouchedPathsFromLines(lines)).toEqual([
      '/repo/a.ts',
      '/repo/b.ts',
      '/repo/c.ts',
      '/repo/d.ipynb',
    ])
  })

  it('ignores read-only and non-write tools', () => {
    const lines = [
      assistantToolUse('Read', { file_path: '/repo/a.ts' }),
      assistantToolUse('Grep', { pattern: 'foo' }),
      assistantToolUse('Bash', { command: 'ls' }),
    ]
    expect(extractTouchedPathsFromLines(lines)).toEqual([])
  })

  it('captures every write in a single assistant turn', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'editing two files' },
          { type: 'tool_use', name: 'Edit', input: { file_path: '/repo/a.ts' } },
          { type: 'tool_use', name: 'Write', input: { file_path: '/repo/b.ts' } },
        ],
      },
    })
    expect(extractTouchedPathsFromLines([line])).toEqual(['/repo/a.ts', '/repo/b.ts'])
  })

  it('returns both the primary and notebook path for a notebook edit', () => {
    const line = assistantToolUse('NotebookEdit', {
      notebook_path: '/repo/nb.ipynb',
      file_path: '/repo/cell.py',
    })
    expect(extractTouchedPathsFromLines([line])).toEqual(['/repo/cell.py', '/repo/nb.ipynb'])
  })

  it('skips non-string paths, non-assistant events, and unparseable lines', () => {
    const lines = [
      assistantToolUse('Edit', { file_path: 42 }),
      JSON.stringify({ type: 'user', message: { content: 'hi' } }),
      '{ not json',
      '',
      edit('/repo/real.ts'),
    ]
    expect(extractTouchedPathsFromLines(lines)).toEqual(['/repo/real.ts'])
  })
})

describe('pathMatchKey', () => {
  it('lower-cases and removes every path separator', () => {
    expect(pathMatchKey('P:\\\\Projects\\IT\\App')).toBe('p:projectsitapp')
    expect(pathMatchKey('src//core///session')).toBe('srccoresession')
    expect(pathMatchKey('  /Repo/A.ts  ')).toBe('repoa.ts')
  })
})

// ---------------------------------------------------------------------------
// Filesystem-backed lookups (shared temp Claude directory)
// ---------------------------------------------------------------------------

describe('touched-file lookups', () => {
  let claudeDirectory: string
  let originalClaudeDirectory: string | undefined
  let projectId: string

  async function writeTranscript(sessionId: string, lines: string[]): Promise<void> {
    const directory = join(getClaudeProjectsDirectory(), projectId)
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, `${sessionId}.jsonl`), lines.join('\n'), 'utf8')
  }

  function projectsWith(sessions: Session[]): Project[] {
    return [{ id: projectId, path: '/workspace/repo', sessions }]
  }

  beforeEach(async () => {
    claudeDirectory = await mkdtemp(join(tmpdir(), 'reup-touched-test-'))
    originalClaudeDirectory = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = claudeDirectory
    projectId = 'workspace-repo'
  })

  afterEach(async () => {
    if (originalClaudeDirectory === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalClaudeDirectory
    await rm(claudeDirectory, { recursive: true, force: true })
  })

  describe('searchTouchedFiles', () => {
    it('returns sessions that wrote a matching file, ranked by match count', async () => {
      const heavy = makeSession({ id: '00000000-0000-0000-0000-0000000000aa' })
      const light = makeSession({ id: '00000000-0000-0000-0000-0000000000bb' })
      await writeTranscript(heavy.id, [
        edit('/workspace/repo/src/core/session/session-query.ts'),
        edit('/workspace/repo/src/core/session/session-query.ts'),
        edit('/workspace/repo/README.md'),
      ])
      await writeTranscript(light.id, [edit('/workspace/repo/src/core/session/session-query.ts')])

      const matches = await searchTouchedFiles('session-query', projectsWith([heavy, light]))

      expect(matches.map((match) => match.session.id)).toEqual([heavy.id, light.id])
      expect(matches[0]!.matchCount).toBe(2)
      expect(matches[0]!.matchedPaths).toEqual([
        '/workspace/repo/src/core/session/session-query.ts',
      ])
    })

    it('matches regardless of path-separator style', async () => {
      const session = makeSession({ id: '00000000-0000-0000-0000-0000000000cc' })
      await writeTranscript(session.id, [edit('P:\\Projects\\repo\\src\\core\\thing.ts')])

      expect(await searchTouchedFiles('core/thing', projectsWith([session]))).toHaveLength(1)
    })

    it('breaks match-count ties toward the most recently touched session', async () => {
      const earlier = makeSession({ id: '00000000-0000-0000-0000-0000000000c1' })
      const later = makeSession({ id: '00000000-0000-0000-0000-0000000000c2' })
      // Both touch the file once (equal match count); discovery order lists
      // earlier first, so a stable sort alone would keep that order.
      await writeTranscript(earlier.id, [
        editAt('/workspace/repo/tie.ts', '2026-07-01T00:00:00.000Z', 'main'),
      ])
      await writeTranscript(later.id, [
        editAt('/workspace/repo/tie.ts', '2026-07-09T00:00:00.000Z', 'main'),
      ])

      const matches = await searchTouchedFiles('tie.ts', projectsWith([earlier, later]))

      expect(matches.map((match) => match.session.id)).toEqual([later.id, earlier.id])
    })

    it('reports the real timestamp and branch of the most recent matching write', async () => {
      const session = makeSession({ id: '00000000-0000-0000-0000-00000000ab02' })
      await writeTranscript(session.id, [
        editAt('/workspace/repo/src/web/ui.html', '2026-07-01T00:00:00.000Z', 'feature/early'),
        editAt('/workspace/repo/src/web/ui.html', '2026-07-05T00:00:00.000Z', 'feature/late'),
      ])

      const [match] = await searchTouchedFiles('ui.html', projectsWith([session]))

      expect(match!.lastTouchedAt).toBe('2026-07-05T00:00:00.000Z')
      expect(match!.gitBranch).toBe('feature/late')
    })

    it('matches a path whose separators a shell stripped from the query', async () => {
      const session = makeSession({ id: '00000000-0000-0000-0000-00000000ab01' })
      await writeTranscript(session.id, [edit('P:\\Projects\\repo\\src\\web\\ui.html')])

      // An unquoted Windows path loses its backslashes before reaching the CLI.
      const matches = await searchTouchedFiles('Projectsreposrcwebui.html', projectsWith([session]))

      expect(matches).toHaveLength(1)
      expect(matches[0]!.matchedPaths).toEqual(['P:\\Projects\\repo\\src\\web\\ui.html'])
    })

    it('ignores read-only access and unrelated files', async () => {
      const session = makeSession({ id: '00000000-0000-0000-0000-0000000000dd' })
      await writeTranscript(session.id, [
        assistantToolUse('Read', { file_path: '/workspace/repo/secret.ts' }),
        edit('/workspace/repo/other.ts'),
      ])

      expect(await searchTouchedFiles('secret', projectsWith([session]))).toEqual([])
    })

    it('excludes archived sessions unless asked to include them', async () => {
      const session = makeSession({
        id: '00000000-0000-0000-0000-0000000000ee',
        signals: { ...makeSession().signals, archived: true },
      })
      await writeTranscript(session.id, [edit('/workspace/repo/archived.ts')])
      const project = projectsWith([session])

      expect(await searchTouchedFiles('archived', project)).toEqual([])
      expect(await searchTouchedFiles('archived', project, { includeArchived: true })).toHaveLength(
        1
      )
    })

    it('skips empty-message and missing-transcript sessions without throwing', async () => {
      const empty = makeSession({ id: '00000000-0000-0000-0000-0000000000ff', messageCount: 0 })
      const missing = makeSession({ id: '00000000-0000-0000-0000-000000000011' })

      expect(await searchTouchedFiles('anything', projectsWith([empty, missing]))).toEqual([])
    })

    it('returns nothing for a blank query', async () => {
      const session = makeSession()
      await writeTranscript(session.id, [edit('/workspace/repo/a.ts')])

      expect(await searchTouchedFiles('   ', projectsWith([session]))).toEqual([])
    })
  })

  describe('collectTouchedFiles', () => {
    it('aggregates distinct files newest-first with per-file session counts', async () => {
      const older = makeSession({
        id: '00000000-0000-0000-0000-0000000000a1',
        updated: '2026-06-10T10:00:00.000Z',
      })
      const newer = makeSession({
        id: '00000000-0000-0000-0000-0000000000a2',
        updated: '2026-06-12T10:00:00.000Z',
      })
      await writeTranscript(older.id, [
        edit('/workspace/repo/shared.ts'),
        edit('/workspace/repo/shared.ts'), // same file twice in one session
        edit('/workspace/repo/only-old.ts'),
      ])
      await writeTranscript(newer.id, [edit('/workspace/repo/shared.ts')])

      const files = await collectTouchedFiles(projectsWith([older, newer]))

      expect(files.map((file) => file.path)).toEqual([
        '/workspace/repo/shared.ts',
        '/workspace/repo/only-old.ts',
      ])
      const shared = files.find((file) => file.path === '/workspace/repo/shared.ts')!
      expect(shared.sessionCount).toBe(2)
      expect(shared.lastTouchedAt).toBe('2026-06-12T10:00:00.000Z')
    })

    it('aggregates one file recorded with different separators', async () => {
      const older = makeSession({
        id: '00000000-0000-0000-0000-0000000000b1',
        updated: '2026-06-10T10:00:00.000Z',
      })
      const newer = makeSession({
        id: '00000000-0000-0000-0000-0000000000b2',
        updated: '2026-06-12T10:00:00.000Z',
      })
      await writeTranscript(older.id, [edit('/workspace/repo/src/foo.ts')])
      await writeTranscript(newer.id, [edit('/workspace/repo/src\\foo.ts')])

      const files = await collectTouchedFiles(projectsWith([older, newer]))

      expect(files).toHaveLength(1)
      expect(files[0]!.sessionCount).toBe(2)
      // Display follows the most recent write's spelling.
      expect(files[0]!.path).toBe('/workspace/repo/src\\foo.ts')
    })

    it('folds case only on case-insensitive filesystems', async () => {
      const lower = makeSession({ id: '00000000-0000-0000-0000-0000000000b3' })
      const upper = makeSession({ id: '00000000-0000-0000-0000-0000000000b4' })
      await writeTranscript(lower.id, [edit('/workspace/repo/src/foo.ts')])
      await writeTranscript(upper.id, [edit('/workspace/repo/src/Foo.ts')])

      const files = await collectTouchedFiles(projectsWith([lower, upper]))

      // Windows/macOS treat the two spellings as one file; Linux keeps them apart.
      const expected = process.platform === 'win32' || process.platform === 'darwin' ? 1 : 2
      expect(files).toHaveLength(expected)
    })

    it('uses the real event timestamp and branch of the most recent write', async () => {
      const session = makeSession({ id: '00000000-0000-0000-0000-0000000000a4' })
      await writeTranscript(session.id, [
        editAt('/workspace/repo/x.ts', '2026-07-01T08:00:00.000Z', 'feature/early'),
        editAt('/workspace/repo/x.ts', '2026-07-03T09:30:00.000Z', 'feature/late'),
      ])

      const [file] = await collectTouchedFiles(projectsWith([session]))

      expect(file!.lastTouchedAt).toBe('2026-07-03T09:30:00.000Z')
      expect(file!.gitBranch).toBe('feature/late')
    })

    it('excludes archived sessions unless asked to include them', async () => {
      const session = makeSession({
        id: '00000000-0000-0000-0000-0000000000a3',
        signals: { ...makeSession().signals, archived: true },
      })
      await writeTranscript(session.id, [edit('/workspace/repo/archived-only.ts')])
      const project = projectsWith([session])

      expect(await collectTouchedFiles(project)).toEqual([])
      expect(await collectTouchedFiles(project, { includeArchived: true })).toHaveLength(1)
    })
  })
})
