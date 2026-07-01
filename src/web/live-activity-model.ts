import { loadProjects } from '../core/project/project-discovery.js'
import { getLiveSessionRecords, mergeSessionLockStatuses } from '../core/session/active-sessions.js'
import {
  clearAttentionMarker,
  isAttentionActive,
  readAttentionMarkers,
} from '../core/session/attention.js'
import type { AttentionMarker } from '../core/session/attention.js'
import type { Project, Session } from '../core/session/session-model.js'
import { sessionTranscriptPath } from '../core/session/session-preview.js'
import { readSessionTailActivity, resolveActivityState } from '../core/session/session-tail.js'
import type { ActivityState } from '../core/session/session-tail.js'
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
  const [liveRecords, allProjects, attentionMarkers] = await Promise.all([
    getLiveSessionRecords(),
    loadProjects(),
    readAttentionMarkers(),
  ])
  const lockStatuses = mergeSessionLockStatuses(liveRecords)
  const activeSessionIds = [...lockStatuses.keys()]
  const attentionBySession = new Map(
    attentionMarkers.map((marker) => [marker.sessionId, marker] as const)
  )
  if (activeSessionIds.length === 0) return { activeSessionIds, entries: [] }

  const sessionIndex = new Map<string, { project: Project; session: Session }>()
  for (const project of allProjects) {
    for (const session of project.sessions) {
      if (!isResumeVisibleSession(session)) continue
      sessionIndex.set(session.id, { project, session })
    }
  }

  const entries = await Promise.all(
    [...lockStatuses].map(async ([sessionId, lockStatus]) => {
      const found = sessionIndex.get(sessionId)
      if (!found) return null

      const { project, session } = found
      const tail = await readSessionTailActivity(sessionTranscriptPath(project.id, sessionId))
      const attention = resolveSessionAttention(
        attentionBySession.get(sessionId),
        lockStatus.statusUpdatedAt,
        tail?.lastEventAt ?? null
      )

      return {
        sessionId,
        projectId: project.id,
        projectName: projectDisplayName(project),
        sessionName: session.alias ?? session.name,
        lastToolName: tail?.lastToolName ?? null,
        activityState: resolveActivityState(lockStatus.status, tail, lockStatus.statusUpdatedAt),
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
 * Returns the still-active attention for a session, or null. A resolved or
 * orphaned marker is deleted in the background so it can never alert again.
 */
function resolveSessionAttention(
  marker: AttentionMarker | undefined,
  statusUpdatedAt: number | null,
  lastEventAt: string | null
): LiveActivityAttention | null {
  if (!marker) return null
  const lastActivityMs = lastEventAt !== null ? Date.parse(lastEventAt) : null
  const active = isAttentionActive(marker, {
    isLive: true,
    lastActivityMs: Number.isFinite(lastActivityMs) ? lastActivityMs : null,
    statusUpdatedAt,
  })
  if (!active) {
    void clearAttentionMarker(marker.sessionId)
    return null
  }
  return { message: marker.message, since: marker.occurredAt }
}
