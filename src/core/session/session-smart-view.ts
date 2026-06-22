import type { Project, Session } from './session-model.js'

export const SESSION_SMART_VIEWS = [
  { id: 'active', label: 'Active now' },
  { id: 'attention', label: 'Needs attention' },
  { id: 'branch-drift', label: 'Branch drift' },
  { id: 'path-missing', label: 'Path missing' },
  { id: 'high-context', label: 'High context' },
  { id: 'expiring', label: 'Expiring soon' },
  { id: 'recent', label: 'Recently touched' },
] as const

export type SessionSmartViewId = (typeof SESSION_SMART_VIEWS)[number]['id']

const HIGH_CONTEXT_THRESHOLD = 150_000
const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000

/** Returns the first matching Inbox bucket, preserving one exclusive priority order. */
export function primarySessionSmartView(
  session: Session,
  activeSessionIds: ReadonlySet<string>,
  now = Date.now()
): SessionSmartViewId | null {
  if (session.signals.archived) return null
  if (activeSessionIds.has(session.id)) return 'active'
  if (session.signals.interrupted || session.signals.lastToolFailed) return 'attention'
  if (session.gitBranch && session.currentBranch && session.gitBranch !== session.currentBranch) {
    return 'branch-drift'
  }
  if (!session.signals.pathExists) return 'path-missing'
  if ((session.context.latestContextTokens ?? 0) >= HIGH_CONTEXT_THRESHOLD) return 'high-context'
  if (session.signals.expiresInDays !== null && session.signals.expiresInDays <= 7) {
    return 'expiring'
  }
  if (now - new Date(session.updated).getTime() <= RECENT_WINDOW_MS) return 'recent'
  return null
}

/** Filters projects while preserving project metadata and original session ordering. */
export function filterProjectsBySmartView(
  projects: Project[],
  activeSessionIds: ReadonlySet<string>,
  smartViewId: SessionSmartViewId | null,
  now = Date.now()
): Project[] {
  if (!smartViewId) return projects
  return projects.flatMap((project) => {
    const sessions = project.sessions.filter(
      (session) => primarySessionSmartView(session, activeSessionIds, now) === smartViewId
    )
    return sessions.length > 0 ? [{ ...project, sessions }] : []
  })
}

export function smartViewLabel(id: SessionSmartViewId | null): string | null {
  return SESSION_SMART_VIEWS.find((view) => view.id === id)?.label ?? null
}

export function nextSessionSmartView(
  current: SessionSmartViewId | null
): SessionSmartViewId | null {
  if (current === null) return SESSION_SMART_VIEWS[0].id
  const index = SESSION_SMART_VIEWS.findIndex((view) => view.id === current)
  return index < 0 || index === SESSION_SMART_VIEWS.length - 1
    ? null
    : SESSION_SMART_VIEWS[index + 1].id
}
