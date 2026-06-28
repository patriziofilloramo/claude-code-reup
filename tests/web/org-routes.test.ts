import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { buildApp } from '../../src/web/routes.js'

const PROJECT_ID = 'known-project'
const SESSION_ID = '00000000-0000-0000-0000-000000000001'

describe('org routes', () => {
  let claudeDirectory: string
  let originalClaudeDirectory: string | undefined

  beforeEach(async () => {
    claudeDirectory = await mkdtemp(join(tmpdir(), 'reup-org-routes-test-'))
    originalClaudeDirectory = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = claudeDirectory
    await mkdir(join(claudeDirectory, 'reup'), { recursive: true })
  })

  afterEach(async () => {
    if (originalClaudeDirectory === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalClaudeDirectory
    await rm(claudeDirectory, { force: true, recursive: true })
  })

  // ---------------------------------------------------------------------------
  // GET /api/org
  // ---------------------------------------------------------------------------

  it('returns an empty org state for a fresh reup directory', async () => {
    const response = await buildApp().request('/api/org')
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      schemaVersion: 1,
      groups: [],
      stacks: [],
      tagPalette: [],
      projectGroupAssignments: {},
    })
  })

  // ---------------------------------------------------------------------------
  // POST /api/org/groups — create
  // ---------------------------------------------------------------------------

  it('creates a group via POST /api/org/groups', async () => {
    const response = await buildApp().request('/api/org/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Host: 'localhost' },
      body: JSON.stringify({ name: 'Work', color: '#00ff00' }),
    })
    expect(response.status).toBe(201)
    const body = (await response.json()) as { group: { name: string; id: string } }
    expect(body.group.name).toBe('Work')
    expect(typeof body.group.id).toBe('string')
  })

  it('rejects an empty group name', async () => {
    const response = await buildApp().request('/api/org/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Host: 'localhost' },
      body: JSON.stringify({ name: '   ' }),
    })
    expect(response.status).toBe(400)
  })

  it('rejects a duplicate group name', async () => {
    const app = buildApp()
    await app.request('/api/org/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Host: 'localhost' },
      body: JSON.stringify({ name: 'Work' }),
    })
    const response = await app.request('/api/org/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Host: 'localhost' },
      body: JSON.stringify({ name: 'work' }),
    })
    expect(response.status).toBe(400)
  })

  it('rejects group creation from a non-local origin', async () => {
    const response = await buildApp().request('/api/org/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Host: 'example.com' },
      body: JSON.stringify({ name: 'Work' }),
    })
    expect(response.status).toBe(403)
  })

  // ---------------------------------------------------------------------------
  // DELETE /api/org/groups/:groupId — deletes group and clears assignments
  // ---------------------------------------------------------------------------

  it('deletes a group and clears its project assignments', async () => {
    const app = buildApp()

    // Create group
    const createResp = await app.request('/api/org/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Host: 'localhost' },
      body: JSON.stringify({ name: 'ToDelete' }),
    })
    const { group } = (await createResp.json()) as { group: { id: string } }

    // Assign a project
    await app.request(`/api/projects/${PROJECT_ID}/group`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Host: 'localhost' },
      body: JSON.stringify({ groupId: group.id }),
    })

    // Delete the group
    const deleteResp = await app.request(`/api/org/groups/${group.id}`, {
      method: 'DELETE',
      headers: { Host: 'localhost' },
    })
    expect(deleteResp.status).toBe(200)

    // Verify org state: group gone, assignment cleared
    const orgResp = await app.request('/api/org')
    const orgBody = (await orgResp.json()) as {
      groups: unknown[]
      projectGroupAssignments: Record<string, string>
    }
    expect(orgBody.groups).toHaveLength(0)
    expect(orgBody.projectGroupAssignments[PROJECT_ID]).toBeUndefined()
  })

  it('returns 404 when deleting a non-existent group', async () => {
    const response = await buildApp().request('/api/org/groups/no-such-group', {
      method: 'DELETE',
      headers: { Host: 'localhost' },
    })
    expect(response.status).toBe(404)
  })

  // ---------------------------------------------------------------------------
  // Stacks
  // ---------------------------------------------------------------------------

  it('creates a stack via POST /api/org/stacks', async () => {
    const response = await buildApp().request('/api/org/stacks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Host: 'localhost' },
      body: JSON.stringify({ name: 'Sprint 1' }),
    })
    expect(response.status).toBe(201)
    const body = (await response.json()) as { stack: { name: string } }
    expect(body.stack.name).toBe('Sprint 1')
  })

  it('adds an item to a stack', async () => {
    const app = buildApp()
    const createResp = await app.request('/api/org/stacks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Host: 'localhost' },
      body: JSON.stringify({ name: 'Sprint 1' }),
    })
    const { stack } = (await createResp.json()) as { stack: { id: string } }

    const addResp = await app.request(`/api/org/stacks/${stack.id}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Host: 'localhost' },
      body: JSON.stringify({ kind: 'project', projectId: 'proj-a' }),
    })
    expect(addResp.status).toBe(200)
  })

  // ---------------------------------------------------------------------------
  // PUT /api/projects/:projectId/sessions/:sessionId/tags
  // ---------------------------------------------------------------------------

  it('accepts and normalizes session tags', async () => {
    await createKnownSession()

    const response = await buildApp().request(
      `/api/projects/${PROJECT_ID}/sessions/${SESSION_ID}/tags`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Host: 'localhost' },
        body: JSON.stringify({ tags: ['Bug', ' FEATURE '] }),
      }
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
  })

  it('rejects tags that contain invalid characters', async () => {
    await createKnownSession()

    const response = await buildApp().request(
      `/api/projects/${PROJECT_ID}/sessions/${SESSION_ID}/tags`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Host: 'localhost' },
        body: JSON.stringify({ tags: ['bad tag!'] }),
      }
    )
    expect(response.status).toBe(400)
  })

  it('rejects more than 8 tags', async () => {
    await createKnownSession()

    const response = await buildApp().request(
      `/api/projects/${PROJECT_ID}/sessions/${SESSION_ID}/tags`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Host: 'localhost' },
        body: JSON.stringify({ tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'] }),
      }
    )
    expect(response.status).toBe(400)
  })

  it('rejects a non-array tags body', async () => {
    await createKnownSession()

    const response = await buildApp().request(
      `/api/projects/${PROJECT_ID}/sessions/${SESSION_ID}/tags`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Host: 'localhost' },
        body: JSON.stringify({ tags: 'bug' }),
      }
    )
    expect(response.status).toBe(400)
  })

  // ---------------------------------------------------------------------------
  // GET /api/projects?tag= — tag filter
  // ---------------------------------------------------------------------------

  it('filters projects by tag via /api/projects?tag=bug', async () => {
    await createKnownSession()
    const app = buildApp()

    // Tag the session
    await app.request(`/api/projects/${PROJECT_ID}/sessions/${SESSION_ID}/tags`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Host: 'localhost' },
      body: JSON.stringify({ tags: ['bug'] }),
    })

    const response = await app.request('/api/projects?tag=bug')
    expect(response.status).toBe(200)
    const projects = (await response.json()) as Array<{ id: string; sessions: unknown[] }>
    expect(projects.some((p) => p.id === PROJECT_ID)).toBe(true)
  })

  it('returns empty list when no sessions match the tag', async () => {
    await createKnownSession()

    const response = await buildApp().request('/api/projects?tag=nonexistent-tag')
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual([])
  })

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

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
