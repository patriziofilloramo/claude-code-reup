import { loadProjects } from '../core/project/project-discovery.js'
import { resolveLiveSessionSignals } from '../core/session/live-attention.js'
import type { Project, Session, SessionStatus } from '../core/session/session-model.js'
import { primaryStatus } from '../core/session/session-signals.js'
import { relativeTime } from '../utils/time.js'
import { writeOutput } from './output.js'
import { sanitizeTerminalField } from './terminal-text.js'

interface InboxSession {
  active: boolean
  needsInput: boolean
  projectPath: string
  session: Session
  status: SessionStatus
}

const STATUS_PRIORITY: Record<SessionStatus, number> = {
  'path-missing': 0,
  expiring: 1,
  interrupted: 2,
  'heavily-compacted': 3,
  ok: 4,
}

/**
 * Statuses that still earn a session an inbox place on their own. The
 * historical `interrupted` flag is a full-transcript triage signal for
 * `reup cleanup`/`reup doctor`; live needs-input detection replaced it here.
 */
const INBOX_ACTIONABLE_STATUSES: ReadonlySet<SessionStatus> = new Set(['expiring', 'path-missing'])

/** Prints non-archived sessions that are active, waiting on input, or need triage. */
export async function showInbox(): Promise<void> {
  const projects = await loadProjects()
  const signals = await resolveLiveSessionSignals(projects)
  writeOutput(formatInbox(projects, signals.activeSessionIds, signals.needsInputSessionIds))
}

export function formatInbox(
  projects: Project[],
  activeSessionIds: ReadonlySet<string>,
  needsInputIds: ReadonlySet<string> = new Set()
): string {
  const sessions = collectInboxSessions(projects, activeSessionIds, needsInputIds)
  if (sessions.length === 0) return 'Inbox clear. No active sessions or sessions needing attention.'

  const lines = [`Reup Inbox (${sessions.length})`, '']
  for (const item of sessions) {
    const session = item.session
    const labels = [
      item.needsInput ? 'needs input' : '',
      item.active ? 'active' : '',
      INBOX_ACTIONABLE_STATUSES.has(item.status) ? item.status : '',
    ].filter(Boolean)
    lines.push(sanitizeTerminalField(session.alias ?? session.name))
    lines.push(
      `  ${labels.join(', ')} · ${relativeTime(session.updated)} · ${session.id.slice(0, 8)}`
    )
    lines.push(`  ${sanitizeTerminalField(item.projectPath)}`)
  }
  return lines.join('\n')
}

function collectInboxSessions(
  projects: Project[],
  activeSessionIds: ReadonlySet<string>,
  needsInputIds: ReadonlySet<string>
): InboxSession[] {
  return projects
    .flatMap((project) =>
      project.sessions.map((session) => ({
        active: activeSessionIds.has(session.id),
        needsInput: needsInputIds.has(session.id),
        projectPath: session.projectPath || project.path,
        session,
        status: primaryStatus(session.signals),
      }))
    )
    .filter(
      (item) =>
        !item.session.signals.archived &&
        (item.active || item.needsInput || INBOX_ACTIONABLE_STATUSES.has(item.status))
    )
    .sort((left, right) => {
      if (left.needsInput !== right.needsInput) return left.needsInput ? -1 : 1
      if (left.active !== right.active) return left.active ? -1 : 1
      const statusComparison = STATUS_PRIORITY[left.status] - STATUS_PRIORITY[right.status]
      return statusComparison || right.session.updated.localeCompare(left.session.updated)
    })
}
