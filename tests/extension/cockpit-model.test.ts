import { describe, expect, it } from 'vitest'

import { buildCockpitModel } from '../../extension/src/cockpit-model.js'
import type { ExtensionProject, ExtensionSession } from '../../extension/src/swoop-data.js'

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

  it('keeps cross-device sessions with their canonical local workspace project', () => {
    const local = session('local', 'P:\\Projects\\demo', {
      projectId: 'demo-project',
    })
    const remote = session('remote', '/Users/other/Projects/demo', {
      projectId: 'demo-project',
    })
    const project: ExtensionProject = {
      id: 'demo-project',
      memoryStatus: 'green',
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
    const startedAt = performance.now()

    const model = buildCockpitModel(projects, sessions, {
      activeEditorPath: '/work/project-2/src/index.ts',
      workspaceRoots: ['/work/project-2', '/work/project-3'],
    })

    expect(performance.now() - startedAt).toBeLessThan(100)
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
    memoryStatus: null,
    needsAttention: false,
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
    memoryStatus: null,
    name: session.projectName,
    path: session.projectPath,
    sessionCount: 1,
    updated: session.updated,
  }
}
