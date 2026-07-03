import type { Project, Session } from './session-model.js'

// -----------------------------------------------------------------------------
// Built-in heuristic rules for session cleanup (no AI required).
// Fast, deterministic, scriptable. Run `reup cleanup --help` for user-facing docs.
//
// Rule thresholds (all adjustable here):
//   TRIVIAL_MAX_MESSAGES  Sessions with ≤ this many messages are "trivial"
//   STALE_DAYS            Days of inactivity before a short session is "stale"
//   STALE_MAX_MESSAGES    Only flag stale if the session is shorter than this
//
// Scores (0-100) reflect confidence that the session can be safely archived:
//   100  empty    — was never used; zero risk
//    90  orphaned — project deleted; not resumable anyway
//    85  expired  — past Claude's 30-day window; not resumable anyway
//    60  trivial  — very short; unlikely to have useful content
//    40  stale    — old and short; lower confidence, requires confirmation
// -----------------------------------------------------------------------------

export type CleanupReason =
  | 'empty' // messageCount === 0, never actually used
  | 'trivial' // 1-2 messages, no real content
  | 'orphaned' // project directory no longer exists
  | 'expired' // past Claude's 30-day conversation window
  | 'stale' // inactive for > STALE_DAYS, short conversation

const STALE_DAYS = 90
const TRIVIAL_MAX_MESSAGES = 2
const STALE_MAX_MESSAGES = 10 // only flag stale if the session was short

export interface CleanupCandidate {
  session: Session
  projectPath: string
  projectId: string
  reasons: CleanupReason[]
  /** Higher = more confident it can be safely removed. 0–100. */
  score: number
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

/** Analyses all projects and returns sessions that are candidates for cleanup. */
export function findCleanupCandidates(
  projects: Project[],
  activeSessionIds: ReadonlySet<string>,
  now = Date.now()
): CleanupCandidate[] {
  const candidates: CleanupCandidate[] = []

  for (const project of projects) {
    for (const session of project.sessions) {
      if (activeSessionIds.has(session.id)) continue
      if (session.signals.archived) continue

      const reasons = classifySession(session, now)
      if (reasons.length === 0) continue

      candidates.push({
        session,
        projectPath: session.projectPath || project.path,
        projectId: project.id,
        reasons,
        score: computeScore(reasons),
      })
    }
  }

  return candidates.sort((a, b) => b.score - a.score)
}

/** Returns a one-line summary suitable for `--check` output. */
export function summariseCandidates(candidates: CleanupCandidate[]): string {
  if (candidates.length === 0) return 'No cleanup candidates found.'

  const byReason: Partial<Record<CleanupReason, number>> = {}
  for (const c of candidates) {
    for (const r of c.reasons) byReason[r] = (byReason[r] ?? 0) + 1
  }

  const parts: string[] = []
  if (byReason.empty) parts.push(`${byReason.empty} empty`)
  if (byReason.trivial) parts.push(`${byReason.trivial} trivial`)
  if (byReason.orphaned) parts.push(`${byReason.orphaned} orphaned`)
  if (byReason.expired) parts.push(`${byReason.expired} expired`)
  if (byReason.stale) parts.push(`${byReason.stale} stale`)

  return `${candidates.length} cleanup candidate${candidates.length === 1 ? '' : 's'}: ${parts.join(', ')} — run \`reup cleanup\` to review`
}

// -----------------------------------------------------------------------------
// Reason labels for display
// -----------------------------------------------------------------------------

export const REASON_LABELS: Record<CleanupReason, string> = {
  empty: 'empty session',
  trivial: 'trivial (≤2 messages)',
  orphaned: 'project path missing',
  expired: 'expired (>30 days)',
  stale: `inactive >${STALE_DAYS}d`,
}

// -----------------------------------------------------------------------------
// Internals
// -----------------------------------------------------------------------------

function classifySession(session: Session, now: number): CleanupReason[] {
  const reasons: CleanupReason[] = []
  const daysSinceUpdate = msSince(session.updated, now) / 86_400_000

  if (session.messageCount === 0) {
    reasons.push('empty')
    return reasons // empty implies trivial — no need to double-count
  }

  if (session.messageCount <= TRIVIAL_MAX_MESSAGES) {
    reasons.push('trivial')
  }

  if (!session.signals.pathExists) {
    reasons.push('orphaned')
  }

  if (session.signals.expiresInDays !== null && session.signals.expiresInDays <= 0) {
    reasons.push('expired')
  }

  // Only flag stale if the session is short — long valuable sessions stay
  if (
    daysSinceUpdate > STALE_DAYS &&
    session.messageCount <= STALE_MAX_MESSAGES &&
    !reasons.includes('expired') // expired already covers old sessions
  ) {
    reasons.push('stale')
  }

  return reasons
}

function computeScore(reasons: CleanupReason[]): number {
  const weights: Record<CleanupReason, number> = {
    empty: 100,
    orphaned: 90,
    expired: 85,
    trivial: 60,
    stale: 40,
  }
  return Math.min(100, Math.max(...reasons.map((r) => weights[r])))
}

function msSince(isoDate: string, now: number): number {
  const ts = Date.parse(isoDate)
  return isNaN(ts) ? 0 : now - ts
}
