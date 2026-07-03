import { spawnSync } from 'node:child_process'

import { getActiveSessions } from '../core/session/active-sessions.js'
import { loadProjects } from '../core/project/project-discovery.js'
import {
  collectTouchedFiles,
  pathMatchKey,
  searchTouchedFiles,
  type TouchedFileMatch,
} from '../core/session/session-file-search.js'
import type { Project } from '../core/session/session-model.js'
import { rankSessionCandidates, type RankedSession } from '../core/session/session-ranking.js'
import { releaseTerminalInput } from '../tui/terminal-input.js'
import { log } from '../utils/logger.js'
import { readCurrentWorkingDirectory } from '../utils/process.js'
import { relativeTime } from '../utils/time.js'
import { failCommand, writeOutput } from './output.js'
import {
  SESSION_ACTIVE_MARKER,
  SESSION_IDLE_MARKER,
  compactRelativeTimeLabel,
  formatSingleLineRow,
  padVisibleEnd,
  terminalWidthOrDefault,
  truncateVisible,
  truncateVisibleStart,
  visibleLength,
} from './terminal-text.js'

export const TOUCHED_SCHEMA_VERSION = 1

export interface TouchedOptions {
  query: string
  json: boolean
  includeArchived: boolean
  limit?: number
}

export interface TouchedResult {
  active: boolean
  gitBranch: string | null
  /** Real moment this session last touched the matched file (ISO). */
  lastTouchedAt: string
  matchCount: number
  matchedPaths: string[]
  projectId: string
  projectName: string
  projectPath: string
  sessionId: string
  sessionName: string
}

export interface TouchedResultDocument {
  generatedAt: string
  query: string
  results: TouchedResult[]
  schemaVersion: typeof TOUCHED_SCHEMA_VERSION
}

export type TouchedOptionResult = { options: TouchedOptions } | { error: string }

const USAGE = 'usage: reup touched [path] [--json] [--archived] [--limit <count>]'
const TOUCHED_TABLE_MIN_SESSION_WIDTH = 16
const TOUCHED_TABLE_MIN_TOUCHED_WIDTH = 12
const TOUCHED_PROJECT_MAX_WIDTH = 18
const TOUCHED_BRANCH_MAX_WIDTH = 18
const TOUCHED_PATH_MAX_WIDTH = 40
const TOUCHED_COMPACT_PATH_MIN_WIDTH = 64
const TOUCHED_COMPACT_PROJECT_MIN_WIDTH = 80
const TOUCHED_COMPACT_BRANCH_MIN_WIDTH = 96
const TOUCHED_COMPACT_WHEN_MIN_WIDTH = 56

/** Parses `reup touched` arguments without touching process-global state. */
export function parseTouchedOptions(commandArguments: string[]): TouchedOptionResult {
  const options: TouchedOptions = { query: '', json: false, includeArchived: false }
  const queryParts: string[] = []

  for (let index = 0; index < commandArguments.length; index++) {
    const argument = commandArguments[index]!
    switch (argument) {
      case '--json':
        options.json = true
        break
      case '--archived':
        options.includeArchived = true
        break
      case '--limit': {
        const value = commandArguments[++index]
        const limit = Number(value)
        if (!Number.isSafeInteger(limit) || limit <= 0) {
          return { error: '--limit requires a positive integer' }
        }
        options.limit = limit
        break
      }
      default:
        if (argument.startsWith('-')) return { error: `unknown touched option: ${argument}` }
        queryParts.push(argument)
    }
  }

  options.query = queryParts.join(' ').trim()
  // The no-path form opens the interactive picker, where machine-output and
  // result-capping flags have no meaning. Reject them rather than silently
  // accepting a flag that does nothing.
  if (!options.query) {
    if (options.json) return { error: '--json requires a path' }
    if (options.limit !== undefined) return { error: '--limit requires a path' }
  }
  return { options }
}

/**
 * Lists sessions that wrote a file matching the query. With no path, opens an
 * interactive picker of the current project's touched files and resumes the
 * session behind the chosen one.
 */
