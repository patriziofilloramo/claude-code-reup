/**
 * Lightweight shared state between cloud-sync and project-discovery.
 *
 * cloud-sync writes here as it detects online/offline transitions.
 * project-discovery reads here to annotate Project objects without
 * needing to import cloud-sync (which would create a circular dependency
 * because cloud-sync dynamically imports project-discovery at startup).
 */

export interface ProjectSyncInfo {
  /** Absolute path to the cloud directory (junction target). */
  readonly cloudDir: string
  /** Whether the cloud directory is currently reachable. */
  isOnline: boolean
  /**
   * True when sessions were written to local storage while the cloud was
   * offline and the cloud has not yet re-merged those sessions.
   */
  hasPendingMerge: boolean
}

/**
 * Maps the junction path (~/.claude/projects/<id>/) → sync state.
 * Populated by initCloudSync(); empty before that runs.
 */
export const syncRegistry = new Map<string, ProjectSyncInfo>()
