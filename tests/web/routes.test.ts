import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { buildApp } from '../../src/web/routes.js'

const PROJECT_ID = 'known-project'
const SESSION_ID = '00000000-0000-0000-0000-000000000001'
const LOCK_ONLY_SESSION_ID = '00000000-0000-0000-0000-000000000002'

describe('web routes', () => {
  let claudeDirectory: string
  let originalClaudeDirectory: string | undefined

  beforeEach(async () => {
    claudeDirectory = await mkdtemp(join(tmpdir(), 'reup-routes-test-'))
    originalClaudeDirectory = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = claudeDirectory
  })

  afterEach(async () => {
    if (originalClaudeDirectory === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalClaudeDirectory
    await rm(claudeDirectory, { force: true, recursive: true })
  })

  it('returns an empty project list for a fresh Claude directory', async () => {
    const response = await buildApp().request('/api/projects')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual([])
  })

  it('rejects state-changing requests from a non-local host', async () => {
    const response = await buildApp().request('/api/resume/not-a-session', {
      method: 'POST',
      headers: { Host: 'example.com' },
    })

    expect(response.status).toBe(403)
  })

  it('rejects state-changing requests from a non-local origin', async () => {
    const response = await buildApp().request('/api/resume/not-a-session', {
      method: 'POST',
      headers: { Host: 'localhost', Origin: 'https://example.com' },
    })

    expect(response.status).toBe(403)
  })

  it('rejects state-changing requests from a different localhost origin', async () => {
    const response = await buildApp().request('/api/theme', {
      body: JSON.stringify({ name: 'terminal' }),
      headers: {
        'Content-Type': 'application/json',
        Host: 'localhost:4672',
        Origin: 'http://localhost:9999',
      },
      method: 'POST',
    })

    expect(response.status).toBe(403)
  })

  it('allows state-changing requests from the same localhost origin', async () => {
    const response = await buildApp().request('/api/theme', {
      body: JSON.stringify({ name: 'terminal' }),
      headers: {
        'Content-Type': 'application/json',
        Host: 'localhost:4672',
        Origin: 'http://localhost:4672',
      },
      method: 'POST',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
  })

  it('protects theme persistence from non-local origins', async () => {
    const response = await buildApp().request('/api/theme', {
      body: JSON.stringify({ name: 'terminal' }),
      headers: {
        'Content-Type': 'text/plain',
        Host: 'localhost',
        Origin: 'https://example.com',
      },
      method: 'POST',
    })

    expect(response.status).toBe(403)
  })

  it('returns experimental sync status without mutating state', async () => {
    const response = await buildApp().request('/api/sync')
    const body = (await response.json()) as { enabled: boolean; projects: unknown[] }

    expect(response.status).toBe(200)
    expect(body.enabled).toBe(false)
    expect(body.projects).toEqual([])
  })

  it('protects experimental sync feature toggles from non-local origins', async () => {
    const response = await buildApp().request('/api/sync/feature', {
      body: JSON.stringify({ enabled: true }),
      headers: {
        'Content-Type': 'application/json',
        Host: 'localhost',
        Origin: 'https://example.com',
      },
      method: 'POST',
    })

    expect(response.status).toBe(403)
  })

  it('rejects sync mutations while the experimental feature is disabled', async () => {
    const response = await buildApp().request('/api/sync/link', {
      body: JSON.stringify({ path: claudeDirectory }),
      headers: { 'Content-Type': 'application/json', Host: 'localhost' },
      method: 'POST',
    })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'cross-device session storage is disabled',
    })
  })

  it('enables sync globally without linking projects automatically', async () => {
    const response = await buildApp().request('/api/sync/feature', {
      body: JSON.stringify({ enabled: true }),
      headers: { 'Content-Type': 'application/json', Host: 'localhost' },
      method: 'POST',
    })
    const body = (await response.json()) as { enabled: boolean; linkedProjects: unknown[] }

    expect(response.status).toBe(200)
    expect(body.enabled).toBe(true)
    expect(body.linkedProjects).toEqual([])
  })

  it('rejects inherited object properties as theme names', async () => {
    const response = await buildApp().request('/api/theme', {
      body: JSON.stringify({ name: 'toString' }),
      headers: { 'Content-Type': 'application/json', Host: 'localhost' },
      method: 'POST',
    })

    expect(response.status).toBe(400)
  })

  it('validates session IDs before parsing resume request bodies', async () => {
    const response = await buildApp().request('/api/resume/not-a-session', {
      method: 'POST',
      headers: { Host: 'localhost' },
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'invalid session id' })
  })

  it('returns no results for an empty search query', async () => {
    const response = await buildApp().request('/api/search?q=')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual([])
  })

  it('searches globally by stable project and session IDs', async () => {
    await createKnownSession()

    for (const query of [PROJECT_ID, SESSION_ID.slice(0, 8)]) {
      const response = await buildApp().request(`/api/search?q=${query}`)
      const results = (await response.json()) as Array<{ id: string }>

      expect(response.status).toBe(200)
      expect(results).toContainEqual(expect.objectContaining({ id: SESSION_ID }))
    }
  })

  it('returns the shared non-destructive diagnostics report', async () => {
    const response = await buildApp().request('/api/diagnostics')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      brokenIndices: [],
      expiring: [],
      orphanedTranscripts: [],
      pathMissing: [],
      staleLocks: [],
    })
  })

  it('returns an honest unavailable usage summary before capture is configured', async () => {
    const response = await buildApp().request('/api/usage')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      captureIssue: null,
      captureStatus: 'off',
      configured: false,
      freshness: 'unavailable',
      limitsIssue: null,
      limitsSource: 'unavailable',
      limitsStatus: 'unavailable',
      limitsUpdatedAt: null,
      rateLimits: {},
      snapshot: null,
      updateStrategy: 'account-api-with-status-line-fallback',
      updatedAt: null,
      usageCreditsEnabled: null,
    })
  })

  it('serializes the derived primary status for API consumers', async () => {
    await createKnownSession()

    const response = await buildApp().request('/api/projects')
    const projects = (await response.json()) as Array<{
      sessions: Array<{ id: string; primaryStatus: string }>
    }>

    expect(projects[0]?.sessions[0]).toMatchObject({
      id: SESSION_ID,
      primaryStatus: 'ok',
    })
  })

  it('returns compact session preview data for the web Resume Card', async () => {
    await createKnownSession()

    const response = await buildApp().request(`/api/sessions/${PROJECT_ID}/${SESSION_ID}/preview`)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      automaticContext: {
        execution: {
          cwd: claudeDirectory,
        },
        todos: {
          counts: { completed: 0, in_progress: 0, pending: 0, unknown: 0 },
          items: [],
          source: null,
        },
      },
      goal: 'hello',
      lastResponse: null,
      pendingToolName: null,
      touchedFiles: [],
    })
  })

  it('returns transcript events only for a discovered session in the requested project', async () => {
    await createKnownSession()

    const response = await buildApp().request(`/api/session/${SESSION_ID}?project=${PROJECT_ID}`)
    const body = (await response.json()) as { events: Array<{ type: string }> }

    expect(response.status).toBe(200)
    expect(body.events).toEqual([expect.objectContaining({ type: 'user' })])
  })

  it('does not expose a transcript that is not part of the discovered session model', async () => {
    await createKnownSession()
    const projectDirectory = join(claudeDirectory, 'projects', PROJECT_ID)
    await writeFile(
      join(projectDirectory, `${LOCK_ONLY_SESSION_ID}.jsonl`),
      JSON.stringify({
        summary: 'metadata only orphan',
        timestamp: new Date().toISOString(),
        type: 'summary',
      })
    )

    const response = await buildApp().request(
      `/api/session/${LOCK_ONLY_SESSION_ID}?project=${PROJECT_ID}`
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'session not found' })
  })

  it('hides older lock-only live processes from projects and live activity', async () => {
    const projectPath = join(claudeDirectory, 'live-process-workspace')
    const sessionsDirectory = join(claudeDirectory, 'sessions')
    await mkdir(projectPath)
    await mkdir(sessionsDirectory, { recursive: true })
    await writeFile(
      join(sessionsDirectory, 'lock-only.json'),
      JSON.stringify({
        cwd: projectPath,
        pid: process.pid,
        sessionId: LOCK_ONLY_SESSION_ID,
        startedAt: Date.now() - 60 * 60 * 1000,
      })
    )

    const [projectsResponse, liveResponse] = await Promise.all([
      buildApp().request('/api/projects'),
      buildApp().request('/api/live-activity'),
    ])

    expect(await projectsResponse.json()).toEqual([])
    expect(await liveResponse.json()).toEqual([])
  })

  it('returns a Markdown handoff packet for the web action bar', async () => {
    await createKnownSession()

    const response = await buildApp().request(`/api/sessions/${PROJECT_ID}/${SESSION_ID}/handoff`)
    const body = (await response.json()) as { context: { goal?: string }; markdown: string }

    expect(response.status).toBe(200)
    expect(body.context.goal).toBe('hello')
    expect(body.markdown).toContain('# Reup Handoff:')
    expect(body.markdown).toContain('## Goal\n\nhello')
    expect(body.markdown).toContain(`claude --resume ${SESSION_ID}`)
  })

  it('validates archive request bodies before writing metadata', async () => {
    await createKnownSession()

    const response = await buildApp().request(`/api/sessions/${PROJECT_ID}/${SESSION_ID}/archive`, {
      body: JSON.stringify({ archived: 'false' }),
      headers: { 'Content-Type': 'application/json', Host: 'localhost' },
      method: 'POST',
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'archived must be boolean' })
  })

  it('refuses to delete an active session', async () => {
    await createKnownSession()
    const sessionsDirectory = join(claudeDirectory, 'sessions')
    await mkdir(sessionsDirectory, { recursive: true })
    await writeFile(
      join(sessionsDirectory, `${SESSION_ID}.json`),
      JSON.stringify({ pid: process.pid, sessionId: SESSION_ID })
    )

    const response = await buildApp().request(`/api/sessions/${PROJECT_ID}/${SESSION_ID}`, {
      headers: { Host: 'localhost' },
      method: 'DELETE',
    })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'cannot delete an active session' })
  })

  async function createKnownSession(): Promise<void> {
    const projectDirectory = join(claudeDirectory, 'projects', PROJECT_ID)
    await mkdir(projectDirectory, { recursive: true })
    await writeFile(
      join(projectDirectory, `${SESSION_ID}.jsonl`),
      JSON.stringify({
        cwd: claudeDirectory,
        message: { content: 'hello' },
        timestamp: new Date().toISOString(),
        type: 'user',
      })
    )
  }
})