export async function runTouchedCommand(commandArguments: string[]): Promise<void> {
  const parsed = parseTouchedOptions(commandArguments)
  if ('error' in parsed) {
    failCommand(`${parsed.error}\n${USAGE}`)
    return
  }

  const { options } = parsed
  if (!options.query) {
    await runInteractiveTouched(options.includeArchived)
    return
  }

  const [projects, activeSessionIds] = await Promise.all([loadProjects(), getActiveSessions()])
  const matches = await searchTouchedFiles(options.query, projects, {
    includeArchived: options.includeArchived,
  })
  const limited = options.limit ? matches.slice(0, options.limit) : matches
  const results = limited.map((match) => toTouchedResult(match, activeSessionIds))

  if (options.json) {
    console.log(JSON.stringify(createTouchedDocument(options.query, results), null, 2))
    return
  }
  writeOutput(formatTouchedTable(options.query, results, process.stdout.columns))
}

// ---------------------------------------------------------------------------
// Interactive picker flow (no path given)
// ---------------------------------------------------------------------------

async function runInteractiveTouched(includeArchived: boolean): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    failCommand(`a path is required outside an interactive terminal\n${USAGE}`)
    return
  }

  try {
    const currentDirectory = readCurrentWorkingDirectory()
    const [projects, activeSessionIds] = await Promise.all([loadProjects(), getActiveSessions()])
    const candidates = rankSessionCandidates(projects, activeSessionIds, currentDirectory)
    const currentProjects = uniqueProjects(
      candidates.filter((candidate) => candidate.inCurrentDirectory).map((c) => c.project)
    )
    if (currentProjects.length === 0) {
      failCommand('run reup touched inside a project directory, or pass a path to look up')
      return
    }

    const files = await collectTouchedFiles(currentProjects, { includeArchived })
    if (files.length === 0) {
      writeOutput('No touched files recorded for the current project.')
      return
    }

    const { runTouchedFilePicker } = await import('../tui/TouchedFilePicker.js')
    const selectedPath = await runTouchedFilePicker(files, currentProjects[0]!.path)
    releaseTerminalInput()
    if (!selectedPath) return

    const matches = await searchTouchedFiles(selectedPath, currentProjects, { includeArchived })
    const sessionCandidates = orderCandidatesByMatch(matches, candidates)
    if (sessionCandidates.length === 0) return

    const { runResumePicker } = await import('../tui/ResumePicker.js')
    const selection = await runResumePicker(sessionCandidates, currentDirectory)
    releaseTerminalInput()
    if (!selection) return

    launchClaude(selection.projectPath, selection.sessionId)
  } catch (error) {
    log.debug('touched: interactive flow failed:', error)
    failCommand('touched failed — run with REUP_DEBUG=1 for details')
  }
}

/**
 * Reorders resume candidates to follow the reverse-lookup relevance order
 * (match count, then most recent touch). Candidates without a match are
 * dropped, and matches without a candidate are skipped, so the picker shows
 * exactly the sessions that touched the file, most relevant first.
 */
export function orderCandidatesByMatch(
  matches: TouchedFileMatch[],
  candidates: RankedSession[]
): RankedSession[] {
  const candidateById = new Map(candidates.map((candidate) => [candidate.session.id, candidate]))
  const ordered: RankedSession[] = []
  for (const match of matches) {
    const candidate = candidateById.get(match.session.id)
    if (candidate) ordered.push(candidate)
  }
  return ordered
}

function uniqueProjects(projects: Project[]): Project[] {
  const seen = new Set<string>()
  const result: Project[] = []
  for (const project of projects) {
    if (seen.has(project.id)) continue
    seen.add(project.id)
    result.push(project)
  }
  return result
}

function launchClaude(projectPath: string | undefined, sessionId: string): void {
  if (projectPath) {
    try {
      process.chdir(projectPath)
    } catch (error) {
      log.debug('touched: failed to change working directory:', error)
    }
  }
  const result = spawnSync('claude', ['--resume', sessionId], {
    shell: process.platform === 'win32',
    stdio: 'inherit',
  })
  if (result.error) failCommand(`failed to launch claude: ${result.error.message}`)
  else if (result.status && result.status !== 0) process.exitCode = result.status
}

