import { getActiveSessions } from '../core/active-sessions.js'
import { loadProjects } from '../core/project-discovery.js'
import type { Project, Session, SessionStatus } from '../core/session-model.js'
import { primaryStatus } from '../core/session-signals.js'
import { relativeTime } from '../utils/time.js'
import { writeOutput } from './output.js'

interface InboxSession {
  active: boolean
  projectPath: string
  session: Session
  status: SessionStatus
}

const STATUS_PRIORITY: Record<SessionStatus, number> = {
  interrupted: 0,
  expiring: 1,
  'path-missing': 2,
  'heavily-compacted': 3,
  ok: 4,
}

/** Prints non-archived sessions that are active or need attention. */
export async function showInbox(): Promise<void> {
  const [projects, activeSessionIds] = await Promise.all([loadProjects(), getActiveSessions()])
  writeOutput(formatInbox(projects, activeSessionIds))
}

export function formatInbox(projects: Project[], activeSessionIds: ReadonlySet<string>): string {
  const sessions = collectInboxSessions(projects, activeSessionIds)
  if (sessions.length === 0) return 'Inbox clear. No active sessions or sessions needing attention.'

  const lines = [`CCM Inbox (${sessions.length})`, '']
  for (const item of sessions) {
    const session = item.session
    const labels = [item.active ? 'active' : '', item.status !== 'ok' ? item.status : ''].filter(
      Boolean
    )
    lines.push(`${session.alias ?? session.name}`)
    lines.push(
      `  ${labels.join(', ')} · ${relativeTime(session.updated)} · ${session.id.slice(0, 8)}`
    )
    lines.push(`  ${item.projectPath}`)
  }
  return lines.join('\n')
}

function collectInboxSessions(
  projects: Project[],
  activeSessionIds: ReadonlySet<string>
): InboxSession[] {
  return projects
    .flatMap((project) =>
      project.sessions.map((session) => ({
        active: activeSessionIds.has(session.id),
        projectPath: session.projectPath || project.path,
        session,
        status: primaryStatus(session.signals),
      }))
    )
    .filter((item) => !item.session.signals.archived && (item.active || item.status !== 'ok'))
    .sort((left, right) => {
      if (left.active !== right.active) return left.active ? -1 : 1
      const statusComparison = STATUS_PRIORITY[left.status] - STATUS_PRIORITY[right.status]
      return statusComparison || right.session.updated.localeCompare(left.session.updated)
    })
}
