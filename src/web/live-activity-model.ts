import { loadProjects } from '../core/project/project-discovery.js'
import { getLiveSessionRecords, mergeSessionLockStatuses } from '../core/session/active-sessions.js'
import type { Project, Session } from '../core/session/session-model.js'
import { sessionTranscriptPath } from '../core/session/session-preview.js'
import { readSessionTailActivity, resolveActivityState } from '../core/session/session-tail.js'
import type { ActivityState } from '../core/session/session-tail.js'
import { isResumeVisibleSession } from '../core/session/session-visibility.js'
import { projectDisplayName } from './api-model.js'

export interface LiveActivityEntry {
  activityState: ActivityState
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
  const [liveRecords, allProjects] = await Promise.all([getLiveSessionRecords(), loadProjects()])
  const lockStatuses = mergeSessionLockStatuses(liveRecords)
  const activeSessionIds = [...lockStatuses.keys()]
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

      return {
        sessionId,
        projectId: project.id,
        projectName: projectDisplayName(project),
        sessionName: session.alias ?? session.name,
        lastToolName: tail?.lastToolName ?? null,
        activityState: resolveActivityState(lockStatus.status, tail, lockStatus.statusUpdatedAt),
        lastEventAt: tail?.lastEventAt ?? null,
      }
    })
  )

  return {
    activeSessionIds,
    entries: entries.filter((entry): entry is LiveActivityEntry => entry !== null),
  }
}
