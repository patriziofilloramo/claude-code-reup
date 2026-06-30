import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'

import type { Project, Session } from './session-model.js'
import { sessionTranscriptPath } from './session-preview.js'
import { extractWriteToolPaths, isWriteLikeTool } from './session-touched-files.js'
import { isResumeListVisibleSession } from './session-visibility.js'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface TouchedFileMatch {
  project: Project
  session: Session
  /** Distinct paths this session wrote that match the query, most-recent first. */
  matchedPaths: string[]
  /** Number of write events that matched — the relevance score. */
  matchCount: number
  /** ISO timestamp of the most recent matching write, or null when unrecorded. */
  lastTouchedAt: string | null
  /** Git branch active at that most recent matching write, or null when unknown. */
  gitBranch: string | null
}

export interface SearchTouchedFilesOptions {
  includeArchived?: boolean
  onProgress?: (scanned: number, total: number) => void
}

/** A single write to a path, with the facts the transcript recorded about it. */
interface TouchedEntry {
  path: string
  /** ISO timestamp of the write event, or null when the event carried none. */
  timestamp: string | null
  /** Git branch active when the file was written, or null when unknown. */
  gitBranch: string | null
}

/** The most recent moment and branch among a set of matching writes. */
interface LatestTouch {
  lastTouchedAt: string | null
  gitBranch: string | null
}

// ---------------------------------------------------------------------------
// Reverse lookup: which sessions wrote a file matching the query?
// ---------------------------------------------------------------------------

const MAX_MATCHED_PATHS = 16

/**
 * Finds every session whose transcript records a write to a path matching the
 * query. Mirrors searchTranscripts: streams each JSONL file line-by-line and
 * never loads a whole transcript into memory. Results are sorted by match count
 * descending.
 *
 * This reads only immutable facts Claude Code already recorded (tool_use write
 * events), so a match is never wrong; an unreadable transcript degrades to zero
 * matches rather than failing the whole search.
 */
export async function searchTouchedFiles(
  pathQuery: string,
  projects: Project[],
  options: SearchTouchedFilesOptions = {}
): Promise<TouchedFileMatch[]> {
  const queryKey = pathMatchKey(pathQuery)
  if (!queryKey) return []

  const pairs: Array<{ project: Project; session: Session }> = []
  for (const project of projects) {
    for (const session of project.sessions) {
      if (!isResumeListVisibleSession(session, { includeArchived: options.includeArchived }))
        continue
      pairs.push({ project, session })
    }
  }

  const total = pairs.length
  let scanned = 0
  const results: TouchedFileMatch[] = []

  for (const { project, session } of pairs) {
    const transcriptPath = sessionTranscriptPath(project.id, session.id)
    const match = await scanTranscriptForTouched(transcriptPath, queryKey)
    scanned++
    options.onProgress?.(scanned, total)
    if (match.matchCount > 0) results.push({ project, session, ...match })
  }

  // Match count is the primary relevance signal; ties break toward the most
  // recent touch, then the most recently active session, so "who edited this
  // file" never depends on filesystem discovery order.
  return results.sort(
    (a, b) =>
      b.matchCount - a.matchCount ||
      compareIsoDescending(a.lastTouchedAt, b.lastTouchedAt) ||
      compareIsoDescending(a.session.updated, b.session.updated)
  )
}

// ---------------------------------------------------------------------------
// Aggregation: which files has a project touched?
// ---------------------------------------------------------------------------

export interface TouchedFileSummary {
  /** Absolute path of a file written in at least one of the projects' sessions. */
  path: string
  /** Number of sessions that wrote this file. */
  sessionCount: number
  /** ISO timestamp of the most recent write to this file. */
  lastTouchedAt: string
  /** Git branch active at that most recent write, or null when unknown. */
  gitBranch: string | null
}

interface TouchedFileAccumulator {
  path: string
  sessions: Set<string>
  lastTouchedAt: string
  gitBranch: string | null
}

/**
 * Aggregates every file written across the given projects' sessions, most
 * recently touched first. Each file carries the exact timestamp and branch of
 * its most recent write, read straight from the recorded events.
 */
export async function collectTouchedFiles(
  projects: Project[],
  options: { includeArchived?: boolean } = {}
): Promise<TouchedFileSummary[]> {
  const byPath = new Map<string, TouchedFileAccumulator>()

  for (const project of projects) {
    for (const session of project.sessions) {
      if (!isResumeListVisibleSession(session, { includeArchived: options.includeArchived }))
        continue
      const entries = await readTouchedEntries(sessionTranscriptPath(project.id, session.id))
      for (const entry of entries) {
        // The event timestamp is the real moment of the edit; fall back to the
        // session's last activity only when an event recorded none.
        const touchedAt = entry.timestamp ?? session.updated
        // Aggregate by file identity, not exact spelling: the same file can be
        // recorded as src/foo.ts or src\foo.ts (and, on case-insensitive
        // filesystems, with different casing). The display path follows the
        // most recent write so the picker shows the spelling the user last saw.
        const identity = pathIdentityKey(entry.path)
        const existing = byPath.get(identity)
        if (existing) {
          existing.sessions.add(session.id)
          if (touchedAt > existing.lastTouchedAt) {
            existing.lastTouchedAt = touchedAt
            existing.gitBranch = entry.gitBranch ?? existing.gitBranch
            existing.path = entry.path
          }
        } else {
          byPath.set(identity, {
            path: entry.path,
            sessions: new Set([session.id]),
            lastTouchedAt: touchedAt,
            gitBranch: entry.gitBranch,
          })
        }
      }
    }
  }

  return [...byPath.values()]
    .map((entry) => ({
      path: entry.path,
      sessionCount: entry.sessions.size,
      lastTouchedAt: entry.lastTouchedAt,
      gitBranch: entry.gitBranch,
    }))
    .sort((a, b) => b.lastTouchedAt.localeCompare(a.lastTouchedAt) || a.path.localeCompare(b.path))
}

