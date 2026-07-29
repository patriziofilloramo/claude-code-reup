import { loadProjects } from '../core/project/project-discovery.js'
import { getLiveSessionRecords, mergeSessionLockStatuses } from '../core/session/active-sessions.js'
import type { SessionWorkState } from '../core/session/active-sessions.js'
import {
  clearAttentionMarker,
  clearWorkSignalMarker,
  combineWorkEvidence,
  readAttentionMarkers,
  readWorkSignalMarkers,
} from '../core/session/attention.js'
import type { AttentionMarker } from '../core/session/attention.js'
import {
  resolveSessionLiveState,
  resolveUserInputWait,
} from '../core/session/session-live-state.js'
import type { SessionLiveState } from '../core/session/session-live-state.js'
import type { Project, Session } from '../core/session/session-model.js'
import { sessionTranscriptPath } from '../core/session/session-preview.js'
import { readSessionTailActivity, resolveActivityState } from '../core/session/session-tail.js'
import type { ActivityState, SessionTailActivity } from '../core/session/session-tail.js'
import { isResumeVisibleSession } from '../core/session/session-visibility.js'
import { projectDisplayName } from './api-model.js'

export interface LiveActivityAttention {
  /**
   * Whether Claude Code's Notification hook reported this wait, rather than it
   * being inferred from the transcript's shape.
   *
   * Consumers must not raise an alert on an inferred wait. Its `since` is the
   * tail's last event, which moves every time the transcript grows, so a
   * notification keyed on it fires again every few seconds -- reported from
   * real use as a storm of "needs input" alerts. Drawing it is fine; claiming
   * it is not.
   */
  isReported: boolean
  message: string
  since: string
}

export interface LiveActivityEntry {
  /**
   * The web's finer reading, kept alongside `liveState` rather than replacing
   * it. It splits the shared "attached" state into `waiting` and `idle`, which
   * the web can afford to show because it has room for a label explaining the
   * difference. Read `liveState` for the base experience; read this only to
   * add detail on top of it, and only together with `stateIsReported`.
   */
  activityState: ActivityState
  /** Set while the session waits on the user (permission prompt, idle input). */
  attention: LiveActivityAttention | null
  /**
   * The user stopped the turn and nothing has happened since — recorded by
   * Claude Code, not inferred. The strip shows this instead of "waiting",
   * which reads as "Claude is between turns" and hides the fact that it was
   * cut short.
   */
  endedByUserInterruption: boolean
  lastEventAt: string | null
  lastToolName: string | null
  /**
   * The shared cross-surface reading — the same value the TUI and the VS Code
   * extension resolve from the same evidence. This is the base experience: if
   * the web ever disagrees with another surface about whether a session is
   * working, this field is the one that must be believed.
   */
  liveState: SessionLiveState
  projectId: string
  projectName: string
  sessionId: string
  sessionName: string
  /**
   * Whether `activityState` came from a source that actually reports turn
   * boundaries — a lock status field or a hook marker — rather than from
   * transcript recency.
   *
   * False for the sessions that have neither (VS Code locks omit `status`), and
   * there the state is a guess: a long tool call and a finished turn look
   * identical once the transcript goes quiet. Consumers must not present a
   * guess as an event; the desktop "turn finished" alert requires this.
   */
  stateIsReported: boolean
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
          endedByUserInterruption: false,
          attention,
          lastEventAt: null,
          liveState: resolveSessionLiveState({
            isAttached: true,
            needsInput: true,
            tail: null,
            workStatus: evidence.status,
            workStatusUpdatedAt: evidence.statusUpdatedAt,
          }),
          stateIsReported: evidence.status !== null,
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
        endedByUserInterruption: tail?.turnEndedByRecord === 'user-interruption',
        attention,
        lastEventAt: tail?.lastEventAt ?? null,
        liveState: resolveSessionLiveState({
          isAttached: true,
          needsInput: attention !== null,
          tail,
          workStatus: evidence.status,
          workStatusUpdatedAt: evidence.statusUpdatedAt,
        }),
        stateIsReported: evidence.status !== null,
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
  lockStatus: SessionWorkState | null
): LiveActivityAttention | null {
  const { staleMarkerSessionId, wait } = resolveUserInputWait(
    marker,
    lockStatus,
    statusUpdatedAt,
    tail
  )
  // The core reports a resolved or orphaned marker; deleting it is this
  // layer's job, because the core stays pure and callable at render time.
  if (staleMarkerSessionId !== null) void clearAttentionMarker(staleMarkerSessionId)
  if (wait === null) return null

  return wait.kind === 'marker'
    ? { isReported: true, message: wait.marker.message, since: wait.marker.occurredAt }
    : { isReported: false, message: 'Waiting for your answer to continue', since: wait.since }
}
