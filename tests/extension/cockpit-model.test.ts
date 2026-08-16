import { describe, expect, it } from 'vitest'

import { buildCockpitModel } from '../../extension/src/cockpit-model.js'
import type { ExtensionProject, ExtensionSession } from '../../extension/src/reup-data.js'

describe('buildCockpitModel', () => {
  it('classifies multi-root sessions once and keeps attention elsewhere separate', () => {
    const sessions = [
      session('workspace-a', '/work/a', { isActive: true }),
      session('workspace-b', '/work/b/packages/app'),
      session('attention', '/elsewhere', { needsAttention: true }),
      session('recent', '/other'),
    ]
    const projects = sessions.map(projectFor)

    const model = buildCockpitModel(projects, sessions, {
      activeEditorPath: '/work/b/packages/app/src/index.ts',
      sessionScope: 'all',
      workspaceRoots: ['/work/a', '/work/b'],
    })

    expect(
      model.workspaceProjects.flatMap((group) => group.sessions).map((item) => item.id)
    ).toEqual(['workspace-b', 'workspace-a'])
    expect(model.attentionElsewhere.map((item) => item.id)).toEqual(['attention'])
    expect(model.recentElsewhere.flatMap((group) => group.sessions).map((item) => item.id)).toEqual(
      ['recent']
    )
    expect(
      new Set([
        ...model.workspaceProjects.flatMap((group) => group.sessions),
        ...model.attentionElsewhere,
        ...model.recentElsewhere.flatMap((group) => group.sessions),
      ]).size
    ).toBe(4)
  })

  it('ranks active then warning then matching branch then recent', () => {
    const sessions = [
      session('recent', '/work/project', { updated: '2026-06-04T00:00:00.000Z' }),
      session('branch', '/work/project', {
        branch: 'main',
        currentBranch: 'main',
        updated: '2026-06-01T00:00:00.000Z',
      }),
      session('warning', '/work/project', {
        advice: { ...baseAdvice, code: 'interrupted', severity: 'warning' },
      }),
      session('active', '/work/project', { isActive: true }),
    ]

    const model = buildCockpitModel(sessions.map(projectFor), sessions, {
      workspaceRoots: ['/work/project'],
    })

    expect(model.workspaceProjects[0]?.sessions.map((item) => item.id)).toEqual([
      'active',
      'warning',
      'branch',
      'recent',
    ])
  })

  it('keeps same-project sessions with their canonical local workspace project', () => {
    const local = session('local', 'P:\\Projects\\demo', {
      projectId: 'demo-project',
    })
    const remote = session('remote', '/Users/other/Projects/demo', {
      projectId: 'demo-project',
    })
    const project: ExtensionProject = {
      id: 'demo-project',
      name: 'demo',
      path: 'P:\\Projects\\demo',
      sessionCount: 2,
      updated: remote.updated,
    }

    const model = buildCockpitModel([project], [local, remote], {
      workspaceRoots: ['P:\\Projects\\demo'],
    })

    expect(model.workspaceProjects).toHaveLength(1)
    expect(model.workspaceProjects[0]?.sessions.map((item) => item.id)).toEqual(['local', 'remote'])
    expect(model.recentElsewhere).toEqual([])
    expect(model.summary.workspaceSessionCount).toBe(2)
  })

  it('excludes ancestors of the workspace root instead of treating containment as symmetric', () => {
    // Opening a project must not adopt the sessions of a home directory or a
    // monorepo parent merely because the open folder sits inside them.
    const home = session('home', '/users/dev')
    const parent = session('parent', '/users/dev/projects')
    const own = session('own', '/users/dev/projects/demo')
    const nested = session('nested', '/users/dev/projects/demo/packages/app')
    const sessions = [home, parent, own, nested]

    const model = buildCockpitModel(sessions.map(projectFor), sessions, {
      sessionScope: 'all',
      workspaceRoots: ['/users/dev/projects/demo'],
    })

    expect(
      model.workspaceProjects
        .flatMap((group) => group.sessions)
        .map((item) => item.id)
        .sort()
    ).toEqual(['nested', 'own'])
    expect(
      model.recentElsewhere
        .flatMap((group) => group.sessions)
        .map((item) => item.id)
        .sort()
    ).toEqual(['home', 'parent'])
    expect(model.summary.elsewhereSessionCount).toBe(2)
  })

  it('hides other projects under workspace scope and counts badges within it', () => {
    const own = session('own', '/work/demo', { needsAttention: true })
    const elsewhereActive = session('elsewhere-active', '/other', { isActive: true })
    const elsewhereBlocked = session('elsewhere-blocked', '/other', { needsAttention: true })
    const sessions = [own, elsewhereActive, elsewhereBlocked]

    const model = buildCockpitModel(sessions.map(projectFor), sessions, {
      sessionScope: 'workspace',
      workspaceRoots: ['/work/demo'],
    })

    expect(model.resolvedScope).toBe('workspace')
    expect(model.attentionElsewhere).toEqual([])
    expect(model.recentElsewhere).toEqual([])
    // The status bar and the view badge must not demand attention for work the
    // user cannot act on from this window.
    expect(model.summary.scopedAttentionCount).toBe(1)
    expect(model.summary.scopedActiveCount).toBe(0)
    expect(model.summary.attentionCount).toBe(2)
    expect(model.summary.activeCount).toBe(1)
    expect(model.summary.elsewhereSessionCount).toBe(2)
    // The full session list stays intact: deep search resolves its hits there.
    expect(model.sessions).toHaveLength(3)
  })

  it('degrades workspace scope to all projects when no folder is open', () => {
    const sessions = [session('anywhere', '/work/demo')]

    const model = buildCockpitModel(sessions.map(projectFor), sessions, {
      sessionScope: 'workspace',
      workspaceRoots: [],
    })

    expect(model.resolvedScope).toBe('all')
    expect(model.recentElsewhere.flatMap((group) => group.sessions).map((item) => item.id)).toEqual(
      ['anywhere']
    )
    expect(model.summary.scopedActiveCount).toBe(model.summary.activeCount)
  })

  it('defaults to workspace scope when the caller states none', () => {
    const own = session('own', '/work/demo')
    const elsewhere = session('elsewhere', '/other')
    const sessions = [own, elsewhere]

    const model = buildCockpitModel(sessions.map(projectFor), sessions, {
      workspaceRoots: ['/work/demo'],
    })

    expect(model.resolvedScope).toBe('workspace')
    expect(model.recentElsewhere).toEqual([])
  })

  it('maps one thousand sessions within the interactive performance budget', () => {
    const sessions = Array.from({ length: 1_000 }, (_, index) =>
      session(`session-${index}`, `/work/project-${index % 50}`, {
        isActive: index % 97 === 0,
        needsAttention: index % 31 === 0,
      })
    )
    const projects = [
      ...new Map(sessions.map((item) => [item.projectId, projectFor(item)])).values(),
    ]
    const context = {
      activeEditorPath: '/work/project-2/src/index.ts',
      workspaceRoots: ['/work/project-2', '/work/project-3'],
    }

    // Warm the JIT first: the previous version timed a single cold call, which
    // measured compilation as much as the mapping. Locally that was the
    // difference between a 26ms first run and a 7ms median.
    buildCockpitModel(projects, sessions, context)

    const startedAt = performance.now()
    const model = buildCockpitModel(projects, sessions, context)
    const elapsed = performance.now() - startedAt

    // This guards against an algorithmic regression, not against latency. The
    // mapping is linear in sessions × workspace roots; making it quadratic in
    // projects would cost seconds here. A 100ms ceiling was measuring the CI
    // runner's contention instead — it reported 163ms on a loaded Windows agent
    // while the local median was 7ms.
    expect(elapsed).toBeLessThan(500)
    expect(model.sessions).toHaveLength(1_000)
  })
})

const baseAdvice: ExtensionSession['advice'] = {
  code: 'ready',
  explanation: 'Ready',
  recommendedAction: 'resume',
  severity: 'info',
  title: 'Ready',
}

function session(
  id: string,
  projectPath: string,
  overrides: Partial<ExtensionSession> = {}
): ExtensionSession {
  return {
    advice: baseAdvice,
    archived: false,
    branch: null,
    branchDrift: false,
    contextTokens: null,
    currentBranch: null,
    id,
    isActive: false,
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
    ...overrides,
  }
}

function projectFor(session: ExtensionSession): ExtensionProject {
  return {
    id: session.projectId,
    name: session.projectName,
    path: session.projectPath,
    sessionCount: 1,
    updated: session.updated,
  }
}
