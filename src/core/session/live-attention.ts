import {
  getLiveSessionRecords,
  mergeActiveSessionIds,
  mergeSessionLockStatuses,
} from './active-sessions.js'
import { combineWorkEvidence, readAttentionMarkers, readWorkSignalMarkers } from './attention.js'
import {
  claudeAgentLiveReading,
  isPresentableClaudeAgentSession,
  readClaudeAgentSnapshot,
} from './claude-agent-state.js'
import type { ClaudeAgentRefreshMode, ClaudeAgentSnapshot } from './claude-agent-state.js'
import {
  recordedTurnEndAt,
  resolveSessionLiveState,
  resolveUserInputWait,
} from './session-live-state.js'
import type { SessionLiveState } from './session-live-state.js'
import type { Project } from './session-model.js'
import { sessionTranscriptPath } from './session-preview.js'
import { readSessionTailActivity } from './session-tail.js'
import { isResumeVisibleSession } from './session-visibility.js'

export interface LiveSessionSignals {
  /** Active or managed sessions that Reup can anchor to a local session or process. */
  activeSessionIds: Set<string>
  /**
   * The shared state reading per presentable session, for surfaces that draw
   * activity and not just process liveness. Sessions outside the presentable
   * set are absent from the map and read as `detached`.
   */
  liveStateBySession: Map<string, SessionLiveState>
  /** The presentable sessions or managed tasks currently waiting on the user. */
  needsInputSessionIds: Set<string>
}

export interface LiveSessionSignalOptions {
  /** Injected by focused tests; omitted in production. */
  claudeAgentSnapshot?: ClaudeAgentSnapshot | null
  /** Persistent surfaces use background refresh; one-shot callers wait. */
  officialRefresh?: ClaudeAgentRefreshMode
}

/**
 * Resolves the unified "needs your input" signal for every presentable session.
 * Official inventory and Notification hooks are reported evidence; a turn
 * blocked on an unanswered tool or trailing question remains the fallback.
 * Consumers that only need per-session booleans (inbox, VS Code extension)
 * share this; the web strip resolves inline because it also needs messages.
 *
 * The same pass resolves `SessionLiveState`, because it already holds every
 * piece of evidence that reading needs. A consumer must never rebuild it from
 * the booleans here — that is how the surfaces drifted apart before.
 */
export async function resolveLiveSessionSignals(
  projects: Project[],
  options: LiveSessionSignalOptions = {}
): Promise<LiveSessionSignals> {
  const officialSnapshotPromise = Object.hasOwn(options, 'claudeAgentSnapshot')
    ? Promise.resolve(options.claudeAgentSnapshot ?? null)
    : readClaudeAgentSnapshot(options.officialRefresh ?? 'wait')
  const [liveRecords, attentionMarkers, workSignals, officialSnapshot] = await Promise.all([
    getLiveSessionRecords(),
    readAttentionMarkers(),
    readWorkSignalMarkers(),
    officialSnapshotPromise,
  ])
  const lockStatuses = mergeSessionLockStatuses(liveRecords)
  const workMarkerBySession = new Map(workSignals.map((marker) => [marker.sessionId, marker]))
  const attentionBySession = new Map(attentionMarkers.map((marker) => [marker.sessionId, marker]))

  const projectBySessionId = new Map<string, Project>()
  for (const project of projects) {
    for (const session of project.sessions) {
      if (isResumeVisibleSession(session)) projectBySessionId.set(session.id, project)
    }
  }
  const managedSessionIds = mergeActiveSessionIds(liveRecords, officialSnapshot)
  const activeSessionIds = new Set(
    [...managedSessionIds].filter((sessionId) =>
      isPresentableClaudeAgentSession(officialSnapshot?.records.get(sessionId), {
        hasLiveLock: lockStatuses.has(sessionId),
        hasResumeVisibleSession: projectBySessionId.has(sessionId),
      })
    )
  )

  const needsInputSessionIds = new Set<string>()
  const liveStateBySession = new Map<string, SessionLiveState>()
  await Promise.all(
    [...activeSessionIds].map(async (sessionId) => {
      const lockStatus = lockStatuses.get(sessionId) ?? { status: null, statusUpdatedAt: null }
      const evidence = combineWorkEvidence(
        lockStatus.status,
        lockStatus.statusUpdatedAt,
        workMarkerBySession.get(sessionId)
      )
      const project = projectBySessionId.get(sessionId)
      const tail = project
        ? await readSessionTailActivity(sessionTranscriptPath(project.id, sessionId))
        : null
      const attentionMarker = attentionBySession.get(sessionId)
      const latestLocalReportedAt = latestTimestamp(
        evidence.statusUpdatedAt,
        attentionMarker ? Date.parse(attentionMarker.occurredAt) : null,
        recordedTurnEndAt(tail)
      )
      const officialReading = claudeAgentLiveReading(
        officialSnapshot,
        sessionId,
        latestLocalReportedAt,
        lockStatuses.has(sessionId)
      )
      const { wait } = resolveUserInputWait(
        attentionMarker,
        evidence.status,
        evidence.statusUpdatedAt,
        tail,
        officialReading
      )
      const needsInput = wait !== null
      if (needsInput) needsInputSessionIds.add(sessionId)
      liveStateBySession.set(
        sessionId,
        resolveSessionLiveState({
          claudeAgentReading: officialReading,
          hasLiveProcess:
            lockStatuses.has(sessionId) ||
            (officialSnapshot?.records.get(sessionId)?.pid ?? null) !== null,
          needsInput,
          tail,
          workStatus: evidence.status,
          workStatusUpdatedAt: evidence.statusUpdatedAt,
        })
      )
    })
  )

  return {
    activeSessionIds,
    liveStateBySession,
    needsInputSessionIds,
  }
}

function latestTimestamp(...values: Array<number | null>): number | null {
  const finiteValues = values.filter((value): value is number => Number.isFinite(value))
  return finiteValues.length === 0 ? null : Math.max(...finiteValues)
}
