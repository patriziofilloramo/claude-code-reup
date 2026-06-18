import { APP } from '../../config/app.js'
import type { Project } from '../session/session-model.js'
import { readUserPrefsSync } from '../user-prefs.js'

export type ProjectSyncStatus = 'green' | 'orange' | 'grey' | 'none'

export function isProjectMemorySyncEnabled(): boolean {
  return APP.enableProjectMemorySync && readUserPrefsSync().crossDeviceSessionStorage === 'on'
}

/**
 * Pure status derivation for UI rendering. Reachability is established during
 * project discovery and represented by `cloudOffline`, so rendering never adds
 * filesystem I/O or a delayed second paint.
 */
export function getProjectSyncStatus(
  project: Project,
  enabled = isProjectMemorySyncEnabled()
): ProjectSyncStatus | null {
  if (!enabled) return null
  if (!project.isShared && !project.cloudPath) return 'none'
  if (project.cloudOffline) return 'grey'
  if (project.unlinkedDevices?.length) return 'orange'
  return project.isShared ? 'green' : 'none'
}
