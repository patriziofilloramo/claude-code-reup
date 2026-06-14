import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'

import { loadProjects } from '../../src/core/project-discovery.js'

const PROJECT_ID = 'project-fixture'
const SESSION_ID = '00000000-0000-0000-0000-000000000001'
const SECOND_SESSION_ID = '00000000-0000-0000-0000-000000000002'
const THIRD_SESSION_ID = '00000000-0000-0000-0000-000000000003'
const executeFile = promisify(execFile)

describe('session loading', () => {
  let claudeDirectory: string
  let projectDirectory: string
  let originalClaudeDirectory: string | undefined

  beforeEach(async () => {
    claudeDirectory = await mkdtemp(join(tmpdir(), 'ccm-loading-test-'))
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

  it('derives session metadata from JSONL and merges CCM sidecar metadata', async () => {
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
      join(projectDirectory, 'ccm.json'),
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
  })

  async function createGitRepository(directory: string, branch: string): Promise<void> {
    await mkdir(directory)
    await executeFile('git', ['init', '-q'], { cwd: directory })
    await executeFile('git', ['config', 'user.email', 'ccm-tests@example.invalid'], {
      cwd: directory,
    })
    await executeFile('git', ['config', 'user.name', 'ccm tests'], { cwd: directory })
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
})
