import { describe, expect, it } from 'vitest'

import {
  isExtensionSessionVisible,
  isAttentionStatus,
  rankSessionsForWorkspace,
  sessionMatchesWorkspace,
  type ExtensionSession,
} from '../../extension/src/reup-data.js'
import type { ResumeAdvice } from '../../src/core/session/resume-advice.js'
import { isResumeVisibleSession } from '../../src/core/session/session-visibility.js'

function session(overrides: Partial<ExtensionSession>): ExtensionSession {
  return {
    advice: {
      code: 'ready',
      explanation: 'Ready',
      recommendedAction: 'resume',
      severity: 'info',
      title: 'Ready',
    } satisfies ResumeAdvice,
    archived: false,
    branch: null,
    branchDrift: false,
    contextTokens: null,
    currentBranch: null,
    id: crypto.randomUUID(),
    isActive: false,
    messageCount: 1,
    needsAttention: false,
    needsInput: false,
    planSummary: null,
    primaryStatus: 'ok',
    projectId: 'project',
    projectName: 'project',
    projectPath: '/work/project',
    tags: [],
    title: 'Session',
    todoSummary: null,
    updated: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('VS Code extension data adapter helpers', () => {
  it('matches sessions whose project path contains the current workspace', () => {
    expect(
      sessionMatchesWorkspace(session({ projectPath: '/work/project' }), '/work/project')
    ).toBe(true)
    expect(
      sessionMatchesWorkspace(session({ projectPath: '/work/project' }), '/work/project/packages/a')
    ).toBe(true)
    expect(sessionMatchesWorkspace(session({ projectPath: '/work/project' }), '/other')).toBe(false)
  })

  it('ranks exact workspace matches before active and recent unrelated sessions', () => {
    const exact = session({
      id: '00000000-0000-0000-0000-000000000001',
      projectPath: '/work/project',
      title: 'Exact',
      updated: '2026-01-01T00:00:00.000Z',
    })
    const activeOther = session({
      id: '00000000-0000-0000-0000-000000000002',
      isActive: true,
      projectPath: '/other/project',
      title: 'Active other',
      updated: '2026-06-01T00:00:00.000Z',
    })

    expect(rankSessionsForWorkspace([activeOther, exact], '/work/project')[0]).toBe(exact)
  })

  it('ranks current-branch matches above otherwise equivalent workspace sessions', () => {
    const matchingBranch = session({
      branch: 'main',
      currentBranch: 'main',
      id: '00000000-0000-0000-0000-000000000003',
      title: 'Matching branch',
      updated: '2026-01-01T00:00:00.000Z',
    })
    const newerBranchDrift = session({
      branch: 'feature',
      currentBranch: 'main',
      id: '00000000-0000-0000-0000-000000000004',
      title: 'Branch drift',
      updated: '2026-06-01T00:00:00.000Z',
    })

    expect(rankSessionsForWorkspace([newerBranchDrift, matchingBranch], '/work/project')[0]).toBe(
      matchingBranch
    )
  })

  it('keeps triage-only statuses out of the attention bucket', () => {
    expect(isAttentionStatus('heavily-compacted')).toBe(false)
    // The historical interrupted flag sticks forever on stale transcripts;
    // live needs-input detection replaced it as the attention driver.
    expect(isAttentionStatus('interrupted')).toBe(false)
    expect(isAttentionStatus('expiring')).toBe(true)
    expect(isAttentionStatus('path-missing')).toBe(true)
  })

  it('keeps zero-message sessions out of resume-oriented extension surfaces', () => {
    expect(isResumeVisibleSession({ messageCount: 0 })).toBe(false)
    expect(isResumeVisibleSession({ messageCount: 1 })).toBe(true)

    expect(
      isExtensionSessionVisible(rawSession({ messageCount: 0 }), { includeArchived: true })
    ).toBe(false)
    expect(
      isExtensionSessionVisible(rawSession({ archived: true }), { includeArchived: false })
    ).toBe(false)
    expect(
      isExtensionSessionVisible(rawSession({ archived: true }), { includeArchived: true })
    ).toBe(true)
  })
})

function rawSession(overrides: { archived?: boolean; messageCount?: number } = {}) {
  return {
    messageCount: overrides.messageCount ?? 1,
    signals: {
      archived: overrides.archived ?? false,
    },
  }
}
