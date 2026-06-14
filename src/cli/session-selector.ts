import type { Project, Session } from '../core/session-model.js'
import { isValidSessionId } from '../core/session-model.js'

export interface SelectedSession {
  project: Project
  session: Session
}

export type SessionSelection = { result: SelectedSession } | { error: string }

/**
 * Resolves a full session UUID or an unambiguous UUID prefix.
 * Names and aliases are intentionally excluded because they need not be unique.
 */
export function selectSession(projects: Project[], selector: string): SessionSelection {
  const normalizedSelector = selector.toLowerCase()
  const matches: SelectedSession[] = []

  for (const project of projects) {
    for (const session of project.sessions) {
      const sessionId = session.id.toLowerCase()
      if (
        sessionId === normalizedSelector ||
        (normalizedSelector.length >= 8 && sessionId.startsWith(normalizedSelector))
      ) {
        matches.push({ project, session })
      }
    }
  }

  if (matches.length === 1) return { result: matches[0] }
  if (matches.length > 1) return { error: `session prefix is ambiguous: ${selector}` }
  if (isValidSessionId(selector)) return { error: `session not found: ${selector}` }
  if (selector.length < 8) return { error: 'session prefix must contain at least 8 characters' }
  return { error: `invalid or unknown session: ${selector}` }
}