// ---------------------------------------------------------------------------
// Non-interactive output (path given)
// ---------------------------------------------------------------------------

/** Builds a stable JSON document from already selected results. */
export function createTouchedDocument(
  query: string,
  results: TouchedResult[],
  generatedAt = new Date().toISOString()
): TouchedResultDocument {
  return { generatedAt, query, results, schemaVersion: TOUCHED_SCHEMA_VERSION }
}

/**
 * Formats a compact table: STATE · PROJECT · SESSION · [TOUCHED] · [BRANCH] · WHEN.
 *
 * It mirrors the no-path file picker — every row carries the real moment of the
 * edit and the branch it happened on. The TOUCHED column appears only when it
 * adds information beyond the query; BRANCH only when a branch was recorded.
 */
export function formatTouchedTable(
  query: string,
  results: TouchedResult[],
  terminalWidth?: number
): string {
  if (results.length === 0) return `No sessions touched a file matching "${query}".`

  const queryKey = pathMatchKey(query)
  const showTouched = results.some(
    (result) =>
      result.matchedPaths.length !== 1 || !pathMatchKey(result.matchedPaths[0]!).endsWith(queryKey)
  )
  const showBranch = results.some((result) => result.gitBranch !== null)

  const rows = results.map((result) => ({
    id: result.sessionId.slice(0, 8),
    state: result.active ? SESSION_ACTIVE_MARKER : SESSION_IDLE_MARKER,
    project: result.projectName,
    session: result.sessionName,
    touched: showTouched ? describeTouched(result) : '',
    branch: showBranch ? (result.gitBranch ?? '') : '',
    when: compactRelativeTimeLabel(relativeTime(result.lastTouchedAt)),
  }))
  const width = terminalWidthOrDefault(terminalWidth)
  const widths = touchedTableWidths(rows, width, showTouched, showBranch)
  if (widths === null) {
    return rows
      .map((row) => formatCompactTouchedRow(row, width, showTouched, showBranch))
      .join('\n')
  }

  const header = formatTouchedRow(
    {
      state: 'S',
      project: 'PROJECT',
      session: 'SESSION',
      touched: 'TOUCHED',
      branch: 'BRANCH',
      when: 'WHEN',
    },
    widths,
    showTouched,
    showBranch
  )
  return [
    header,
    ...rows.map((row) => formatTouchedRow(row, widths, showTouched, showBranch)),
  ].join('\n')
}

function toTouchedResult(
  match: TouchedFileMatch,
  activeSessionIds: ReadonlySet<string>
): TouchedResult {
  return {
    active: activeSessionIds.has(match.session.id),
    gitBranch: match.gitBranch ?? match.session.gitBranch ?? match.session.currentBranch ?? null,
    lastTouchedAt: match.lastTouchedAt ?? match.session.updated,
    matchCount: match.matchCount,
    matchedPaths: match.matchedPaths,
    projectId: match.project.id,
    projectName: displayNameFromPath(match.project.path),
    projectPath: match.project.path,
    sessionId: match.session.id,
    sessionName: match.session.alias ?? match.session.name,
  }
}

function describeTouched(result: TouchedResult): string {
  const primary = result.matchedPaths[0]
  if (!primary) return ''
  const relative = relativeToProject(primary, result.projectPath)
  const extra = result.matchedPaths.length - 1
  return extra > 0 ? `${relative} (+${extra} more)` : relative
}

/** Renders a touched path relative to its project root for compact display. */
function relativeToProject(filePath: string, projectPath: string): string {
  const fileSlash = filePath.replace(/\\/g, '/')
  const projectSlash = projectPath.replace(/\\/g, '/').replace(/\/+$/, '')
  if (projectSlash && fileSlash.toLowerCase().startsWith(`${projectSlash.toLowerCase()}/`)) {
    return fileSlash.slice(projectSlash.length + 1)
  }
  return filePath.split(/[/\\]/).filter(Boolean).pop() ?? filePath
}

function displayNameFromPath(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).pop() ?? path
}

