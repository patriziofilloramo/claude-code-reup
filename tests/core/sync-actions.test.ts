import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, parse, resolve } from 'node:path'
import { tmpdir } from 'node:os'

import {
  classifyProjectForSync,
  discoverCloudLinkedProjects,
  forgetProjectForSync,
  getCurrentProjectSyncAction,
  isUnderCloudRoot,
  MANAGED_PERMISSION_RULES,
  normalizeCloudRoot,
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

  it('derives one authoritative current-project action for UI and execution', () => {
    const local = classifyProjectForSync(project(join(root, 'local')), [], [])
    const linked = classifyProjectForSync(project(join(root, 'linked'), { isShared: true }), [], [])
    const activeLocal = { ...local, isActive: true }
    const activeLinked = { ...linked, isActive: true }

    expect(getCurrentProjectSyncAction()).toBe('link')
    expect(getCurrentProjectSyncAction(local)).toBe('link')
    expect(getCurrentProjectSyncAction(linked)).toBe('unlink')
    expect(getCurrentProjectSyncAction(activeLocal)).toBe('blocked-local')
    expect(getCurrentProjectSyncAction(activeLinked)).toBe('blocked-linked')
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

  it('forgets only the local copy of an unlinked project with Project Memory', async () => {
    const previousClaudeConfig = process.env['CLAUDE_CONFIG_DIR']
    const claudeDirectory = join(root, '.claude')
    process.env['CLAUDE_CONFIG_DIR'] = claudeDirectory

    try {
      const projectPath = join(root, 'Cloud', 'Project')
      const cloudPath = join(projectPath, '.claude-memory')
      const item = project(projectPath, { cloudPath })
      const localDirectory = join(claudeDirectory, 'projects', item.id)
      await mkdir(cloudPath, { recursive: true })
      await mkdir(localDirectory, { recursive: true })
      await writeFile(join(localDirectory, 'local-session.jsonl'), 'recover me\n', 'utf8')

      const result = await forgetProjectForSync(projectPath, { projects: [item] })

      expect(result.status).toBe('forgotten')
      await expect(access(localDirectory)).rejects.toThrow()
      const archivedRoot = join(claudeDirectory, 'swoop', 'forgotten', item.id)
      const timestamps = await readdir(archivedRoot)
      expect(timestamps).toHaveLength(1)
      expect(
        await readFile(
          join(archivedRoot, timestamps[0]!, 'project-data', 'local-session.jsonl'),
          'utf8'
        )
      ).toBe('recover me\n')
      expect(await access(cloudPath).then(() => true)).toBe(true)
    } finally {
      if (previousClaudeConfig === undefined) delete process.env['CLAUDE_CONFIG_DIR']
      else process.env['CLAUDE_CONFIG_DIR'] = previousClaudeConfig
    }
  })

  it('rejects forgetting a project without reachable Project Memory', async () => {
    await expect(
      forgetProjectForSync(join(root, 'local'), {
        projects: [project(join(root, 'local'))],
      })
    ).rejects.toThrow('only for projects with reachable Project Memory')
  })
})

describe('discoverCloudLinkedProjects', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'swoop-discover-test-'))
  })

  afterEach(async () => {
    await rm(root, { force: true, recursive: true })
  })

  it('returns a cloud-candidate for a project linked from another device', async () => {
    const projectPath = join(root, 'MyProject')
    await mkdir(join(projectPath, '.claude-memory', 'linked'), { recursive: true })
    await mkdir(join(projectPath, '.claude-memory', 'linked', 'not-a-device-directory'))
    await writeFile(join(projectPath, '.claude-memory', 'linked', 'z-device'), '', 'utf8')
    await writeFile(join(projectPath, '.claude-memory', 'linked', 'a-device'), '', 'utf8')

    const results = await discoverCloudLinkedProjects([root], new Set())

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      path: projectPath,
      kind: 'cloud-candidate',
      isShared: false,
      isCloudProject: true,
      linkedDevices: ['a-device', 'z-device'],
      unlinkedDevices: [],
    })
  })

  it('keeps unlinked presence separate from linked device markers', async () => {
    const projectPath = join(root, 'ObservedProject')
    await mkdir(join(projectPath, '.claude-memory', 'linked'), { recursive: true })
    await mkdir(join(projectPath, '.claude-memory', 'device-presence'), {
      recursive: true,
    })
    await writeFile(join(projectPath, '.claude-memory', 'linked', 'workstation'), '', 'utf8')
    await writeFile(
      join(projectPath, '.claude-memory', 'device-presence', 'workstation.json'),
      '{}',
      'utf8'
    )
    await writeFile(
      join(projectPath, '.claude-memory', 'device-presence', 'laptop.json'),
      '{}',
      'utf8'
    )

    const results = await discoverCloudLinkedProjects([root], new Set())

    expect(results[0]).toMatchObject({
      linkedDevices: ['workstation'],
      unlinkedDevices: ['laptop'],
    })
  })

  it('deduplicates projects found through overlapping cloud roots', async () => {
    const cloudRoot = join(root, 'Cloud')
    const projectPath = join(cloudRoot, 'Team', 'Repo')
    await mkdir(join(projectPath, '.claude-memory', 'linked'), { recursive: true })
    await writeFile(join(projectPath, '.claude-memory', 'linked', 'device-a'), '', 'utf8')

    const results = await discoverCloudLinkedProjects(
      [cloudRoot, join(cloudRoot, 'Team')],
      new Set()
    )

    expect(results.map((result) => result.path)).toEqual([projectPath])
  })

  it('continues scanning inside a linked directory to find nested linked projects', async () => {
    const parentPath = join(root, 'Apps')
    const nestedPath = join(parentPath, 'Test')
    await mkdir(join(parentPath, '.claude-memory', 'linked'), { recursive: true })
    await mkdir(join(nestedPath, '.claude-memory', 'linked'), { recursive: true })
    await writeFile(join(parentPath, '.claude-memory', 'linked', 'device-a'), '', 'utf8')
    await writeFile(join(nestedPath, '.claude-memory', 'linked', 'device-b'), '', 'utf8')

    const results = await discoverCloudLinkedProjects([root], new Set())

    expect(results.map((result) => result.path)).toEqual([parentPath, nestedPath])
  })

  it('continues scanning inside a known local project to find cloud-linked children', async () => {
    const parentPath = join(root, 'Projects', 'Phone')
    const nestedPath = join(parentPath, 'Xiaomi17')
    await mkdir(join(nestedPath, '.claude-memory', 'linked'), { recursive: true })
    await writeFile(join(nestedPath, '.claude-memory', 'linked', 'device-a'), '', 'utf8')

    const results = await discoverCloudLinkedProjects([root], new Set([parentPath.toLowerCase()]))

    expect(results.map((result) => result.path)).toEqual([nestedPath])
  })

  it('discovers cloud projects with transcripts even when linked markers are missing', async () => {
    const projectPath = join(root, 'Projects', 'Phone', 'Xiaomi17')
    await mkdir(join(projectPath, '.claude-memory'), { recursive: true })
    await writeFile(
      join(projectPath, '.claude-memory', '00000000-0000-0000-0000-000000000001.jsonl'),
      '{}',
      'utf8'
    )

    const results = await discoverCloudLinkedProjects([root], new Set())

    expect(results.map((result) => result.path)).toEqual([projectPath])
  })

  it('fast scan focuses common workspace directories instead of crawling the whole root', async () => {
    const focusedProjectPath = join(root, 'Projects', 'Phone', 'Xiaomi17')
    const rootProjectPath = join(root, 'SlowBranch', 'NestedProject')
    await mkdir(join(focusedProjectPath, '.claude-memory', 'linked'), { recursive: true })
    await mkdir(join(rootProjectPath, '.claude-memory', 'linked'), { recursive: true })
    await writeFile(join(focusedProjectPath, '.claude-memory', 'linked', 'device-a'), '', 'utf8')
    await writeFile(join(rootProjectPath, '.claude-memory', 'linked', 'device-b'), '', 'utf8')

    const results = await discoverCloudLinkedProjects([root], new Set(), { scanMode: 'fast' })

    expect(results.map((result) => result.path)).toEqual([focusedProjectPath])
  })

  it('recognizes the cloud root itself when it is a linked project', async () => {
    await mkdir(join(root, '.claude-memory', 'linked'), { recursive: true })
    await writeFile(join(root, '.claude-memory', 'linked', 'device-a'), '', 'utf8')

    const results = await discoverCloudLinkedProjects([root], new Set())

    expect(results.map((result) => result.path)).toEqual([root])
  })

  it('discovers projects nested up to CLOUD_SCAN_MAX_DEPTH levels deep', async () => {
    const projectPath = join(root, 'level1', 'level2', 'level3', 'DeepProject')
    await mkdir(join(projectPath, '.claude-memory', 'linked'), { recursive: true })
    await writeFile(join(projectPath, '.claude-memory', 'linked', 'device-a'), '', 'utf8')

    const results = await discoverCloudLinkedProjects([root], new Set())

    expect(results.some((r) => r.path === projectPath)).toBe(true)
  })

  it('skips projects already present in the known-paths set', async () => {
    const projectPath = join(root, 'KnownProject')
    await mkdir(join(projectPath, '.claude-memory', 'linked'), { recursive: true })
    await writeFile(join(projectPath, '.claude-memory', 'linked', 'device-a'), '', 'utf8')

    const knownPaths = new Set([projectPath.toLowerCase()])
    const results = await discoverCloudLinkedProjects([root], knownPaths)

    expect(results).toHaveLength(0)
  })

  it('ignores directories with an empty linked/ folder', async () => {
    const projectPath = join(root, 'UnlinkedProject')
    await mkdir(join(projectPath, '.claude-memory', 'linked'), { recursive: true })

    const results = await discoverCloudLinkedProjects([root], new Set())

    expect(results).toHaveLength(0)
  })
})

describe('cloud root path handling', () => {
  it('preserves filesystem root paths instead of stripping them to drive-relative paths', () => {
    const filesystemRoot = parse(resolve(tmpdir())).root

    expect(normalizeCloudRoot(filesystemRoot)).toBe(filesystemRoot)
  })

  it('normalizes bare Windows drive roots to absolute drive roots', () => {
    if (process.platform !== 'win32') return

    expect(normalizeCloudRoot('p:')).toBe('P:\\')
    expect(normalizeCloudRoot('P:\\')).toBe('P:\\')
    expect(isUnderCloudRoot('P:\\Projects\\IT\\Apps\\Test', ['P:'])).toBe(true)
  })

  it('expands home-relative project search paths', () => {
    const normalized = normalizeCloudRoot('~/Documents/Projects')

    expect(normalized).not.toContain('~')
    expect(normalized).toContain(join('Documents', 'Projects'))
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
