import { getLiveSessionRecords, mergeSessionLockStatuses } from './active-sessions.js'
import {
  combineWorkEvidence,
  isAttentionActive,
  readAttentionMarkers,
  readWorkSignalMarkers,
} from './attention.js'
import type { Project } from './session-model.js'
import { sessionTranscriptPath } from './session-preview.js'
import { isAwaitingUserReply, readSessionTailActivity } from './session-tail.js'

export interface LiveSessionSignals {
  /** Every session with a live Claude Code process. */
  activeSessionIds: Set<string>
  /** The live sessions currently waiting on the user. */
  needsInputSessionIds: Set<string>
}

/**
 * Resolves the unified "needs your input" signal for every live session, the
 * same way the TUI and the web activity strip do: a Notification-hook marker
 * counts until the session shows life after it, and a turn blocked on an
 * unanswered tool call or trailing question counts even without a hook.
 * Consumers that only need per-session booleans (inbox, VS Code extension)
 * share this; the web strip resolves inline because it also needs messages.
 */
export async function resolveLiveSessionSignals(projects: Project[]): Promise<LiveSessionSignals> {
  const [liveRecords, attentionMarkers, workSignals] = await Promise.all([
    getLiveSessionRecords(),
    readAttentionMarkers(),
    readWorkSignalMarkers(),
  ])
  const lockStatuses = mergeSessionLockStatuses(liveRecords)
  const workMarkerBySession = new Map(workSignals.map((marker) => [marker.sessionId, marker]))
  const attentionBySession = new Map(attentionMarkers.map((marker) => [marker.sessionId, marker]))

  const projectBySessionId = new Map<string, Project>()
  for (const project of projects) {
    for (const session of project.sessions) projectBySessionId.set(session.id, project)
  }

  const needsInputSessionIds = new Set<string>()
  await Promise.all(
    [...lockStatuses].map(async ([sessionId, lockStatus]) => {
      const evidence = combineWorkEvidence(
        lockStatus.status,
        lockStatus.statusUpdatedAt,
        workMarkerBySession.get(sessionId)
      )
      const project = projectBySessionId.get(sessionId)
      const tail = project
        ? await readSessionTailActivity(sessionTranscriptPath(project.id, sessionId))
        : null
      const marker = attentionBySession.get(sessionId)
      const lastActivityMs = tail?.lastEventAt ? Date.parse(tail.lastEventAt) : null
      const markerActive =
        marker !== undefined &&
        isAttentionActive(marker, {
          isLive: true,
          lastActivityMs:
            lastActivityMs !== null && Number.isFinite(lastActivityMs) ? lastActivityMs : null,
          statusUpdatedAt: evidence.statusUpdatedAt,
        })
      if (markerActive || isAwaitingUserReply(evidence.status, tail)) {
        needsInputSessionIds.add(sessionId)
      }
    })
  )

  return { activeSessionIds: new Set(lockStatuses.keys()), needsInputSessionIds }
}
