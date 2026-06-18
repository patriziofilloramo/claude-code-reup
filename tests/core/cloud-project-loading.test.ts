import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lstat, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const cloudDiscoveryMock = vi.hoisted(() => ({
  roots: [] as string[],
}))

vi.mock('../../src/core/sync/cloud-project-discovery.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/core/sync/cloud-project-discovery.js')>()
  return {
    ...actual,
    detectCloudRoots: async () => cloudDiscoveryMock.roots,
  }
})

import {
  encodeProjectPath,
  getClaudeProjectsDirectory,
} from '../../src/core/project/claude-paths.js'
import { invalidateProjectCache } from '../../src/core/project/project-cache.js'
import { loadProjects } from '../../src/core/project/project-discovery.js'
import { buildSyncOverview, linkProjectForSync } from '../../src/core/sync/sync-actions.js'
import { writeUserPrefsSync } from '../../src/core/user-prefs.js'
import { APP } from '../../src/config/app.js'

const SESSION_ID = '00000000-0000-0000-0000-000000000101'
const LOCAL_SESSION_ID = '00000000-0000-0000-0000-000000000202'

describe('cloud-linked project loading', () => {
  let root: string
  let claudeDirectory: string
  let cloudRoot: string
  let originalClaudeDirectory: string | undefined
  let originalAdvancedDiscovery: boolean
  let originalProjectSearchPaths: readonly string[]

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'swoop-cloud-project-test-'))
    claudeDirectory = join(root, 'claude')
    cloudRoot = join(root, 'Cloud')
    originalClaudeDirectory = process.env.CLAUDE_CONFIG_DIR
    originalAdvancedDiscovery = APP.enableAdvancedDiscovery
    originalProjectSearchPaths = APP.projectSearchPaths
    ;(APP as { enableAdvancedDiscovery: boolean }).enableAdvancedDiscovery = true
    ;(APP as { projectSearchPaths: string[] }).projectSearchPaths = [cloudRoot]
    process.env.CLAUDE_CONFIG_DIR = claudeDirectory
    cloudDiscoveryMock.roots = [cloudRoot]
    invalidateProjectCache()
  })

  afterEach(async () => {
    invalidateProjectCache()
    cloudDiscoveryMock.roots = []
    ;(APP as { enableAdvancedDiscovery: boolean }).enableAdvancedDiscovery =
      originalAdvancedDiscovery
    ;(APP as { projectSearchPaths: readonly string[] }).projectSearchPaths =
      originalProjectSearchPaths
    if (originalClaudeDirectory === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalClaudeDirectory
    await rm(root, { force: true, recursive: true })
  })

  it('keeps a remote-only project out of the main project list', async () => {
    writeUserPrefsSync({
      autoCleanupOnStart: 'off',
      crossDeviceSessionStorage: 'on',
      theme: 'dark',
    })
    const projectPath = join(cloudRoot, 'Apps', 'Test')
    const staleDevicePath = join(root, 'OtherDevice', 'Apps', 'Test')
    await writeCloudProject(projectPath, staleDevicePath)

    await expect(loadProjects()).resolves.toEqual([])
  })

  it('shows remote-only projects as candidates in Sync configuration', async () => {
    writeUserPrefsSync({
      autoCleanupOnStart: 'off',
      crossDeviceSessionStorage: 'on',
      theme: 'dark',
    })
    const projectPath = join(cloudRoot, 'Projects', 'Phone', 'Xiaomi17')
    await writeCloudProject(projectPath, projectPath)

    const overview = await buildSyncOverview()

    expect(overview.cloudProjectCandidates).toContainEqual(
      expect.objectContaining({
        cloudPath: join(projectPath, '.claude-memory'),
        linkedDevices: ['device-a'],
        path: projectPath,
      })
    )
  })

  it('annotates a locally-used project from its project-root memory folder', async () => {
    writeUserPrefsSync({
      autoCleanupOnStart: 'off',
      crossDeviceSessionStorage: 'on',
      theme: 'dark',
    })
    const projectPath = join(cloudRoot, 'Projects', 'Phone', 'Xiaomi17')
    await writeLocalProject(claudeDirectory, projectPath)
    await writeCloudProject(projectPath, projectPath)
    await mkdir(join(projectPath, '.claude-memory', 'device-presence'), {
      recursive: true,
    })
    await writeFile(
      join(projectPath, '.claude-memory', 'device-presence', 'this-device.json'),
      '{}',
      'utf8'
    )

    const projects = await loadProjects()

    expect(projects).toHaveLength(1)
    expect(projects[0]).toMatchObject({
      cloudPath: join(projectPath, '.claude-memory'),
      isShared: false,
      linkedDevices: ['device-a'],
      path: projectPath,
      unlinkedDevices: ['this-device'],
    })
  })

  it('does not scan cloud projects while cross-device storage is disabled', async () => {
    writeUserPrefsSync({
      autoCleanupOnStart: 'off',
      crossDeviceSessionStorage: 'off',
      theme: 'dark',
    })
    const projectPath = join(cloudRoot, 'Apps', 'Test')
    await writeCloudProject(projectPath, projectPath)

    await expect(loadProjects()).resolves.toEqual([])
  })

  it('uses focused discovery only in Sync configuration', async () => {
    writeUserPrefsSync({
      autoCleanupOnStart: 'off',
      crossDeviceSessionStorage: 'on',
      theme: 'dark',
    })
    const projectPath = join(cloudRoot, 'Projects', 'Phone', 'Xiaomi17')
    await writeCloudProject(projectPath, projectPath)
    ;(APP as { enableAdvancedDiscovery: boolean }).enableAdvancedDiscovery = false
    invalidateProjectCache()

    await expect(loadProjects()).resolves.toEqual([])
    await expect(buildSyncOverview()).resolves.toMatchObject({
      cloudProjectCandidates: [
        expect.objectContaining({
          cloudPath: join(projectPath, '.claude-memory'),
          path: projectPath,
        }),
      ],
    })
  })

  it('adds an explicitly linked remote project to the main project list', async () => {
    writeUserPrefsSync({
      autoCleanupOnStart: 'off',
      crossDeviceSessionStorage: 'on',
      theme: 'dark',
    })
    const projectPath = join(cloudRoot, 'Apps', 'Test')
    await writeCloudProject(projectPath, projectPath)

    await linkProjectForSync(projectPath)
    invalidateProjectCache()

    const localProjectDirectory = join(getClaudeProjectsDirectory(), encodeProjectPath(projectPath))
    await expect(lstat(localProjectDirectory).then((stat) => stat.isSymbolicLink())).resolves.toBe(
      true
    )
    await expect(loadProjects()).resolves.toEqual([
      expect.objectContaining({
        isShared: true,
        path: projectPath,
      }),
    ])
  })

  it('keeps an explicitly linked project visible even before it has sessions', async () => {
    writeUserPrefsSync({
      autoCleanupOnStart: 'off',
      crossDeviceSessionStorage: 'on',
      theme: 'dark',
    })
    const projectPath = join(cloudRoot, 'Apps', 'EmptyLinkedProject')
    await mkdir(projectPath, { recursive: true })

    await linkProjectForSync(projectPath)
    invalidateProjectCache()

    await expect(loadProjects()).resolves.toEqual([
      expect.objectContaining({
        isShared: true,
        path: projectPath,
        sessions: [],
      }),
    ])
  })
})

