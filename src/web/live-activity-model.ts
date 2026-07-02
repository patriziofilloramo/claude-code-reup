import { loadProjects } from '../core/project/project-discovery.js'
import { getLiveSessionRecords, mergeSessionLockStatuses } from '../core/session/active-sessions.js'
import {
  clearAttentionMarker,
  clearWorkSignalMarker,
  combineWorkEvidence,
  isAttentionActive,
  readAttentionMarkers,
  readWorkSignalMarkers,
} from '../core/session/attention.js'
import type { AttentionMarker } from '../core/session/attention.js'
import type { Project, Session } from '../core/session/session-model.js'
import { sessionTranscriptPath } from '../core/session/session-preview.js'
import {
  isAwaitingUserReply,
  readSessionTailActivity,
  resolveActivityState,
} from '../core/session/session-tail.js'
import type { ActivityState, SessionTailActivity } from '../core/session/session-tail.js'
import { isResumeVisibleSession } from '../core/session/session-visibility.js'
import { projectDisplayName } from './api-model.js'

export interface LiveActivityAttention {
  message: string
  since: string
}

export interface LiveActivityEntry {
  activityState: ActivityState
  /** Set while the session waits on the user (permission prompt, idle input). */
  attention: LiveActivityAttention | null
  lastEventAt: string | null
  lastToolName: string | null
  projectId: string
  projectName: string
  sessionId: string
  sessionName: string
}

export interface LiveActivitySnapshot {
  /** Every session with a live lock, including ones without a strip entry. */
  activeSessionIds: string[]
  entries: LiveActivityEntry[]
}

/**
 * Builds the per-active-session activity model shared by the REST route and
 * SSE activity pushes. Lock files are merged per session (busy wins) so one
 * session with several attached processes yields exactly one entry.
 */
export async function buildLiveActivitySnapshot(): Promise<LiveActivitySnapshot> {
  const [liveRecords, allProjects, attentionMarkers, workMarkers] = await Promise.all([
    getLiveSessionRecords(),
    loadProjects(),
    readAttentionMarkers(),
    readWorkSignalMarkers(),
  ])
  const lockStatuses = mergeSessionLockStatuses(liveRecords)
  const activeSessionIds = [...lockStatuses.keys()]
  const attentionBySession = new Map(
    attentionMarkers.map((marker) => [marker.sessionId, marker] as const)
  )
  const workMarkerBySession = new Map(
    workMarkers.map((marker) => [marker.sessionId, marker] as const)
  )
  // Ended sessions leave their last Stop marker behind; without cleanup the
  // marker directory grows one file per session ever run.
  for (const marker of workMarkers) {
    if (!lockStatuses.has(marker.sessionId)) void clearWorkSignalMarker(marker.sessionId)
  }
  if (activeSessionIds.length === 0) return { activeSessionIds, entries: [] }

  const sessionIndex = new Map<string, { project: Project; session: Session }>()
  for (const project of allProjects) {
    for (const session of project.sessions) {
      if (!isResumeVisibleSession(session)) continue
      sessionIndex.set(session.id, { project, session })
    }
  }

  const cwdBySession = new Map<string, string>()
  for (const record of liveRecords) {
    if (record.cwd && !cwdBySession.has(record.sessionId)) {
      cwdBySession.set(record.sessionId, record.cwd)
    }
  }

  const entries = await Promise.all(
    [...lockStatuses].map(async ([sessionId, lockStatus]) => {
      const found = sessionIndex.get(sessionId)
      // Turn-boundary hooks cover the sessions whose locks omit the status
      // field entirely (VS Code peers); the newer transition wins.
      const evidence = combineWorkEvidence(
        lockStatus.status,
        lockStatus.statusUpdatedAt,
        workMarkerBySession.get(sessionId)
      )

      if (!found) {
        // A session outside discovery (brand-new, no transcript yet) must
        // still surface its alert: an attention event is never dropped just
        // because the session is not resume-visible.
        const attention = resolveSessionAttention(
          attentionBySession.get(sessionId),
          evidence.statusUpdatedAt,
          null,
          evidence.status
        )
        if (!attention) return null
        const cwd = cwdBySession.get(sessionId)
        return {
          sessionId,
          projectId: '',
          projectName: cwd ? (cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd) : 'new session',
          sessionName: sessionId.slice(0, 8),
          lastToolName: null,
          activityState: resolveActivityState(evidence.status, null, evidence.statusUpdatedAt),
          attention,
          lastEventAt: null,
        }
      }

      const { project, session } = found
      const tail = await readSessionTailActivity(sessionTranscriptPath(project.id, sessionId))
      const attention = resolveSessionAttention(
        attentionBySession.get(sessionId),
        evidence.statusUpdatedAt,
        tail,
        evidence.status
      )

      return {
        sessionId,
        projectId: project.id,
        projectName: projectDisplayName(project),
        sessionName: session.alias ?? session.name,
        lastToolName: tail?.lastToolName ?? null,
        activityState: resolveActivityState(evidence.status, tail, evidence.statusUpdatedAt),
        attention,
        lastEventAt: tail?.lastEventAt ?? null,
      }
    })
  )

  return {
    activeSessionIds,
    entries: entries.filter((entry): entry is LiveActivityEntry => entry !== null),
  }
}

/**
 * Returns the still-active attention for a session, or null.
 *
 * Two independent sources feed it: a Notification-hook marker (permission or
 * input prompt — the hook told us directly), and a blocked turn the hook
 * cannot see: the lock says the turn ended (`idle`) while the transcript tail
 * still has an unanswered tool call. The tail parser already clears pending
 * tool uses on any later user prompt or interrupt marker, so `toolPending`
 * here means the session is genuinely stuck on the user, not merely between
 * turns. A resolved or orphaned marker is deleted in the background so it can
 * never alert again.
 */
export function resolveSessionAttention(
  marker: AttentionMarker | undefined,
  statusUpdatedAt: number | null,
  tail: SessionTailActivity | null,
  lockStatus: 'busy' | 'idle' | null
): LiveActivityAttention | null {
  if (marker) {
    const lastActivityMs = tail?.lastEventAt ? Date.parse(tail.lastEventAt) : null
    const active = isAttentionActive(marker, {
      isLive: true,
      lastActivityMs:
        lastActivityMs !== null && Number.isFinite(lastActivityMs) ? lastActivityMs : null,
      statusUpdatedAt,
    })
    if (!active) {
      void clearAttentionMarker(marker.sessionId)
      return null
    }
    return { message: marker.message, since: marker.occurredAt }
  }

  if (isAwaitingUserReply(lockStatus, tail) && tail?.lastEventAt) {
    return {
      message: 'Waiting for your answer to continue',
      since: tail.lastEventAt,
    }
  }

  return null
}
