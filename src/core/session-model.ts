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
   * True when the project's storage directory is a junction or symlink
   * pointing to a shared location (e.g. .claude-memory/ inside the project).
   * Used to show the ☁ shared-storage indicator in the UI.
   */
  isShared: boolean
  /**
   * True when the project is shared but its junction target is currently
   * unreachable (e.g. cloud drive offline). Sessions cannot be read or
   * written until the target comes back online or the link is guarded.
   */
  storageOffline?: boolean
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
