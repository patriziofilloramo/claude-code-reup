import { afterEach, describe, expect, it } from 'vitest'

import { APP } from '../../src/config/app.js'
import type { Project } from '../../src/core/session/session-model.js'
import { getProjectSyncStatus } from '../../src/core/sync/project-sync-status.js'

const originalEnabled = APP.enableProjectMemorySync

afterEach(() => {
  ;(APP as { enableProjectMemorySync: boolean }).enableProjectMemorySync = originalEnabled
})

describe('getProjectSyncStatus', () => {
  it('hides the indicator when Project Memory Sync is globally disabled', async () => {
    ;(APP as { enableProjectMemorySync: boolean }).enableProjectMemorySync = false

    expect(getProjectSyncStatus(project({ isShared: true }))).toBeNull()
  })

  it('hides the indicator when effective runtime enablement is false', () => {
    expect(getProjectSyncStatus(project({ isShared: true }), false)).toBeNull()
  })

  it('returns none for a local-only project', () => {
    expect(getProjectSyncStatus(project(), true)).toBe('none')
  })

  it('shows no icon for shared memory discovered before this device is linked', () => {
    expect(getProjectSyncStatus(project({ cloudPath: process.cwd() }), true)).toBe('none')
  })

  it('returns orange only when unlinked device presence was observed', () => {
    expect(
      getProjectSyncStatus(
        project({
          cloudPath: process.cwd(),
          unlinkedDevices: ['laptop'],
        }),
        true
      )
    ).toBe('orange')
  })

  it('returns green when this device is linked and no unlinked use was observed', () => {
    expect(getProjectSyncStatus(project({ isShared: true }), true)).toBe('green')
  })
})

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project',
    isShared: false,
    path: process.cwd(),
    sessions: [],
    ...overrides,
  }
}
