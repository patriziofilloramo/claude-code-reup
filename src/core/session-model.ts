/**
 * Independent facts derived from transcript analysis, CCM metadata, and path checks.
 * Multiple signals can apply to the same session simultaneously.
 *
 * When `analysisComplete` is false, transcript-derived values are `null` rather
 * than false or zero. Consumers must not present unanalysed sessions as clean.
 */
export interface SessionSignals {
  analysisComplete: boolean
  archived: boolean
  compactionCount: number | null
  expiresInDays: number | null
  interrupted: boolean | null
  lastToolFailed: boolean | null
  pathExists: boolean
}

/**
 * Transcript-derived context facts from the latest observed assistant response.
 *
 * Values are `null` when the transcript was not analysed. `models` preserves
 * first-seen order so consumers can distinguish a model switch from one model
 * repeated throughout the session.
 */
export interface SessionContextMetrics {
  latestContextTokens: number | null
  latestModel: string | null
  latestOutputTokens: number | null
  models: string[] | null
}

/** Display-priority status derived from a session's independent signals. */
export type SessionStatus = 'ok' | 'interrupted' | 'expiring' | 'path-missing' | 'heavily-compacted'

export interface Project {
  /** Raw directory name under Claude Code's projects directory. */
  id: string
  /** Resolved, human-readable filesystem path. */
  path: string
  sessions: Session[]
  /**
   * True when the project's storage directory is linked to a cloud location
   * (either via a .ccm-link file or a legacy NTFS junction / symlink).
   * Used to show the cloud shared-storage indicator in the UI.
   */
  isShared: boolean
  /**
   * Absolute path to the cloud directory that sessions are synced with.
   * Set when a .ccm-link file is present; undefined for local-only projects
   * or legacy junctions that have not yet been migrated.
   */
  cloudPath?: string
  /**
   * True when the cloud junction target is temporarily unreachable and ccm
   * has switched the project to a local backup directory. Sessions written
   * while offline will be merged back to the cloud when it comes online.
   * Shown as grey cloud in the UI so the user knows sync is paused.
   */
  cloudOffline?: boolean
  /**
   * Device names that wrote a presence file to the cloud directory while not
   * linked (i.e. they opened the project without running `ccm sync link`).
   * Populated from {cloudDir}/device-presence/ on each discovery pass.
   * Shown as orange cloud in the UI to prompt the user to link that device.
   */
  unlinkedDevices?: string[]
}

export interface Session {
  alias?: string
  context: SessionContextMetrics
  created: string
  /**
   * Current HEAD branch at `projectPath`.
   * Undefined when the path is not a git repo, HEAD is detached, or git is unavailable.
   */
  currentBranch?: string
  gitBranch?: string
  id: string
  messageCount: number
  name: string
  projectPath: string
  signals: SessionSignals
  updated: string
}

const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Validates Claude Code session UUIDs before they reach paths or launchers. */
export function isValidSessionId(id: string): boolean {
  return SESSION_ID_PATTERN.test(id)
}
