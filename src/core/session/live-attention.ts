import { getLiveSessionRecords, mergeSessionLockStatuses } from './active-sessions.js'
import { combineWorkEvidence, readAttentionMarkers, readWorkSignalMarkers } from './attention.js'
import { resolveSessionLiveState, resolveUserInputWait } from './session-live-state.js'
import type { SessionLiveState } from './session-live-state.js'
import type { Project } from './session-model.js'
import { sessionTranscriptPath } from './session-preview.js'
import { readSessionTailActivity } from './session-tail.js'

export interface LiveSessionSignals {
  /** Every session with a live Claude Code process. */
  activeSessionIds: Set<string>
  /**
   * The shared live reading per session, for surfaces that draw activity and
   * not just liveness. Sessions with no live process are absent from the map
   * and read as `detached`.
   */
  liveStateBySession: Map<string, SessionLiveState>
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
 *
 * The same pass resolves `SessionLiveState`, because it already holds every
 * piece of evidence that reading needs. A consumer must never rebuild it from
 * the booleans here — that is how the surfaces drifted apart before.
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
  const liveStateBySession = new Map<string, SessionLiveState>()
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
      const { wait } = resolveUserInputWait(
        attentionBySession.get(sessionId),
        evidence.status,
        evidence.statusUpdatedAt,
        tail
      )
      const needsInput = wait !== null
      if (needsInput) needsInputSessionIds.add(sessionId)
      liveStateBySession.set(
        sessionId,
        resolveSessionLiveState({
          isAttached: true,
          needsInput,
          tail,
          workStatus: evidence.status,
          workStatusUpdatedAt: evidence.statusUpdatedAt,
        })
      )
    })
  )

  return {
    activeSessionIds: new Set(lockStatuses.keys()),
    liveStateBySession,
    needsInputSessionIds,
  }
}
