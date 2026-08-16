import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'

import { encodeProjectPath } from '../../src/core/project/claude-paths.js'
import { loadProjects } from '../../src/core/project/project-discovery.js'

const PROJECT_ID = 'project-fixture'
const SESSION_ID = '00000000-0000-0000-0000-000000000001'
const SECOND_SESSION_ID = '00000000-0000-0000-0000-000000000002'
const THIRD_SESSION_ID = '00000000-0000-0000-0000-000000000003'
const FOURTH_SESSION_ID = '00000000-0000-0000-0000-000000000004'
const LEGACY_SIDECAR_FILE = `${['swo', 'op'].join('')}.json`
const executeFile = promisify(execFile)

describe('session loading', () => {
  let claudeDirectory: string
  let projectDirectory: string
  let originalClaudeDirectory: string | undefined

  beforeEach(async () => {
    claudeDirectory = await mkdtemp(join(tmpdir(), 'reup-loading-test-'))
    projectDirectory = join(claudeDirectory, 'projects', PROJECT_ID)
    originalClaudeDirectory = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = claudeDirectory
    await mkdir(projectDirectory, { recursive: true })
  })

  afterEach(async () => {
    if (originalClaudeDirectory === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalClaudeDirectory
    await rm(claudeDirectory, { force: true, recursive: true })
  })

  it('derives session metadata from JSONL and merges Reup sidecar metadata', async () => {
    const projectPath = join(claudeDirectory, 'workspace')
    await mkdir(projectPath)
    await writeFile(
      join(projectDirectory, `${SESSION_ID}.jsonl`),
      [
        JSON.stringify({
          type: 'user',
          timestamp: '2026-06-01T10:00:00.000Z',
          cwd: projectPath,
          gitBranch: 'feat/readable-core',
          message: { content: 'Refactor the session loader' },
        }),
        JSON.stringify({
          type: 'assistant',
          timestamp: '2026-06-01T10:05:00.000Z',
          message: {
            content: [{ type: 'text', text: 'Done' }],
            model: 'claude-sonnet-4-6',
            usage: {
              cache_creation_input_tokens: 100,
              cache_read_input_tokens: 2_000,
              input_tokens: 50,
              output_tokens: 250,
            },
          },
        }),
      ].join('\n')
    )
    await writeFile(
      join(projectDirectory, 'reup.json'),
      JSON.stringify({ sessions: { [SESSION_ID]: { alias: 'Core refactor', archived: true } } })
    )

    const [project] = await loadProjects()
    const [session] = project.sessions

    expect(project.path).toBe(projectPath)
    expect(session).toMatchObject({
      alias: 'Core refactor',
      context: {
        latestContextTokens: 2_150,
        latestModel: 'claude-sonnet-4-6',
        latestOutputTokens: 250,
        models: ['claude-sonnet-4-6'],
      },
      gitBranch: 'feat/readable-core',
      id: SESSION_ID,
      messageCount: 2,
      name: 'Refactor the session loader',
      projectPath,
    })
    expect(session.signals).toMatchObject({
      analysisComplete: true,
      archived: true,
      compactionCount: 0,
      interrupted: false,
      lastToolFailed: false,
      pathExists: true,
    })
  })

  it('copies legacy sidecar metadata to reup.json when the new sidecar is missing', async () => {
    const projectPath = join(claudeDirectory, 'legacy-sidecar-workspace')
    await mkdir(projectPath)
    await writeSessionTranscript(SESSION_ID, projectPath, 'main')
    await writeFile(
      join(projectDirectory, LEGACY_SIDECAR_FILE),
      JSON.stringify({ sessions: { [SESSION_ID]: { alias: 'Migrated alias' } } }),
      'utf8'
    )

    const [project] = await loadProjects()

    expect(project.sessions[0].alias).toBe('Migrated alias')
    expect(await readFile(join(projectDirectory, 'reup.json'), 'utf8')).toContain('Migrated alias')
    expect(await readFile(join(projectDirectory, LEGACY_SIDECAR_FILE), 'utf8')).toContain(
      'Migrated alias'
    )
  })

  it('keeps reup.json authoritative when both new and legacy sidecars exist', async () => {
    const projectPath = join(claudeDirectory, 'new-sidecar-workspace')
    await mkdir(projectPath)
    await writeSessionTranscript(SESSION_ID, projectPath, 'main')
    await writeFile(
      join(projectDirectory, LEGACY_SIDECAR_FILE),
      JSON.stringify({ sessions: { [SESSION_ID]: { alias: 'Legacy alias' } } }),
      'utf8'
    )
    await writeFile(
      join(projectDirectory, 'reup.json'),
      JSON.stringify({ sessions: { [SESSION_ID]: { alias: 'Current alias' } } }),
      'utf8'
    )

    const [project] = await loadProjects()

    expect(project.sessions[0].alias).toBe('Current alias')
    expect(await readFile(join(projectDirectory, 'reup.json'), 'utf8')).toContain('Current alias')
  })

  it('tracks model changes and ignores synthetic model identifiers', async () => {
    const projectPath = join(claudeDirectory, 'model-workspace')
    await mkdir(projectPath)
    await writeFile(
      join(projectDirectory, `${SESSION_ID}.jsonl`),
      [
        JSON.stringify({
          cwd: projectPath,
          message: { content: 'Use a faster model first' },
          timestamp: '2026-06-01T10:00:00.000Z',
          type: 'user',
        }),
        JSON.stringify({
          message: {
            content: [{ text: 'First response', type: 'text' }],
            model: 'claude-haiku-4-5-20251001',
            usage: { input_tokens: 100, output_tokens: 20 },
          },
          timestamp: '2026-06-01T10:01:00.000Z',
          type: 'assistant',
        }),
        JSON.stringify({
          message: {
            content: [{ text: 'Synthetic event', type: 'text' }],
            model: '<synthetic>',
          },
          timestamp: '2026-06-01T10:02:00.000Z',
          type: 'assistant',
        }),
        JSON.stringify({
          message: {
            content: [{ text: 'Final response', type: 'text' }],
            model: 'claude-sonnet-4-6',
            usage: {
              cache_creation_input_tokens: 50,
              cache_read_input_tokens: 1_000,
              input_tokens: 200,
              output_tokens: 300,
            },
          },
          timestamp: '2026-06-01T10:03:00.000Z',
          type: 'assistant',
        }),
        JSON.stringify({
          message: {
            content: [{ text: 'Synthetic event', type: 'text' }],
            model: '<synthetic>',
            usage: {
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
              input_tokens: 0,
              output_tokens: 0,
            },
          },
          timestamp: '2026-06-01T10:04:00.000Z',
          type: 'assistant',
        }),
      ].join('\n')
    )

    const [project] = await loadProjects()
    expect(project.sessions[0].context).toEqual({
      latestContextTokens: 1_250,
      latestModel: 'claude-sonnet-4-6',
      latestOutputTokens: 300,
      models: ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6'],
    })
  })

  it('ignores metadata-only remnants that Claude Code cannot resume', async () => {
    await writeFile(
      join(projectDirectory, `${SESSION_ID}.jsonl`),
      [
        JSON.stringify({ aiTitle: 'deleted session', sessionId: SESSION_ID, type: 'ai-title' }),
        JSON.stringify({ agentName: 'deleted session', sessionId: SESSION_ID, type: 'agent-name' }),
      ].join('\n')
    )

    expect(await loadProjects()).toEqual([])
  })

  it('ignores partial tool transcripts with no human request to resume', async () => {
    const projectPath = join(claudeDirectory, 'partial-tool-workspace')
    await mkdir(projectPath)
    await writeFile(
      join(projectDirectory, `${SESSION_ID}.jsonl`),
      [
        "import { readFile } from 'node:fs/promises'",
        "console.log('not json')",
        JSON.stringify({
          cwd: projectPath,
          message: { content: [{ text: 'Now I edit the route.', type: 'text' }] },
          timestamp: '2026-06-01T10:00:00.000Z',
          type: 'assistant',
        }),
        JSON.stringify({
          cwd: projectPath,
          message: {
            content: [
              {
                id: 'tool-1',
                input: { file_path: join(projectPath, 'src', 'route.ts') },
                name: 'Edit',
                type: 'tool_use',
              },
            ],
          },
          timestamp: '2026-06-01T10:01:00.000Z',
          type: 'assistant',
        }),
        JSON.stringify({
          message: { content: [{ tool_use_id: 'tool-1', type: 'tool_result' }] },
          timestamp: '2026-06-01T10:02:00.000Z',
          type: 'user',
        }),
      ].join('\n')
    )

    expect(await loadProjects()).toEqual([])
  })

  it('does not count split assistant tool-use events as conversation messages', async () => {
    const projectPath = join(claudeDirectory, 'split-tool-workspace')
    await mkdir(projectPath)
    await writeFile(
      join(projectDirectory, `${SESSION_ID}.jsonl`),
      [
        JSON.stringify({
          cwd: projectPath,
          message: { content: 'Add the route' },
          timestamp: '2026-06-01T10:00:00.000Z',
          type: 'user',
        }),
        JSON.stringify({
          message: { content: [{ text: 'I will edit the route.', type: 'text' }] },
          timestamp: '2026-06-01T10:01:00.000Z',
          type: 'assistant',
        }),
        JSON.stringify({
          message: {
            content: [
              {
                id: 'tool-1',
                input: { file_path: join(projectPath, 'src', 'route.ts') },
                name: 'Edit',
                type: 'tool_use',
              },
            ],
          },
          timestamp: '2026-06-01T10:02:00.000Z',
          type: 'assistant',
        }),
        JSON.stringify({
          message: { content: [{ tool_use_id: 'tool-1', type: 'tool_result' }] },
          timestamp: '2026-06-01T10:03:00.000Z',
          type: 'user',
        }),
      ].join('\n')
    )

    const [project] = await loadProjects()
    expect(project.sessions[0]).toMatchObject({
      id: SESSION_ID,
      messageCount: 2,
      name: 'Add the route',
      projectPath,
    })
  })

  it('skips context usage reports when deriving a session title', async () => {
    const projectPath = join(claudeDirectory, 'context-title-workspace')
    await mkdir(projectPath)
    await writeFile(
      join(projectDirectory, `${SESSION_ID}.jsonl`),
      [
        JSON.stringify({
          cwd: projectPath,
          message: { content: '## Context Usage\n\n**Model:** claude-sonnet-4-6' },
          type: 'user',
        }),
        JSON.stringify({
          message: { content: 'Review the project structure' },
          type: 'user',
        }),
      ].join('\n')
    )

    const [project] = await loadProjects()
    expect(project.sessions[0].name).toBe('Review the project structure')
  })

  it('uses transcript filesystem times when conversation events omit timestamps', async () => {
    const transcriptPath = join(projectDirectory, `${SESSION_ID}.jsonl`)
    await writeFile(
      transcriptPath,
      JSON.stringify({ message: { content: 'Review timestamps' }, type: 'user' })
    )
    const fallbackTime = new Date('2026-06-01T10:00:00.000Z')
    await utimes(transcriptPath, fallbackTime, fallbackTime)

    const [project] = await loadProjects()
    expect(project.sessions[0].updated).toBe(fallbackTime.toISOString())
  })

  it('normalizes transcript timestamps by chronology instead of line order', async () => {
    const projectPath = join(claudeDirectory, 'timestamp-order-workspace')
    await mkdir(projectPath)
    await writeFile(
      join(projectDirectory, `${SESSION_ID}.jsonl`),
      [
        JSON.stringify({
          cwd: projectPath,
          message: { content: [{ text: 'Done', type: 'text' }] },
          timestamp: '2026-06-01T10:00:00.001Z',
          type: 'assistant',
        }),
        JSON.stringify({
          cwd: projectPath,
          message: { content: 'Review timestamp ordering' },
          timestamp: '2026-06-01T10:00:00.000Z',
          type: 'user',
        }),
      ].join('\n')
    )

    const [project] = await loadProjects()
    expect(project.sessions[0]).toMatchObject({
      created: '2026-06-01T10:00:00.000Z',
      updated: '2026-06-01T10:00:00.001Z',
    })
  })

  it('keeps transcript-derived signals unknown when using the index fast path', async () => {
    const projectPath = join(claudeDirectory, 'indexed-workspace')
    await mkdir(projectPath)
    await Promise.all([
      writeFile(join(projectDirectory, `${SESSION_ID}.jsonl`), '{}'),
      writeFile(join(projectDirectory, `${SECOND_SESSION_ID}.jsonl`), '{}'),
    ])
    await writeFile(
      join(projectDirectory, 'sessions-index.json'),
      JSON.stringify({
        sessions: [
          {
            created: '2026-06-01T10:00:00.000Z',
            id: SESSION_ID,
            messageCount: 4,
            name: 'Indexed session',
            projectPath,
            updated: '2026-06-01T10:05:00.000Z',
          },
          {
            created: '2026-06-01T11:00:00.000Z',
            id: SECOND_SESSION_ID,
            messageCount: 2,
            name: 'Newer indexed session',
            projectPath,
            updated: '2026-06-01T11:05:00.000Z',
          },
        ],
      })
    )

    const [project] = await loadProjects()
    const [session, olderSession] = project.sessions

    expect(session.context).toEqual({
      latestContextTokens: null,
      latestModel: null,
      latestOutputTokens: null,
      models: null,
    })
    expect(session.signals).toMatchObject({
      analysisComplete: false,
      compactionCount: null,
      interrupted: null,
      lastToolFailed: null,
      pathExists: true,
    })
    expect([session.id, olderSession.id]).toEqual([SECOND_SESSION_ID, SESSION_ID])
  })

  it('filters non-resumable entries from the index fast path', async () => {
    const projectPath = join(claudeDirectory, 'indexed-workspace')
    await mkdir(projectPath)
    await Promise.all([
      writeFile(join(projectDirectory, `${SESSION_ID}.jsonl`), '{}'),
      writeFile(join(projectDirectory, `${SECOND_SESSION_ID}.jsonl`), '{}'),
    ])
    await writeFile(
      join(projectDirectory, 'sessions-index.json'),
      JSON.stringify({
        sessions: [
          {
            created: '2026-06-01T10:00:00.000Z',
            id: SESSION_ID,
            messageCount: 1,
            name: 'Resumable session',
            projectPath,
            updated: '2026-06-01T10:05:00.000Z',
          },
          {
            created: '2026-06-01T11:00:00.000Z',
            id: SECOND_SESSION_ID,
            messageCount: 0,
            name: 'Metadata-only remnant',
            projectPath,
            updated: '2026-06-01T11:05:00.000Z',
          },
          {
            created: '2026-06-01T12:00:00.000Z',
            id: THIRD_SESSION_ID,
            messageCount: 2,
            name: 'Missing transcript',
            projectPath,
            updated: '2026-06-01T12:05:00.000Z',
          },
        ],
      })
    )

    const [project] = await loadProjects()
    expect(project.sessions.map((session) => session.id)).toEqual([SESSION_ID])
  })

  it('normalizes indexed chronology and filters malformed indexed sessions', async () => {
    const projectPath = join(claudeDirectory, 'indexed-shape-workspace')
    await mkdir(projectPath)
    await Promise.all([
      writeFile(join(projectDirectory, `${SESSION_ID}.jsonl`), '{}'),
      writeFile(join(projectDirectory, `${SECOND_SESSION_ID}.jsonl`), '{}'),
      writeFile(join(projectDirectory, `${THIRD_SESSION_ID}.jsonl`), '{}'),
    ])
    await writeFile(
      join(projectDirectory, 'sessions-index.json'),
      JSON.stringify({
        sessions: [
          {
            created: '2026-06-01T10:05:00.000Z',
            id: SESSION_ID,
            messageCount: 1,
            name: 'Chronology drift',
            projectPath,
            updated: '2026-06-01T10:00:00.000Z',
          },
          {
            created: '2026-06-01T11:00:00.000Z',
            id: SECOND_SESSION_ID,
            messageCount: Number.NaN,
            name: 'Invalid count',
            projectPath,
            updated: '2026-06-01T11:05:00.000Z',
          },
          {
            created: 'not-a-date',
            id: THIRD_SESSION_ID,
            messageCount: 2,
            name: 'Invalid date',
            projectPath,
            updated: '2026-06-01T12:05:00.000Z',
          },
        ],
      })
    )

    const [project] = await loadProjects()
    expect(project.sessions).toHaveLength(1)
    expect(project.sessions[0]).toMatchObject({
      created: '2026-06-01T10:00:00.000Z',
      id: SESSION_ID,
      messageCount: 1,
      updated: '2026-06-01T10:05:00.000Z',
    })
    expect(project.sessions[0].signals.expiresInDays).not.toBeNaN()
  })

  it('surfaces fresh live lock sessions before their transcript exists in a scanned project', async () => {
    const projectPath = join(claudeDirectory, 'ghost-workspace')
    const encodedProjectId = encodeProjectPath(projectPath)
    await mkdir(projectPath)
    await mkdir(join(claudeDirectory, 'projects', encodedProjectId), { recursive: true })
    const startedAt = Date.now()
    await writeLiveSessionLock('live-known.json', THIRD_SESSION_ID, projectPath, startedAt)

    const projects = await loadProjects()
    const project = projects.find((candidate) => candidate.id === encodedProjectId)

    expect(project).toMatchObject({
      id: encodedProjectId,
      path: projectPath,
      sessions: [
        {
          id: THIRD_SESSION_ID,
          messageCount: 0,
          name: 'New session',
          projectPath,
          signals: {
            analysisComplete: false,
            pathExists: true,
          },
        },
      ],
    })
  })

  it('does not create an orphan project for an older live lock without a transcript directory', async () => {
    const projectPath = join(claudeDirectory, 'orphan-workspace')
    const startedAt = Date.now() - 60 * 60 * 1000
    await mkdir(projectPath)
    await writeLiveSessionLock('live-orphan.json', FOURTH_SESSION_ID, projectPath, startedAt)

    const projects = await loadProjects()

    expect(projects).toEqual([])
  })

  it('does not surface older lock-only sessions as real sessions in a scanned project', async () => {
    const projectPath = join(claudeDirectory, 'stale-ghost-workspace')
    const encodedProjectId = encodeProjectPath(projectPath)
    const startedAt = Date.now() - 60 * 60 * 1000
    await mkdir(projectPath)
    await mkdir(join(claudeDirectory, 'projects', encodedProjectId), { recursive: true })
    await writeLiveSessionLock('live-stale-known.json', FOURTH_SESSION_ID, projectPath, startedAt)

    const projects = await loadProjects()

    expect(projects).toEqual([])
  })

  it('keeps an older live session visible when its transcript file already exists', async () => {
    const projectPath = join(claudeDirectory, 'slow-first-flush-workspace')
    const encodedProjectId = encodeProjectPath(projectPath)
    const encodedProjectDirectory = join(claudeDirectory, 'projects', encodedProjectId)
    const startedAt = Date.now() - 60 * 60 * 1000
    await mkdir(projectPath)
    await mkdir(encodedProjectDirectory, { recursive: true })
    await writeFile(join(encodedProjectDirectory, `${FOURTH_SESSION_ID}.jsonl`), '')
    await writeLiveSessionLock(
      'live-slow-first-flush.json',
      FOURTH_SESSION_ID,
      projectPath,
      startedAt
    )

    const projects = await loadProjects()
    const project = projects.find((candidate) => candidate.id === encodedProjectId)

    expect(project).toMatchObject({
      id: encodedProjectId,
      path: projectPath,
      sessions: [
        {
          id: FOURTH_SESSION_ID,
          messageCount: 0,
          name: 'New session',
          projectPath,
        },
      ],
    })
  })

  it('surfaces real transcript metadata for a live session the metadata index has not caught up to yet', async () => {
    const projectPath = join(claudeDirectory, 'metadata-lag-workspace')
    const encodedProjectId = encodeProjectPath(projectPath)
    const encodedProjectDirectory = join(claudeDirectory, 'projects', encodedProjectId)
    await mkdir(projectPath)
    await mkdir(encodedProjectDirectory, { recursive: true })

    // A pre-existing, indexed session keeps loadProjects() on the metadata
    // index fast path, which is what shadows a just-started session's
    // transcript until Claude Code appends it to sessions-index.json.
    await writeFile(join(encodedProjectDirectory, `${SESSION_ID}.jsonl`), '{}')
    await writeFile(
      join(encodedProjectDirectory, 'sessions-index.json'),
      JSON.stringify({
        sessions: [
          {
            created: '2026-06-01T09:00:00.000Z',
            id: SESSION_ID,
            messageCount: 3,
            name: 'Already indexed session',
            projectPath,
            updated: '2026-06-01T09:05:00.000Z',
          },
        ],
      })
    )

    // The live session's transcript is already on disk with real content —
    // the index just has not listed it yet.
    await writeFile(
      join(encodedProjectDirectory, `${FOURTH_SESSION_ID}.jsonl`),
      [
        JSON.stringify({
          cwd: projectPath,
          message: { content: 'Investigate the flaky upload test' },
          timestamp: '2026-06-01T10:00:00.000Z',
          type: 'user',
        }),
        JSON.stringify({
          message: { content: [{ text: 'Looking into it', type: 'text' }] },
          timestamp: '2026-06-01T10:01:00.000Z',
          type: 'assistant',
        }),
      ].join('\n')
    )
    await writeLiveSessionLock('live-metadata-lag.json', FOURTH_SESSION_ID, projectPath)

    const projects = await loadProjects()
    const project = projects.find((candidate) => candidate.id === encodedProjectId)
    const liveSession = project?.sessions.find((session) => session.id === FOURTH_SESSION_ID)

    // Regression: addGhostSessions used to always fall back to a 0-message
    // ghost here, which isResumeVisibleSession then filtered out of the web
    // session list entirely — a live session with a full transcript vanished.
    expect(liveSession).toMatchObject({
      id: FOURTH_SESSION_ID,
      messageCount: 2,
      name: 'Investigate the flaky upload test',
      projectPath,
    })
  })

  if (process.platform === 'win32') {
    it('matches older live sessions by encoded project id when Windows reports a short cwd alias', async () => {
      const projectPath =
        'C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\reup-loading-test-ci\\slow-first-flush-workspace'
      const encodedProjectId = encodeProjectPath(projectPath)
      const encodedProjectDirectory = join(claudeDirectory, 'projects', encodedProjectId)
      const startedAt = Date.now() - 60 * 60 * 1000
      await mkdir(encodedProjectDirectory, { recursive: true })
      await writeFile(join(encodedProjectDirectory, `${FOURTH_SESSION_ID}.jsonl`), '')
      await writeLiveSessionLock(
        'live-short-cwd-first-flush.json',
        FOURTH_SESSION_ID,
        projectPath,
        startedAt
      )

      const projects = await loadProjects()
      const project = projects.find((candidate) => candidate.id === encodedProjectId)

      expect(project).toMatchObject({
        id: encodedProjectId,
        path: projectPath,
        sessions: [
          {
            id: FOURTH_SESSION_ID,
            messageCount: 0,
            name: 'New session',
            projectPath,
          },
        ],
      })
    })
  }

  it('resolves current branches independently for sessions in different working directories', async () => {
    const firstWorkspace = join(claudeDirectory, 'first-workspace')
    const secondWorkspace = join(claudeDirectory, 'second-workspace')
    await Promise.all([
      createGitRepository(firstWorkspace, 'feat/first'),
      createGitRepository(secondWorkspace, 'fix/second'),
    ])
    await Promise.all([
      writeSessionTranscript(SESSION_ID, firstWorkspace, 'recorded/first'),
      writeSessionTranscript(SECOND_SESSION_ID, secondWorkspace, 'recorded/second'),
    ])

    const [project] = await loadProjects()
    const branchesBySessionId = new Map(
      project.sessions.map((session) => [session.id, session.currentBranch])
    )

    expect(branchesBySessionId.get(SESSION_ID)).toBe('feat/first')
    expect(branchesBySessionId.get(SECOND_SESSION_ID)).toBe('fix/second')
    // Twelve git processes: five per repository plus one branch read each.
    // Process creation on a loaded Windows agent pushed this past the 5s
    // default, and the timeout then left git holding the working directory,
    // failing cleanup with EBUSY. The assertion is about branch resolution,
    // never about how fast git starts.
  }, 30_000)

  async function createGitRepository(directory: string, branch: string): Promise<void> {
    await mkdir(directory)
    await executeFile('git', ['init', '-q'], { cwd: directory })
    await executeFile('git', ['config', 'user.email', 'reup-tests@example.invalid'], {
      cwd: directory,
    })
    await executeFile('git', ['config', 'user.name', 'reup tests'], { cwd: directory })
    await executeFile('git', ['commit', '--allow-empty', '-q', '-m', 'initial'], { cwd: directory })
    await executeFile('git', ['checkout', '-q', '-b', branch], { cwd: directory })
  }

  async function writeSessionTranscript(
    sessionId: string,
    projectPath: string,
    recordedBranch: string
  ): Promise<void> {
    await writeFile(
      join(projectDirectory, `${sessionId}.jsonl`),
      JSON.stringify({
        cwd: projectPath,
        gitBranch: recordedBranch,
        message: { content: 'hello' },
        timestamp: new Date().toISOString(),
        type: 'user',
      })
    )
  }

  async function writeLiveSessionLock(
    fileName: string,
    sessionId: string,
    cwd: string,
    startedAt?: number
  ): Promise<void> {
    const sessionsDirectory = join(claudeDirectory, 'sessions')
    const payload: { cwd: string; pid: number; sessionId: string; startedAt?: number } = {
      cwd,
      pid: process.pid,
      sessionId,
    }
    if (startedAt !== undefined) payload.startedAt = startedAt
    await mkdir(sessionsDirectory, { recursive: true })
    await writeFile(join(sessionsDirectory, fileName), JSON.stringify(payload))
  }
})
