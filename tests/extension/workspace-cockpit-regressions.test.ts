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

  it('refreshes workspace, attention, and recent sections without stealing tree focus', () => {
    expect(treeSource).toContain("type SectionId = 'workspace' | 'attention' | 'recent'")
    expect(treeSource).toContain("label: 'Current Workspace'")
    expect(treeSource).toContain("label: 'Needs Attention Elsewhere'")
    expect(treeSource).toContain("label: 'Recent Elsewhere'")
    expect(treeSource).toContain('const nextSessionNodes = new Map')
    expect(treeSource).toContain('this.sessionNodes.get(session.id) ?? sessionNode')
    expect(treeSource).toContain('cockpitModelFingerprint(model)')
    expect(treeSource).toContain('this.renderedFingerprint !== fingerprint')
    expect(treeSource).toContain('options.notifyView !== false')
    expect(treeSource).not.toContain('restoreSelection')
    expect(treeSource).not.toContain('treeView.reveal(')
    expect(treeSource).not.toContain('select: true')
    expect(treeSource).toContain('item.id = `reup.section.${node.id}`')
    expect(treeSource).toContain('item.id = `reup.project.${project.id}`')
    expect(treeSource).toContain('item.id = `reup.session.${session.projectId}.${session.id}`')
    expect(treeSource).toContain('treeView.badge')
    expect(treeSource).toContain('const visibleSessionCount = group.sessions.length')
    expect(extensionSource).toContain('treeProvider.attachTreeView(treeView)')
    expect(extensionSource).toContain('refreshController?.setVisible(dashboardVisible)')
    expect(extensionSource).toContain(
      'if (event.visible && !treeProvider.renderCurrentModel()) void refreshAll()'
    )
    expect(extensionSource).toContain(
      'if (treeVisible && !treeProvider.renderCurrentModel()) void refreshAll()'
    )
    expect(extensionSource).not.toContain(
      'refreshController?.setVisible(treeVisible || dashboardVisible)'
    )
    expect(treeSource).toContain('renderCurrentModel(): boolean')
    expect(treeSource).toContain('if (!this.model || !this.modelFingerprint) return false')
    expect(extensionSource).toContain('new ReupRefreshController(logger, { refresh: refreshAll })')
    expect(extensionSource).toContain('treeProvider.refresh({ notifyView: treeVisible })')
    expect(extensionSource).toContain('if (changed) await dashboard?.refresh')
  })

  it('resolves normal repositories and worktree gitdir files', async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'reup-worktree-test-'))
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
