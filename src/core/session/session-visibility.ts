import type { Project, Session } from './session-model.js'

export type ResumeListSessionInput = Pick<Session, 'messageCount'> & {
  signals: Pick<Session['signals'], 'archived'>
}

export interface ResumeListVisibilityOptions {
  includeArchived?: boolean
}

export function isResumeVisibleSession(session: Pick<Session, 'messageCount'>): boolean {
  return session.messageCount > 0
}

export function isResumeListVisibleSession(
  session: ResumeListSessionInput,
  options: ResumeListVisibilityOptions = {}
): boolean {
  if (!isResumeVisibleSession(session)) return false
  return options.includeArchived === true || !session.signals.archived
}

export function filterResumeListProjects(
  projects: Project[],
  options: ResumeListVisibilityOptions = {}
): Project[] {
  return projects.flatMap((project) => {
    const sessions = project.sessions.filter((session) =>
      isResumeListVisibleSession(session, options)
    )
    return sessions.length > 0 ? [{ ...project, sessions }] : []
  })
}
