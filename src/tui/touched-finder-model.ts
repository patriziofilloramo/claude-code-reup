import type { TouchedFileMatch, TouchedFileSummary } from '../core/session/session-file-search.js'
import { relativeTime } from '../utils/time.js'

// ---------------------------------------------------------------------------
// Pure presentation logic for the touched-file finder (no Ink dependency).
// ---------------------------------------------------------------------------

/** Filters touched files by a case-insensitive substring of their path. */
export function filterTouchedFiles(
  files: TouchedFileSummary[],
  query: string
): TouchedFileSummary[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return files
  return files.filter((file) => file.path.toLowerCase().includes(normalized))
}

export interface TouchedSessionRow {
  active: boolean
  branch: string | null
  matchCount: number
  project: string
  session: string
  when: string
}

/** Maps reverse-lookup matches to display rows, preserving the engine's order. */
export function buildTouchedSessionRows(
  matches: TouchedFileMatch[],
  activeSessionIds: ReadonlySet<string>
): TouchedSessionRow[] {
  return matches.map((match) => ({
    active: activeSessionIds.has(match.session.id),
    branch: match.gitBranch ?? match.session.gitBranch ?? match.session.currentBranch ?? null,
    matchCount: match.matchCount,
    project: match.project.path.split(/[/\\]/).filter(Boolean).pop() ?? match.project.path,
    session: match.session.alias ?? match.session.name,
    when: relativeTime(match.lastTouchedAt ?? match.session.updated),
  }))
}