function touchedTableWidths(
  rows: Array<{
    state: string
    id: string
    project: string
    session: string
    touched: string
    branch: string
    when: string
  }>,
  width: number,
  showTouched: boolean,
  showBranch: boolean
): {
  state: number
  project: number
  session: number
  touched: number
  branch: number
  when: number
} | null {
  const state = 1
  const project = Math.min(
    TOUCHED_PROJECT_MAX_WIDTH,
    Math.max(7, ...rows.map((row) => visibleLength(row.project)))
  )
  const branch = showBranch
    ? Math.min(
        TOUCHED_BRANCH_MAX_WIDTH,
        Math.max(6, ...rows.map((row) => visibleLength(row.branch)))
      )
    : 0
  const when = Math.max(4, ...rows.map((row) => visibleLength(row.when)))
  const naturalSession = Math.max(
    TOUCHED_TABLE_MIN_SESSION_WIDTH,
    ...rows.map((row) => visibleLength(row.session))
  )
  const columnCount = 4 + (showTouched ? 1 : 0) + (showBranch ? 1 : 0)
  const separators = 2 * (columnCount - 1)
  const fixed = state + project + branch + when + separators
  let touched = showTouched
    ? Math.min(
        TOUCHED_PATH_MAX_WIDTH,
        Math.max(7, ...rows.map((row) => visibleLength(row.touched)))
      )
    : 0
  let sessionBudget = width - fixed - touched

  if (showTouched && sessionBudget < TOUCHED_TABLE_MIN_SESSION_WIDTH) {
    const reclaimed = TOUCHED_TABLE_MIN_SESSION_WIDTH - sessionBudget
    touched = Math.max(TOUCHED_TABLE_MIN_TOUCHED_WIDTH, touched - reclaimed)
    sessionBudget = width - fixed - touched
  }
  if (sessionBudget < TOUCHED_TABLE_MIN_SESSION_WIDTH) return null
  // Cap at content width so short tables do not stretch to the full terminal.
  return { branch, project, session: Math.min(sessionBudget, naturalSession), state, touched, when }
}

function formatTouchedRow(
  row: {
    state: string
    project: string
    session: string
    touched: string
    branch: string
    when: string
  },
  widths: {
    state: number
    project: number
    session: number
    touched: number
    branch: number
    when: number
  },
  showTouched: boolean,
  showBranch: boolean
): string {
  const cells = [
    padVisibleEnd(truncateVisible(row.state, widths.state), widths.state),
    padVisibleEnd(truncateVisible(row.project, widths.project), widths.project),
    padVisibleEnd(truncateVisible(row.session, widths.session), widths.session),
  ]
  if (showTouched) {
    cells.push(padVisibleEnd(truncateVisibleStart(row.touched, widths.touched), widths.touched))
  }
  if (showBranch) {
    cells.push(padVisibleEnd(truncateVisible(row.branch, widths.branch), widths.branch))
  }
  // The last column stays unpadded so rows carry no trailing whitespace.
  cells.push(truncateVisible(row.when, widths.when))
  return cells.join('  ')
}

function formatCompactTouchedRow(
  row: {
    state: string
    id: string
    project: string
    session: string
    touched: string
    branch: string
    when: string
  },
  width: number,
  showTouched: boolean,
  showBranch: boolean
): string {
  return formatSingleLineRow({
    coreParts: [row.id],
    metadataParts: [
      // Truncate from the start so the filename (the useful tail) survives.
      showTouched && width >= TOUCHED_COMPACT_PATH_MIN_WIDTH
        ? truncateVisibleStart(row.touched, TOUCHED_PATH_MAX_WIDTH)
        : '',
      width >= TOUCHED_COMPACT_PROJECT_MIN_WIDTH ? row.project : '',
      showBranch && width >= TOUCHED_COMPACT_BRANCH_MIN_WIDTH ? row.branch : '',
      width >= TOUCHED_COMPACT_WHEN_MIN_WIDTH ? row.when : '',
    ],
    prefix: `${row.state} `,
    primary: row.session,
    primaryMinWidth: TOUCHED_TABLE_MIN_SESSION_WIDTH,
    width,
  })
}
