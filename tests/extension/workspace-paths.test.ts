import { describe, expect, it } from 'vitest'

import { buildCockpitModel } from '../../extension/src/cockpit-model.js'
import type { ExtensionProject, ExtensionSession } from '../../extension/src/reup-data.js'
import { isInsideAnyWorkspaceRoot, isSameOrInside } from '../../extension/src/workspace-paths.js'

const onWindows = process.platform === 'win32'

describe('workspace path membership', () => {
  it('accepts the folder itself and its descendants', () => {
    expect(isSameOrInside('/work/demo', '/work/demo')).toBe(true)
    expect(isSameOrInside('/work/demo/packages/app', '/work/demo')).toBe(true)
    expect(isSameOrInside('/work/demo/', '/work/demo')).toBe(true)
  })

  it('rejects ancestors and siblings of the folder', () => {
    // One-directional by design. Symmetric containment pulled a home directory
    // and a monorepo parent into a project's own workspace view.
    expect(isSameOrInside('/work', '/work/demo')).toBe(false)
    expect(isSameOrInside('/', '/work/demo')).toBe(false)
    expect(isSameOrInside('/work/demo-two', '/work/demo')).toBe(false)
    expect(isSameOrInside('/elsewhere', '/work/demo')).toBe(false)
  })

  it('matches any one of several workspace roots', () => {
    expect(isInsideAnyWorkspaceRoot('/work/b/src', ['/work/a', '/work/b'])).toBe(true)
    expect(isInsideAnyWorkspaceRoot('/work/c', ['/work/a', '/work/b'])).toBe(false)
    expect(isInsideAnyWorkspaceRoot('/work/a', [])).toBe(false)
  })

  // VS Code's Uri.fsPath always lower-cases the Windows drive letter, while
  // Claude Code records the casing the shell had. A case-sensitive compare
  // therefore missed the most common match of all — a session started in the
  // workspace root — and left the workspace view silently empty. The failure
  // mode only exists where the filesystem is case-insensitive.
  it.runIf(onWindows)('matches a workspace root whose drive letter casing differs', () => {
    expect(isSameOrInside('P:\\Projects\\demo', 'p:\\Projects\\demo')).toBe(true)
    expect(isSameOrInside('P:\\Projects\\demo\\packages\\app', 'p:\\Projects\\demo')).toBe(true)
    expect(isSameOrInside('p:\\Projects\\demo', 'P:\\Projects\\demo')).toBe(true)
    expect(isSameOrInside('P:\\Projects\\other', 'p:\\Projects\\demo')).toBe(false)
  })

  it.runIf(onWindows)('keeps the workspace section populated across drive letter casing', () => {
    const recorded = session('recorded', 'P:\\Projects\\demo')
    const nested = session('nested', 'P:\\Projects\\demo\\packages\\app')
    const sessions = [recorded, nested]

    const model = buildCockpitModel(sessions.map(projectFor), sessions, {
      workspaceRoots: ['p:\\Projects\\demo'],
    })

    expect(
      model.workspaceProjects
        .flatMap((group) => group.sessions)
        .map((item) => item.id)
        .sort()
    ).toEqual(['nested', 'recorded'])
    expect(model.summary.workspaceSessionCount).toBe(2)
    expect(model.summary.elsewhereSessionCount).toBe(0)
  })
})

function session(id: string, projectPath: string): ExtensionSession {
  return {
    advice: {
      code: 'ready',
      explanation: 'Ready',
      recommendedAction: 'resume',
      severity: 'info',
      title: 'Ready',
    },
    archived: false,
    branch: null,
    branchDrift: false,
    contextTokens: null,
    currentBranch: null,
    id,
    isActive: false,
    liveState: 'detached',
    messageCount: 1,
    needsAttention: false,
    needsInput: false,
    planSummary: null,
    primaryStatus: 'ok',
    projectId: projectPath,
    projectName: projectPath,
    projectPath,
    tags: [],
    title: id,
    todoSummary: null,
    updated: '2026-06-02T00:00:00.000Z',
  }
}

function projectFor(item: ExtensionSession): ExtensionProject {
  return {
    id: item.projectId,
    name: item.projectName,
    path: item.projectPath,
    sessionCount: 1,
    updated: item.updated,
  }
}

describe('repository grouping', () => {
  const monorepo = {
    // The open folder is one package; Claude ran at the repository root and in
    // a sibling package. Neither belongs to the folder, both belong to the repo.
    openFolder: '/work/repo/packages/app',
    repositoryRoot: '/work/repo',
  }

  function monorepoModel(overrides: Record<string, unknown> = {}) {
    const own = session('own', monorepo.openFolder)
    const nested = session('nested', `${monorepo.openFolder}/src`)
    const repoRoot = session('repo-root', monorepo.repositoryRoot)
    const sibling = session('sibling', '/work/repo/packages/other')
    const outside = session('outside', '/work/other-repo')
    const sessions = [own, nested, repoRoot, sibling, outside]
    return buildCockpitModel(sessions.map(projectFor), sessions, {
      repositoryRoots: [monorepo.repositoryRoot],
      workspaceRoots: [monorepo.openFolder],
      ...overrides,
    })
  }

  it('keeps the workspace meaning exactly the open folder', () => {
    expect(
      monorepoModel()
        .workspaceProjects.flatMap((group) => group.sessions)
        .map((item) => item.id)
        .sort()
    ).toEqual(['nested', 'own'])
  })

  it('groups the repository root and siblings separately, never in the workspace', () => {
    const model = monorepoModel()

    expect(
      model.repositoryProjects
        .flatMap((group) => group.sessions)
        .map((item) => item.id)
        .sort()
    ).toEqual(['repo-root', 'sibling'])
    expect(model.summary.repositorySessionCount).toBe(2)
    expect(model.summary.workspaceSessionCount).toBe(2)
  })

  it('leaves sessions outside the repository elsewhere', () => {
    const model = monorepoModel({ sessionScope: 'all' })

    expect(model.recentElsewhere.flatMap((group) => group.sessions).map((item) => item.id)).toEqual(
      ['outside']
    )
    expect(model.summary.elsewhereSessionCount).toBe(1)
  })

  it('stays empty when the open folder is the repository root', () => {
    // The ordinary one-repo-per-window case: no second group, no dead header.
    const own = session('own', '/work/repo')
    const outside = session('outside', '/work/other')
    const sessions = [own, outside]

    const model = buildCockpitModel(sessions.map(projectFor), sessions, {
      repositoryRoots: ['/work/repo'],
      workspaceRoots: ['/work/repo'],
    })

    expect(model.repositoryProjects).toEqual([])
    expect(model.summary.repositorySessionCount).toBe(0)
  })

  it('counts the repository group in the badge by default, and not when disabled', () => {
    const own = session('own', monorepo.openFolder)
    const repoRoot = { ...session('repo-root', monorepo.repositoryRoot), needsAttention: true }
    const sessions = [own, repoRoot]
    const context = {
      repositoryRoots: [monorepo.repositoryRoot],
      workspaceRoots: [monorepo.openFolder],
    }

    expect(
      buildCockpitModel(sessions.map(projectFor), sessions, context).summary.scopedAttentionCount
    ).toBe(1)
    expect(
      buildCockpitModel(sessions.map(projectFor), sessions, {
        ...context,
        countRepositorySessions: false,
      }).summary.scopedAttentionCount
    ).toBe(0)
  })
})