async function writeCloudProject(projectPath: string, recordedProjectPath: string): Promise<void> {
  const cloudMemoryPath = join(projectPath, '.claude-memory')
  await mkdir(join(cloudMemoryPath, 'linked'), { recursive: true })
  await writeFile(join(cloudMemoryPath, 'linked', 'device-a'), '', 'utf8')
  await writeFile(
    join(cloudMemoryPath, `${SESSION_ID}.jsonl`),
    [
      JSON.stringify({
        cwd: recordedProjectPath,
        message: { content: 'Continue the cloud project' },
        timestamp: '2026-06-01T10:00:00.000Z',
        type: 'user',
      }),
      JSON.stringify({
        message: {
          content: [{ text: 'Ready', type: 'text' }],
          model: 'claude-sonnet-4-6',
          usage: { input_tokens: 10, output_tokens: 5 },
        },
        timestamp: '2026-06-01T10:01:00.000Z',
        type: 'assistant',
      }),
    ].join('\n'),
    'utf8'
  )
}

async function writeLocalProject(claudeDirectory: string, projectPath: string): Promise<void> {
  const projectDirectory = join(claudeDirectory, 'projects', encodeProjectPath(projectPath))
  await mkdir(projectDirectory, { recursive: true })
  await writeFile(
    join(projectDirectory, `${LOCAL_SESSION_ID}.jsonl`),
    [
      JSON.stringify({
        cwd: projectPath,
        message: { content: 'Open parent project' },
        timestamp: '2026-06-01T09:00:00.000Z',
        type: 'user',
      }),
      JSON.stringify({
        message: { content: [{ text: 'Ready', type: 'text' }] },
        timestamp: '2026-06-01T09:01:00.000Z',
        type: 'assistant',
      }),
    ].join('\n'),
    'utf8'
  )
}
