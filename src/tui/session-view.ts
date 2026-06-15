import type { Project, Session } from '../core/session-model.js'
import { primaryStatus } from '../core/session-signals.js'

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

interface ParsedQuery {
  branchTerms: string[]
  filterActive: boolean
  filterArchived: boolean
  projectTerms: string[]
  statusTerms: string[]
  text: string
}

function parseSearchQuery(searchQuery: string): ParsedQuery {
  const parts = searchQuery.trim().split(/\s+/).filter(Boolean)
  const result: ParsedQuery = {
    branchTerms: [],
    filterActive: false,
    filterArchived: false,
    projectTerms: [],
    statusTerms: [],
    text: '',
  }
  const textParts: string[] = []

  for (const part of parts) {
    const lower = part.toLowerCase()
    if (lower === 'is:active') {
      result.filterActive = true
    } else if (lower === 'is:archived') {
      result.filterArchived = true
    } else if (lower.startsWith('project:')) {
      result.projectTerms.push(lower.slice(8))
    } else if (lower.startsWith('branch:')) {
      result.branchTerms.push(lower.slice(7))
    } else if (lower.startsWith('status:')) {
      result.statusTerms.push(lower.slice(7))
    } else {
      textParts.push(lower)
    }
  }
  result.text = textParts.join(' ')
  return result
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
  const parsed = parseSearchQuery(searchQuery)
  const showArchived = showArchivedSessions || parsed.filterArchived
  const hasQualifiers =
    parsed.filterActive ||
    parsed.filterArchived ||
    parsed.projectTerms.length > 0 ||
    parsed.branchTerms.length > 0 ||
    parsed.statusTerms.length > 0

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
      // Text must match project or session
      if (parsed.text) {
        if (
          !projectMatchesQuery(project, parsed.text) &&
          !sessionMatchesQuery(session, parsed.text)
        )
          return false
      }
      if (parsed.filterActive && !activeSessionIds.has(session.id)) return false
      if (parsed.filterArchived && !session.signals.archived) return false
      if (parsed.branchTerms.length > 0) {
        const branch = (
          (session.gitBranch ?? '') +
          ' ' +
          (session.currentBranch ?? '')
        ).toLowerCase()
        if (!parsed.branchTerms.some((t) => branch.includes(t))) return false
      }
      if (parsed.statusTerms.length > 0) {
        const status = primaryStatus(session.signals)
        if (!parsed.statusTerms.some((t) => status.includes(t))) return false
      }
      return true
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
