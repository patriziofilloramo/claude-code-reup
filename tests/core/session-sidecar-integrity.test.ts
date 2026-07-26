import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { loadProjects } from '../../src/core/project/project-discovery.js'
import { invalidateProjectCache } from '../../src/core/project/project-cache.js'
import {
  mergeProjectSidecarMetadata,
  ProjectSidecarUnreadableError,
  setProjectTags,
  setSessionAlias,
  setSessionArchived,
  setSessionTags,
} from '../../src/core/session/session-metadata.js'

const PROJECT_ID = 'C--work-billing'
const SESSION_ID = '11111111-2222-3333-4444-555555555555'
const OTHER_SESSION_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

/**
 * A sidecar Reup cannot read is not the same as a project without metadata.
 *
 * Collapsing the two used to make a single archive toggle rewrite reup.json
 * from an empty object, discarding every alias, tag, and archive flag it still
 * held — and report success while doing it.
 */
describe('project sidecar integrity', () => {
  let claudeDirectory: string
  let projectDirectory: string
  let sidecarPath: string
  let originalClaudeConfigDirectory: string | undefined

  const POPULATED_SIDECAR = {
    projectTags: ['billing', 'prod'],
    sessions: {
      [SESSION_ID]: { alias: 'Payment refactor', tags: ['prod'] },
      [OTHER_SESSION_ID]: { alias: 'Auth migration', archived: true },
    },
  }

  beforeEach(async () => {
    claudeDirectory = await mkdtemp(join(tmpdir(), 'reup-sidecar-test-'))
    originalClaudeConfigDirectory = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = claudeDirectory
    projectDirectory = join(claudeDirectory, 'projects', PROJECT_ID)
    sidecarPath = join(projectDirectory, 'reup.json')
    await mkdir(projectDirectory, { recursive: true })
    invalidateProjectCache()
  })

  afterEach(async () => {
    if (originalClaudeConfigDirectory === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDirectory
    await chmod(sidecarPath, 0o600).catch(() => {})
    await rm(claudeDirectory, { force: true, recursive: true })
    invalidateProjectCache()
  })

  async function writeTruncatedSidecar(): Promise<string> {
    // The shape a crash, a full disk, or an interrupted write leaves behind.
    const truncated = JSON.stringify(POPULATED_SIDECAR, null, 2).slice(0, 120)
    await writeFile(sidecarPath, truncated, 'utf8')
    return truncated
  }

  describe('refuses to overwrite metadata it cannot read', () => {
    it('rejects an archive toggle instead of replacing a truncated sidecar', async () => {
      const truncated = await writeTruncatedSidecar()

      await expect(setSessionArchived(PROJECT_ID, SESSION_ID, true)).rejects.toThrow(
        ProjectSidecarUnreadableError
      )
      await expect(readFile(sidecarPath, 'utf8')).resolves.toBe(truncated)
    })

    it('rejects every metadata writer, not just archiving', async () => {
      const truncated = await writeTruncatedSidecar()

      await expect(setSessionAlias(PROJECT_ID, SESSION_ID, 'renamed')).rejects.toThrow(
        ProjectSidecarUnreadableError
      )
      await expect(setSessionTags(PROJECT_ID, SESSION_ID, ['keep'])).rejects.toThrow(
        ProjectSidecarUnreadableError
      )
      await expect(setProjectTags(PROJECT_ID, ['keep'])).rejects.toThrow(
        ProjectSidecarUnreadableError
      )
      await expect(readFile(sidecarPath, 'utf8')).resolves.toBe(truncated)
    })

    it('names the file to repair so the failure is actionable', async () => {
      await writeTruncatedSidecar()

      await expect(setSessionArchived(PROJECT_ID, SESSION_ID, true)).rejects.toThrow(
        /reup\.json[\s\S]*refusing to overwrite/
      )
    })

    it('treats a JSON root that is not an object as unreadable', async () => {
      await writeFile(sidecarPath, '["not", "an", "object"]', 'utf8')

      await expect(setSessionArchived(PROJECT_ID, SESSION_ID, true)).rejects.toThrow(
        ProjectSidecarUnreadableError
      )
      await expect(readFile(sidecarPath, 'utf8')).resolves.toBe('["not", "an", "object"]')
    })
  })

  describe('still treats a genuinely absent sidecar as empty metadata', () => {
    it('creates the sidecar on the first write', async () => {
      await setSessionArchived(PROJECT_ID, SESSION_ID, true)

      const written = JSON.parse(await readFile(sidecarPath, 'utf8')) as Record<string, unknown>
      expect(written).toEqual({ sessions: { [SESSION_ID]: { archived: true } } })
    })

    it('preserves unrelated entries when updating a readable sidecar', async () => {
      await writeFile(sidecarPath, JSON.stringify(POPULATED_SIDECAR), 'utf8')

      await setSessionArchived(PROJECT_ID, SESSION_ID, true)

      const written = JSON.parse(await readFile(sidecarPath, 'utf8')) as typeof POPULATED_SIDECAR
      expect(written.projectTags).toEqual(['billing', 'prod'])
      expect(written.sessions[OTHER_SESSION_ID]).toEqual({
        alias: 'Auth migration',
        archived: true,
      })
      expect(written.sessions[SESSION_ID]).toEqual({
        alias: 'Payment refactor',
        archived: true,
        tags: ['prod'],
      })
    })
  })

  describe('keeps reads best-effort so one damaged file cannot hide a project', () => {
    it('merges no metadata rather than throwing', async () => {
      await writeTruncatedSidecar()

      const project = await mergeProjectSidecarMetadata(projectDirectory, {
        id: PROJECT_ID,
        path: 'C:/work/billing',
        sessions: [],
      })

      expect(project.projectTags).toBeUndefined()
      expect(project.sessions).toEqual([])
    })

    it('still lists the project during discovery', async () => {
      await writeTruncatedSidecar()
      await writeFile(
        join(projectDirectory, `${SESSION_ID}.jsonl`),
        JSON.stringify({
          cwd: 'C:/work/billing',
          message: { content: 'hello' },
          timestamp: new Date().toISOString(),
          type: 'user',
        })
      )
      invalidateProjectCache()

      const projects = await loadProjects()

      expect(projects.map((project) => project.id)).toContain(PROJECT_ID)
    })
  })
})
