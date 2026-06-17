import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  classifyProjectForSync,
  MANAGED_PERMISSION_RULES,
  patchClaudeLocalSettingsForSync,
  patchClaudeMdSection,
  patchGitignoreForSync,
} from '../../src/core/sync/sync-actions.js'
import type { Project } from '../../src/core/session/session-model.js'

describe('sync actions', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'swoop-sync-actions-test-'))
  })

  afterEach(async () => {
    await rm(root, { force: true, recursive: true })
  })

  it('classifies linked, cloud, local, and active projects without transcript scans', () => {
    const cloudRoot = join(root, 'OneDrive')
    const cloudProject = project(join(cloudRoot, 'repo'))
    const linkedProject = project(join(root, 'linked'), { isShared: true })
    const activeProject = project(join(root, 'active'))

    expect(classifyProjectForSync(cloudProject, [cloudRoot], [])).toMatchObject({
      isCloudProject: true,
      kind: 'cloud-candidate',
    })
    expect(classifyProjectForSync(linkedProject, [cloudRoot], [])).toMatchObject({
      isShared: true,
      kind: 'linked',
    })
    expect(classifyProjectForSync(activeProject, [cloudRoot], [activeProject.path])).toMatchObject({
      isActive: true,
      kind: 'active-disabled',
    })
    expect(classifyProjectForSync(project(join(root, 'local')), [cloudRoot], [])).toMatchObject({
      kind: 'local-candidate',
    })
  })

  it('patches the CLAUDE.md sync section idempotently while preserving user text', async () => {
    const projectPath = join(root, 'project')
    await mkdir(projectPath)
    await writeFile(join(projectPath, 'CLAUDE.md'), '# User Notes\n\nKeep this.\n', 'utf8')

    await patchClaudeMdSection(projectPath, join(projectPath, '.claude-memory'), 'device-a')
    await patchClaudeMdSection(projectPath, join(projectPath, '.claude-memory'), 'device-a')

    const content = await readFile(join(projectPath, 'CLAUDE.md'), 'utf8')
    expect(content).toContain('# User Notes')
    expect(content.match(/<!-- swoop:sync:start -->/g)).toHaveLength(1)
    expect(content.match(/<!-- swoop:sync:end -->/g)).toHaveLength(1)
  })

  it('patches .gitignore idempotently', async () => {
    const projectPath = join(root, 'project')
    await mkdir(projectPath)
    await writeFile(join(projectPath, '.gitignore'), 'dist/\n', 'utf8')

    await patchGitignoreForSync(projectPath)
    await patchGitignoreForSync(projectPath)

    const lines = (await readFile(join(projectPath, '.gitignore'), 'utf8')).trim().split(/\r?\n/)
    expect(lines).toEqual(['dist/', '.claude-memory/'])
  })

  it('merges scoped permission rules without deleting user settings', async () => {
    const projectPath = join(root, 'project')
    await mkdir(join(projectPath, '.claude'), { recursive: true })
    await writeFile(
      join(projectPath, '.claude', 'settings.local.json'),
      JSON.stringify({ permissions: { allow: ['Bash(git status)'] }, theme: 'user' }),
      'utf8'
    )

    await patchClaudeLocalSettingsForSync(projectPath)
    await patchClaudeLocalSettingsForSync(projectPath)

    const settings = JSON.parse(
      await readFile(join(projectPath, '.claude', 'settings.local.json'), 'utf8')
    ) as { permissions: { allow: string[] }; theme: string }
    expect(settings.theme).toBe('user')
    expect(settings.permissions.allow).toContain('Bash(git status)')
    for (const rule of MANAGED_PERMISSION_RULES) {
      expect(settings.permissions.allow).toContain(rule)
      expect(settings.permissions.allow.filter((candidate) => candidate === rule)).toHaveLength(1)
    }
  })
})

function project(path: string, overrides: Partial<Project> = {}): Project {
  return {
    id: path.replace(/[^a-z0-9]/gi, '-'),
    isShared: false,
    path,
    sessions: [],
    ...overrides,
  }
}
