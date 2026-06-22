import type { Project, Session } from '../core/session/session-model.js'
import {
  parseSessionQuery,
  sessionMatchesParsedQuery,
  sessionQueryHasQualifiers,
} from '../core/session/session-query.js'
import { primaryStatus } from '../core/session/session-signals.js'

/** Reserves one body row for the selected session's optional detail line. */
export function calculateMaximumVisibleSessions(
  availableBodyRows: number,
  reservesDetailRow: boolean
): number {
  return Math.max(2, Math.floor(availableBodyRows) - (reservesDetailRow ? 1 : 0))
}

/**
 * Returns the visible list window and the selected index relative to that
 * window. Keeping this pure makes terminal-height behaviour easy to reason
 * about independently from Ink rendering.
 */
export function createVisibleWindow<T>(
  items: T[],
  selectedIndex: number,
  maximumVisibleItems: number
): [T[], number] {
  const clampedSelectionIndex = Math.max(0, Math.min(selectedIndex, items.length - 1))
  if (items.length <= maximumVisibleItems) return [items, clampedSelectionIndex]

  const halfWindowSize = Math.floor(maximumVisibleItems / 2)
  const windowStartIndex = Math.min(
    Math.max(0, clampedSelectionIndex - halfWindowSize),
    items.length - maximumVisibleItems
  )
  return [
    items.slice(windowStartIndex, windowStartIndex + maximumVisibleItems),
    clampedSelectionIndex - windowStartIndex,
  ]
}

/**
 * Applies archive visibility and global text search to the TUI project tree.
 *
 * Supports search qualifiers:
 *   is:active    — only sessions currently running
 *   is:archived  — only archived sessions (also overrides showArchivedSessions)
 *   project:<t>  — only projects whose path contains <t>
 *   branch:<t>   — only sessions whose branch contains <t>
 *   status:<t>   — only sessions whose primary status contains <t>
 *   tag:<t>      — only sessions whose tags include <t> (also: #<t>)
 *
 * A project match keeps all of its visible sessions. A session match keeps
 * only matching sessions and their parent project.
 */
export function deriveSearchResults(
  projects: Project[],
  searchQuery: string,
  showArchivedSessions: boolean,
  activeSessionIds: Set<string> = new Set()
): Project[] {
  const parsed = parseSessionQuery(searchQuery)
  const showArchived = showArchivedSessions || parsed.filterArchived
  const hasQualifiers = sessionQueryHasQualifiers(parsed)

  return projects.flatMap((project) => {
    const visibleSessions = project.sessions.filter(
      (session) => showArchived || !session.signals.archived
    )

    // Whole-project qualifier: filter out projects not matching project: term
    if (parsed.projectTerms.length > 0) {
      const projectPath = project.path.toLowerCase()
      if (!parsed.projectTerms.some((t) => projectPath.includes(t))) return []
    }

    // No qualifiers: preserve original text-search behaviour
    if (!hasQualifiers) {
      if (!parsed.text) return [{ ...project, sessions: visibleSessions }]
      if (projectMatchesQuery(project, parsed.text))
        return [{ ...project, sessions: visibleSessions }]
      const matchingSessions = visibleSessions.filter((session) =>
        sessionMatchesQuery(session, parsed.text)
      )
      return matchingSessions.length > 0 ? [{ ...project, sessions: matchingSessions }] : []
    }

    // With session-level qualifiers: filter per-session
    const matchingSessions = visibleSessions.filter((session) => {
      return sessionMatchesParsedQuery(
        {
          active: activeSessionIds.has(session.id),
          archived: session.signals.archived,
          branches: [session.gitBranch ?? '', session.currentBranch ?? ''],
          project: [project.id, project.path, session.projectPath],
          status: primaryStatus(session.signals),
          tags: session.tags ?? [],
          text: [
            session.id,
            session.name,
            session.alias ?? '',
            ...(session.context.models ?? []),
            ...(session.tags ?? []),
          ],
        },
        parsed
      )
    })

    return matchingSessions.length > 0 ? [{ ...project, sessions: matchingSessions }] : []
  })
}

function projectMatchesQuery(project: Project, normalizedQuery: string): boolean {
  return valuesContainQuery([project.id, project.path], normalizedQuery)
}

function sessionMatchesQuery(session: Session, normalizedQuery: string): boolean {
  return valuesContainQuery(
    [
      session.id,
      session.name,
      session.alias,
      session.projectPath,
      session.gitBranch,
      session.currentBranch,
      ...(session.context.models ?? []),
      ...(session.tags ?? []),
    ],
    normalizedQuery
  )
}

function valuesContainQuery(
  values: Array<string | null | undefined>,
  normalizedQuery: string
): boolean {
  return values.some((value) => (value ?? '').toLowerCase().includes(normalizedQuery))
}
