import { describe, expect, it, vi } from 'vitest'

import {
  isExtensionSessionVisible,
  isAttentionStatus,
  rankSessionsForWorkspace,
  ReupDataSource,
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

  it('caches touched-file counts by archive visibility and clears them on refresh', async () => {
    const dataSource = new ReupDataSource({} as never)
    const listTouchedFiles = vi
      .spyOn(dataSource, 'listTouchedFiles')
      .mockImplementation(async (includeArchived) => [
        {
          gitBranch: null,
          lastTouchedAt: '2026-01-01T00:00:00.000Z',
          path: includeArchived ? '/work/archived.ts' : '/work/current.ts',
          sessionCount: includeArchived ? 2 : 1,
        },
      ])

    expect([...(await dataSource.touchedFileCounts(false)).values()]).toEqual([1])
    expect([...(await dataSource.touchedFileCounts(true)).values()]).toEqual([2])
    await dataSource.touchedFileCounts(false)
    expect(listTouchedFiles).toHaveBeenCalledTimes(2)

    dataSource.invalidateTouchedFileCounts()
    await dataSource.touchedFileCounts(false)
    expect(listTouchedFiles).toHaveBeenCalledTimes(3)
  })

  it('retries an in-flight touched-file scan invalidated before it completes', async () => {
    const dataSource = new ReupDataSource({} as never)
    let releaseFirstScan!: () => void
    const firstScanPending = new Promise<void>((resolve) => {
      releaseFirstScan = resolve
    })
    const listTouchedFiles = vi
      .spyOn(dataSource, 'listTouchedFiles')
      .mockImplementationOnce(async () => {
        await firstScanPending
        return [
          {
            gitBranch: null,
            lastTouchedAt: '2026-01-01T00:00:00.000Z',
            path: '/work/stale.ts',
            sessionCount: 1,
          },
        ]
      })
      .mockResolvedValueOnce([
        {
          gitBranch: null,
          lastTouchedAt: '2026-01-01T00:00:01.000Z',
          path: '/work/fresh.ts',
          sessionCount: 2,
        },
      ])

    const pendingCounts = dataSource.touchedFileCounts(false)
    dataSource.invalidateTouchedFileCounts()
    releaseFirstScan()

    await expect(pendingCounts).resolves.toEqual(new Map([['/work/fresh.ts', 2]]))
    expect(listTouchedFiles).toHaveBeenCalledTimes(2)
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
