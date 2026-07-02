import { describe, expect, it } from 'vitest'

import {
  buildDashboardModel,
  filterDashboardSessions,
} from '../../extension/src/dashboard-model.js'
import type { ExtensionProject, ExtensionSession } from '../../extension/src/reup-data.js'

describe('dashboard model', () => {
  it('selects the strongest resume candidate and summarizes the workspace', () => {
    const sessions = [
      session('old', { updated: '2026-01-01T00:00:00.000Z' }),
      session('active', { isActive: true, updated: '2025-01-01T00:00:00.000Z' }),
      session('attention', { needsAttention: true, primaryStatus: 'interrupted' }),
    ]
    const model = buildDashboardModel([project()], sessions, null)

    expect(model.continueNow?.id).toBe('active')
    expect(model.summary).toEqual({
      active: 1,
      archived: 0,
      attention: 1,
      projects: 1,
      sessions: 3,
    })
  })

  it('filters metadata, projects, focus buckets, and workspace project identity', () => {
    const sessions = [
      session('local', { projectId: 'shared', tags: ['important'] }),
      session('remote', {
        projectId: 'shared',
        projectPath: '/Users/device/demo',
        title: 'Remote plan',
      }),
      session('other', { projectId: 'other', projectName: 'other' }),
      session('archived', { archived: true }),
    ]

    expect(
      filterDashboardSessions(sessions, 'tag:important', 'all', null, new Set(['shared'])).map(
        (item) => item.id
      )
    ).toEqual(['local'])
    expect(
      filterDashboardSessions(sessions, '', 'workspace', null, new Set(['shared'])).map(
        (item) => item.id
      )
    ).toEqual(['local', 'remote'])
    expect(
      filterDashboardSessions(sessions, '', 'all', null, new Set(['shared'])).map((item) => item.id)
    ).toEqual(['local', 'remote', 'other'])
    expect(
      filterDashboardSessions(sessions, '', 'archived', null, new Set(['shared'])).map(
        (item) => item.id
      )
    ).toEqual(['archived'])
  })
})

function project(): ExtensionProject {
  return {
    id: 'shared',
    name: 'demo',
    path: 'P:\\Projects\\demo',
    sessionCount: 3,
    updated: '2026-01-03T00:00:00.000Z',
  }
}

function session(id: string, overrides: Partial<ExtensionSession> = {}): ExtensionSession {
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
    messageCount: 1,
    needsAttention: false,
    needsInput: false,
    planSummary: null,
    primaryStatus: 'ok',
    projectId: 'shared',
    projectName: 'demo',
    projectPath: 'P:\\Projects\\demo',
    tags: [],
    title: id,
    todoSummary: null,
    updated: '2026-01-02T00:00:00.000Z',
    ...overrides,
  }
}
