import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { resolveGitDirectory } from '../../extension/src/git-workspace.js'

const treeSource = await import('node:fs/promises').then(({ readFile }) =>
  readFile('extension/src/session-tree.ts', 'utf8')
)
const extensionSource = await import('node:fs/promises').then(({ readFile }) =>
  readFile('extension/src/extension.ts', 'utf8')
)
const resumePickerSource = await import('node:fs/promises').then(({ readFile }) =>
  readFile('extension/src/resume-picker.ts', 'utf8')
)

describe('workspace cockpit guardrails', () => {
  let temporaryDirectory: string | null = null

  afterEach(async () => {
    if (temporaryDirectory) await rm(temporaryDirectory, { force: true, recursive: true })
    temporaryDirectory = null
  })

  it('renders workspace, attention, and recent sections with stable selection support', () => {
    expect(treeSource).toContain("type SectionId = 'workspace' | 'attention' | 'recent'")
    expect(treeSource).toContain("label: 'Current Workspace'")
    expect(treeSource).toContain("label: 'Needs Attention Elsewhere'")
    expect(treeSource).toContain("label: 'Recent Elsewhere'")
    expect(treeSource).toContain('restoreSelection')
    expect(treeSource).toContain('treeView.badge')
    expect(extensionSource).toContain('treeProvider.attachTreeView(treeView)')
    expect(extensionSource).toContain('refreshController.setVisible(event.visible)')
  })

  it('resolves normal repositories and worktree gitdir files', async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'swoop-worktree-test-'))
    const normal = join(temporaryDirectory, 'normal')
    await mkdir(join(normal, '.git'), { recursive: true })
    expect(await resolveGitDirectory(normal)).toBe(join(normal, '.git'))

    const worktree = join(temporaryDirectory, 'worktree')
    const gitDirectory = join(temporaryDirectory, 'git-data', 'worktrees', 'demo')
    await mkdir(worktree, { recursive: true })
    await mkdir(gitDirectory, { recursive: true })
    await writeFile(join(worktree, '.git'), `gitdir: ${gitDirectory}\n`, 'utf8')

    expect(await resolveGitDirectory(worktree)).toBe(resolve(gitDirectory))
  })

  it('matches and ranks Resume Here across every workspace root', () => {
    expect(resumePickerSource).toContain('const workspacePaths =')
    expect(resumePickerSource).toContain('workspacePaths.some')
    expect(resumePickerSource).toContain('compareCockpitSessions(left, right, activeEditorPath)')
  })
})