/** Streams a transcript and returns every write it recorded, with its facts. */
async function readTouchedEntries(filePath: string): Promise<TouchedEntry[]> {
  const entries: TouchedEntry[] = []
  try {
    const rl = createInterface({
      input: createReadStream(filePath, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    })
    for await (const line of rl) {
      entries.push(...touchedEntriesFromLine(line))
    }
  } catch {
    // Unreadable or missing transcript — contributes no files.
  }
  return entries
}

// ---------------------------------------------------------------------------
// File scanning
// ---------------------------------------------------------------------------

async function scanTranscriptForTouched(
  filePath: string,
  queryKey: string
): Promise<{ matchedPaths: string[]; matchCount: number } & LatestTouch> {
  const matchedSequence: string[] = []
  let matchCount = 0
  let lastTouchedAt: string | null = null
  let gitBranch: string | null = null

  try {
    const rl = createInterface({
      input: createReadStream(filePath, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    })

    for await (const line of rl) {
      // Cheap pre-filter: the path is embedded verbatim in the line, so a line
      // that cannot contain the query after normalization cannot match.
      if (!pathMatchKey(line).includes(queryKey)) continue

      for (const entry of touchedEntriesFromLine(line)) {
        if (!pathMatchKey(entry.path).includes(queryKey)) continue
        matchCount++
        matchedSequence.push(entry.path)
        if (entry.timestamp && (lastTouchedAt === null || entry.timestamp > lastTouchedAt)) {
          lastTouchedAt = entry.timestamp
          gitBranch = entry.gitBranch
        }
      }
    }
  } catch {
    // Unreadable or missing transcript — treat as zero matches.
  }

  return {
    matchedPaths: deduplicateTail(matchedSequence, MAX_MATCHED_PATHS),
    matchCount,
    lastTouchedAt,
    gitBranch,
  }
}

// ---------------------------------------------------------------------------
// Extraction (pure — testable without filesystem)
// ---------------------------------------------------------------------------

/**
 * Extracts every write-target path from transcript JSONL lines, in occurrence
 * order. Pure counterpart of the streaming scanner, exposed for testing.
 */
export function extractTouchedPathsFromLines(lines: string[]): string[] {
  return lines.flatMap((line) => touchedEntriesFromLine(line).map((entry) => entry.path))
}

function touchedEntriesFromLine(line: string): TouchedEntry[] {
  let event: Record<string, unknown>
  try {
    event = JSON.parse(line) as Record<string, unknown>
  } catch {
    return []
  }

  if (event['type'] !== 'assistant') return []
  const content = (event['message'] as Record<string, unknown> | undefined)?.['content']
  if (!Array.isArray(content)) return []

  const timestamp = typeof event['timestamp'] === 'string' ? event['timestamp'] : null
  const gitBranch =
    typeof event['gitBranch'] === 'string' && event['gitBranch'].length > 0
      ? event['gitBranch']
      : null

  const entries: TouchedEntry[] = []
  for (const block of content as Record<string, unknown>[]) {
    if (block['type'] !== 'tool_use') continue
    const name = block['name']
    if (typeof name !== 'string' || !isWriteLikeTool(name.toLowerCase())) continue
    const input = block['input']
    for (const path of extractWriteToolPaths(isRecord(input) ? input : null)) {
      entries.push({ path, timestamp, gitBranch })
    }
  }
  return entries
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds a separator- and case-insensitive key for matching a path fragment.
 *
 * Path separators are removed entirely rather than normalized, because shells
 * frequently strip or escape backslashes before the argument reaches the CLI
 * (an unquoted Windows path like `P:\dir\file` arrives as `P:dirfile`). Dropping
 * every separator on both sides lets `web/ui.html`, `web\ui.html`, and the
 * shell-mangled `webui.html` all match the same recorded path.
 */
export function pathMatchKey(value: string): string {
  return value
    .replace(/[\\/]+/g, '')
    .toLowerCase()
    .trim()
}

/**
 * Whether the host filesystem treats paths case-insensitively. Windows and
 * macOS do by default; Linux does not, where Foo.ts and foo.ts are genuinely
 * distinct files that must not aggregate into one.
 */
const FILESYSTEM_IS_CASE_INSENSITIVE = process.platform === 'win32' || process.platform === 'darwin'

/**
 * Identity key for aggregating writes to the same file. Unlike pathMatchKey it
 * preserves separators (collapsed to a single forward slash) so structurally
 * distinct paths never merge. Separator style is always folded away — it is a
 * notation difference, not an identity one — but case is folded only on
 * filesystems that are themselves case-insensitive, so two genuinely different
 * files on Linux stay separate while the same file recorded with different
 * casing on Windows/macOS aggregates as one.
 */
export function pathIdentityKey(path: string): string {
  const separatorNormalized = path.replace(/[\\/]+/g, '/')
  return FILESYSTEM_IS_CASE_INSENSITIVE ? separatorNormalized.toLowerCase() : separatorNormalized
}

/** Descending ISO-timestamp comparison; a missing timestamp sorts last. */
function compareIsoDescending(left: string | null, right: string | null): number {
  if (left === right) return 0
  if (left === null) return 1
  if (right === null) return -1
  return right.localeCompare(left)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Up to `max` unique items, keeping the most recent occurrence of each first. */
function deduplicateTail(items: string[], max: number): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (let i = items.length - 1; i >= 0 && result.length < max; i--) {
    const item = items[i]
    if (item && !seen.has(item)) {
      seen.add(item)
      result.push(item)
    }
  }
  return result
}
