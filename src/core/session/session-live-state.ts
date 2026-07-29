import type { SessionWorkState } from './active-sessions.js'
import { isAttentionActive } from './attention.js'
import type { AttentionMarker } from './attention.js'
import { isAwaitingUserReply, resolveActivityState } from './session-tail.js'
import type { SessionTailActivity } from './session-tail.js'

/**
 * What a session is doing right now, in the one vocabulary every surface
 * shares. This is the base live experience: the TUI, the web UI, and the VS
 * Code extension must all answer this question the same way, from the same
 * evidence, and differ only in how they draw the answer.
 *
 * Ordered by urgency, most urgent first. A surface may render extra detail on
 * top — the web additionally separates a reported "waiting" from a quiet
 * moment it cannot vouch for — but it may not add a value here or reinterpret
 * one, because that is what makes the surfaces disagree.
 */
export type SessionLiveState =
  /** Blocked on the user: a permission prompt, or a tool that exists to ask. */
  | 'needs-input'
  /** Producing output or running a tool right now. */
  | 'working'
  /** A live process holds the session, currently quiet. */
  | 'attached'
  /** No live process. */
  | 'detached'

/**
 * Everything the shared reading depends on. Callers assemble it from the
 * sources they already poll; none of it is fetched here, so this stays a pure
 * function that surfaces can call at render time.
 */
export interface SessionLiveEvidence {
  /** Resolved by the shared attention signal, not by a surface's own guess. */
  needsInput: boolean
  /** Whether a live lock file names this session. */
  isAttached: boolean
  /** Merged lock status and hook marker; null when neither reports boundaries. */
  workStatus: SessionWorkState | null
  /** When that status last changed, for judging how far to trust it. */
  workStatusUpdatedAt: number | null
  /** Parsed transcript tail, or null when it could not be read. */
  tail: SessionTailActivity | null
}

/**
 * Resolves the shared live reading.
 *
 * "working" is deliberately the only state derived from activity: everything
 * quieter collapses into "attached", because the difference between a session
 * pausing and a session finished is exactly the judgement that proved
 * unreliable for sessions whose locks report no turn boundaries. A surface
 * that wants that distinction must opt into it explicitly.
 */
export function resolveSessionLiveState(
  evidence: SessionLiveEvidence,
  now = Date.now()
): SessionLiveState {
  if (!evidence.isAttached) return 'detached'
  if (evidence.needsInput) return 'needs-input'

  const activity = resolveActivityState(
    evidence.workStatus,
    evidence.tail,
    evidence.workStatusUpdatedAt,
    now
  )
  return activity === 'running' ? 'working' : 'attached'
}

/**
 * Why a session is blocked on the user, or null when it is not.
 *
 * Two independent sources answer this, and both must be consulted:
 *
 * - `marker` — Claude Code's Notification hook told us directly (a permission
 *   prompt, or input idle). Authoritative while still active.
 * - `blocked-turn` — no hook fired, but the turn ended with an unanswered tool
 *   call or a trailing question. The tail parser clears pending tool uses on
 *   any later prompt or interrupt marker, so this genuinely means stuck.
 *
 * A stale marker is reported as `null` together with `staleMarkerSessionId`,
 * so a caller that owns marker storage can delete it. Deleting is deliberately
 * not done here: this stays a pure function, callable at render time.
 */
export type UserInputWait =
  /** Reported: Claude Code's Notification hook said so. Authoritative. */
  | { kind: 'marker'; marker: AttentionMarker }
  /**
   * Inferred from the transcript's shape. Good enough to draw, never good
   * enough to claim: `since` moves with the transcript, so anything keyed on
   * it fires again every time the file grows.
   */
  | { kind: 'blocked-turn'; since: string }

export interface UserInputWaitResult {
  staleMarkerSessionId: string | null
  wait: UserInputWait | null
}

/**
 * Resolves whether a live session is waiting on the user.
 *
 * One implementation for every surface. It previously existed twice — once for
 * the inbox and the VS Code extension, once inside the web activity model,
 * which needed a message rather than a boolean — and two copies of this
 * decision are exactly how surfaces drift apart.
 */
export function resolveUserInputWait(
  marker: AttentionMarker | undefined,
  workStatus: SessionWorkState | null,
  workStatusUpdatedAt: number | null,
  tail: SessionTailActivity | null
): UserInputWaitResult {
  if (marker) {
    const active = isAttentionActive(marker, {
      isLive: true,
      lastActivityMs: lastEventMs(tail),
      statusUpdatedAt: workStatusUpdatedAt,
    })
    if (active) return { staleMarkerSessionId: null, wait: { kind: 'marker', marker } }
    return { staleMarkerSessionId: marker.sessionId, wait: null }
  }

  if (isAwaitingUserReply(workStatus, tail) && tail?.lastEventAt) {
    return {
      staleMarkerSessionId: null,
      wait: { kind: 'blocked-turn', since: tail.lastEventAt },
    }
  }

  return { staleMarkerSessionId: null, wait: null }
}

/** The tail's last event as epoch ms, or null when absent or unparseable. */
function lastEventMs(tail: SessionTailActivity | null): number | null {
  if (!tail?.lastEventAt) return null
  const parsed = Date.parse(tail.lastEventAt)
  return Number.isFinite(parsed) ? parsed : null
}
