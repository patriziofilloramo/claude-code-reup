import { getActiveSessions } from '../core/session/active-sessions.js'
import { loadProjects } from '../core/project/project-discovery.js'
import { filterProjectsByOrg } from '../core/org/org-filters.js'
import type { OrgProjectFilter } from '../core/org/org-filters.js'
import { emptyOrgData, readOrgData } from '../core/org/org-prefs.js'
import type { OrgData } from '../core/org/org-model.js'
import type {
  Project,
  Session,
  SessionContextMetrics,
  SessionSignals,
  SessionStatus,
} from '../core/session/session-model.js'
import { primaryStatus } from '../core/session/session-signals.js'
import { isResumeVisibleSession } from '../core/session/session-visibility.js'
import { relativeTime } from '../utils/time.js'
import { failCommand, writeStyledOutput } from './output.js'
import {
  SESSION_ACTIVE_MARKER,
  SESSION_IDLE_MARKER,
  compactRelativeTimeLabel,
  formatSingleLineRow,
  padVisibleEnd,
  sanitizeTerminalField,
  terminalWidthOrDefault,
  truncateVisible,
  visibleLength,
} from './terminal-text.js'

export const SESSION_LIST_SCHEMA_VERSION = 2

const VALID_STATUSES = new Set<SessionStatus>([
  'ok',
  'interrupted',
  'expiring',
  'path-missing',
  'heavily-compacted',
])
const ANSI_RESET = '\u001b[0m'
const ANSI_COLORS: Record<string, string> = {
  '32': '\u001b[32m',
  '90': '\u001b[90m',
}
const LIST_TABLE_MIN_SESSION_WIDTH = 18
const LIST_PROJECT_MIN_WIDTH = 10
const LIST_PROJECT_MAX_WIDTH = 24
const LIST_COMPACT_PROJECT_MIN_WIDTH = 72
const LIST_COMPACT_UPDATED_MIN_WIDTH = 56

export interface ListOptions {
  activeOnly: boolean
  archivedOnly: boolean
  attentionOnly: boolean
  group?: string
  json: boolean
  limit?: number
  projectQuery?: string
  query?: string
  stack?: string
  status?: SessionStatus
  tag?: string
}

export interface ListedSession {
  active: boolean
  alias?: string
  context: SessionContextMetrics
  created: string
  currentBranch?: string
  gitBranch?: string
  group?: string
  groupName?: string
  id: string
  messageCount: number
  name: string
  primaryStatus: SessionStatus
  projectId: string
  projectName: string
  projectPath: string
  projectTags?: string[]
  signals: SessionSignals
  tags?: string[]
  updated: string
}

export interface SessionListDocument {
  generatedAt: string
  schemaVersion: typeof SESSION_LIST_SCHEMA_VERSION
  sessions: ListedSession[]
}

export type ListOptionResult = { options: ListOptions } | { error: string }

/** Parses list filters without coupling them to process-global CLI state. */
export function parseListOptions(commandArguments: string[]): ListOptionResult {
  const options: ListOptions = {
    activeOnly: false,
    archivedOnly: false,
    attentionOnly: false,
    json: false,
  }
  const queryParts: string[] = []

  for (let index = 0; index < commandArguments.length; index++) {
    const argument = commandArguments[index]

    switch (argument) {
      case '--json':
        options.json = true
        break
      case '--active':
        options.activeOnly = true
        break
      case '--attention':
        options.attentionOnly = true
        break
      case '--archived':
        options.archivedOnly = true
        break
      case '--project': {
        const value = commandArguments[++index]
        if (!value) return { error: '--project requires a value' }
        options.projectQuery = value
        break
      }
      case '--status': {
        const value = commandArguments[++index]
        if (!value || !VALID_STATUSES.has(value as SessionStatus)) {
          return { error: `--status must be one of: ${[...VALID_STATUSES].join(', ')}` }
        }
        options.status = value as SessionStatus
        break
      }
      case '--limit': {
        const value = commandArguments[++index]
        const limit = Number(value)
        if (!Number.isSafeInteger(limit) || limit <= 0) {
          return { error: '--limit requires a positive integer' }
        }
        options.limit = limit
        break
      }
      case '--tag': {
        const value = commandArguments[++index]
        if (!value) return { error: '--tag requires a value' }
        options.tag = value
        break
      }
      case '--group': {
        const value = commandArguments[++index]
        if (!value) return { error: '--group requires a value' }
        options.group = value
        break
      }
      case '--stack': {
        const value = commandArguments[++index]
        if (!value) return { error: '--stack requires a value' }
        options.stack = value
        break
      }
      default:
        if (argument.startsWith('-')) return { error: `unknown list option: ${argument}` }
        queryParts.push(argument)
    }
  }

  if (queryParts.length > 0) options.query = queryParts.join(' ')
  return { options }
}

/** Runs the human or JSON list view through one shared filtering pipeline. */
export async function runListCommand(commandArguments: string[]): Promise<void> {
  const parsedOptions = parseListOptions(commandArguments)
  if ('error' in parsedOptions) {
    failCommand(`${parsedOptions.error}\nUsage: reup list [query] [options]`)
    return
  }

  const { options } = parsedOptions
  const needsOrgFilter =
    options.tag !== undefined || options.group !== undefined || options.stack !== undefined

  const [projects, activeSessionIds, orgData] = await Promise.all([
    loadProjects(),
    getActiveSessions(),
    needsOrgFilter ? readOrgData() : Promise.resolve(emptyOrgData()),
  ])

  let projectsToList = projects
  if (needsOrgFilter) {
    const filterResult = resolveOrgFilter(orgData, options)
    if ('error' in filterResult) {
      failCommand(filterResult.error)
      return
    }
    projectsToList = filterProjectsByOrg(projects, orgData, filterResult.filter)
  }

  const allSessions = createListedSessions(projects, activeSessionIds)
  const baseSessions =
    projectsToList === projects
      ? allSessions
      : createListedSessions(projectsToList, activeSessionIds)
  const visibleSessions = filterListedSessions(baseSessions, options)

  if (options.json) {
    console.log(JSON.stringify(createSessionListDocument(visibleSessions), null, 2))
    return
  }
  writeStyledOutput(
    formatSessionTable(
      visibleSessions,
      process.stdout.isTTY === true,
      allSessions,
      process.stdout.columns
    )
  )
}

/**
 * Resolves org filter names (group name, stack name, tag) into an OrgProjectFilter
 * ready for filterProjectsByOrg. At most one of group/stack/tag may be active at a time;
 * priority order: group → stack → tag.
 */
export function resolveOrgFilter(
  orgData: OrgData,
  options: Pick<ListOptions, 'group' | 'stack' | 'tag'>
): { filter: OrgProjectFilter } | { error: string } {
  if (options.group !== undefined) {
    const query = options.group.toLowerCase()
    const matches = orgData.groups.filter((g) => g.name.toLowerCase().includes(query))
    if (matches.length === 0) return { error: `no group matching "${options.group}"` }
    if (matches.length > 1) {
      const names = matches.map((g) => g.name).join(', ')
      return {
        error: `"${options.group}" matches multiple groups: ${names} — be more specific`,
      }
    }
    return { filter: { groupId: matches[0]!.id } }
  }
  if (options.stack !== undefined) {
    const query = options.stack.toLowerCase()
    const matches = orgData.stacks.filter((s) => s.name.toLowerCase().includes(query))
    if (matches.length === 0) return { error: `no stack matching "${options.stack}"` }
    if (matches.length > 1) {
      const names = matches.map((s) => s.name).join(', ')
      return {
        error: `"${options.stack}" matches multiple stacks: ${names} — be more specific`,
      }
    }
    return { filter: { stackId: matches[0]!.id } }
  }
  if (options.tag !== undefined) {
    return { filter: { tag: options.tag.toLowerCase() } }
  }
  return { filter: {} }
}

/** Builds a stable JSON document from an already selected set of sessions. */
export function createSessionListDocument(
  sessions: ListedSession[],
  generatedAt = new Date().toISOString()
): SessionListDocument {
  return { generatedAt, schemaVersion: SESSION_LIST_SCHEMA_VERSION, sessions }
}

/** Flattens projects into self-contained rows shared by human and JSON output. */
export function createListedSessions(
  projects: Project[],
  activeSessionIds: ReadonlySet<string>
): ListedSession[] {
  return projects.flatMap((project) =>
    project.sessions
      .filter(isResumeVisibleSession)
      .map((session) => serializeListedSession(project, session, activeSessionIds))
  )
}

/** Applies all list filters with AND semantics while excluding archived sessions by default. */
export function filterListedSessions(
  sessions: ListedSession[],
  options: ListOptions
): ListedSession[] {
  const query = options.query?.toLowerCase()
  const projectQuery = options.projectQuery?.toLowerCase()

  const filtered = sessions.filter((session) => {
    if (options.archivedOnly ? !session.signals.archived : session.signals.archived) return false
    if (options.activeOnly && !session.active) return false
    if (options.attentionOnly && session.primaryStatus === 'ok') return false
    if (options.status && session.primaryStatus !== options.status) return false
    if (projectQuery && !projectValues(session).some((value) => value.includes(projectQuery))) {
      return false
    }
    return !query || searchableValues(session).some((value) => value.includes(query))
  })

  return options.limit ? filtered.slice(0, options.limit) : filtered
}

/** Formats a compact table that remains meaningful without ANSI colour. */
export function formatSessionTable(
  sessions: ListedSession[],
  useColor = false,
  allSessions = sessions,
  terminalWidth?: number
): string {
  if (sessions.length === 0) return 'No sessions match.'

  const rows = sessions.map((session) => ({
    id: shortestUniqueIdPrefix(session.id, allSessions),
    project: sanitizeTerminalField(session.projectName),
    session: sanitizeTerminalField(session.alias ?? session.name),
    state: session.active
      ? colorize(SESSION_ACTIVE_MARKER, '32', useColor)
      : colorize(SESSION_IDLE_MARKER, '90', useColor),
    updated: compactRelativeTimeLabel(relativeTime(session.updated)),
  }))
  const width = terminalWidthOrDefault(terminalWidth)
  const widths = sessionTableWidths(rows, width)
  if (widths === null) return rows.map((row) => formatCompactSessionRow(row, width)).join('\n')

  const header = formatSessionTableRow(
    {
      id: 'ID',
      project: 'PROJECT',
      session: 'SESSION',
      state: 'S',
      updated: 'WHEN',
    },
    widths
  )
  return [header, ...rows.map((row) => formatSessionTableRow(row, widths))].join('\n')
}

/** Returns the shortest globally unambiguous prefix, with a readable minimum. */
export function shortestUniqueIdPrefix(sessionId: string, sessions: ListedSession[]): string {
  const normalizedId = sessionId.toLowerCase()

  for (let length = 8; length < sessionId.length; length++) {
    const prefix = normalizedId.slice(0, length)
    const matchCount = sessions.filter((session) =>
      session.id.toLowerCase().startsWith(prefix)
    ).length
    if (matchCount === 1) return sessionId.slice(0, length)
  }
  return sessionId
}

function serializeListedSession(
  project: Project,
  session: Session,
  activeSessionIds: ReadonlySet<string>
): ListedSession {
  return {
    active: activeSessionIds.has(session.id),
    ...(session.alias ? { alias: session.alias } : {}),
    context: session.context,
    created: session.created,
    ...(session.currentBranch ? { currentBranch: session.currentBranch } : {}),
    ...(session.gitBranch ? { gitBranch: session.gitBranch } : {}),
    ...(project.group ? { group: project.group } : {}),
    ...(project.groupName ? { groupName: project.groupName } : {}),
    id: session.id,
    messageCount: session.messageCount,
    name: session.name,
    primaryStatus: primaryStatus(session.signals),
    projectId: project.id,
    projectName: displayNameFromPath(project.path),
    projectPath: session.projectPath,
    ...(project.projectTags?.length ? { projectTags: project.projectTags } : {}),
    signals: session.signals,
    ...(session.tags?.length ? { tags: session.tags } : {}),
    updated: session.updated,
  }
}

function searchableValues(session: ListedSession): string[] {
  return [
    session.id,
    session.name,
    session.alias ?? '',
    session.gitBranch ?? '',
    session.currentBranch ?? '',
    session.primaryStatus,
    ...(session.context.models ?? []),
    ...projectValues(session),
  ].map((value) => value.toLowerCase())
}

function projectValues(session: ListedSession): string[] {
  return [session.projectId, session.projectName, session.projectPath].map((value) =>
    value.toLowerCase()
  )
}

function displayNameFromPath(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).pop() ?? path
}

function colorize(value: string, ansiColor: string, enabled: boolean): string {
  return enabled ? `${ANSI_COLORS[ansiColor] ?? ''}${value}${ANSI_RESET}` : value
}

function sessionTableWidths(
  rows: Array<{ id: string; project: string; session: string; state: string; updated: string }>,
  width: number
): { id: number; project: number; session: number; state: number; updated: number } | null {
  const state = 1
  const id = Math.max(2, ...rows.map((row) => visibleLength(row.id)))
  const updated = Math.max(4, ...rows.map((row) => visibleLength(row.updated)))
  const naturalProject = Math.min(
    LIST_PROJECT_MAX_WIDTH,
    Math.max(7, ...rows.map((row) => visibleLength(row.project)))
  )
  const naturalSession = Math.max(
    LIST_TABLE_MIN_SESSION_WIDTH,
    ...rows.map((row) => visibleLength(row.session))
  )
  const separators = 2 * 4
  const fixedWithoutProject = state + id + updated + separators
  let project = naturalProject
  let sessionBudget = width - fixedWithoutProject - project

  if (sessionBudget < LIST_TABLE_MIN_SESSION_WIDTH) {
    const reclaimed = LIST_TABLE_MIN_SESSION_WIDTH - sessionBudget
    project = Math.max(LIST_PROJECT_MIN_WIDTH, project - reclaimed)
    sessionBudget = width - fixedWithoutProject - project
  }
  if (sessionBudget < LIST_TABLE_MIN_SESSION_WIDTH) return null
  // Cap at content width so short tables do not stretch to the full terminal.
  return { id, project, session: Math.min(sessionBudget, naturalSession), state, updated }
}

function formatSessionTableRow(
  row: { id: string; project: string; session: string; state: string; updated: string },
  widths: { id: number; project: number; session: number; state: number; updated: number }
): string {
  // The last column stays unpadded so rows carry no trailing whitespace.
  return [
    padVisibleEnd(truncateVisible(row.state, widths.state), widths.state),
    padVisibleEnd(truncateVisible(row.project, widths.project), widths.project),
    padVisibleEnd(truncateVisible(row.session, widths.session), widths.session),
    padVisibleEnd(truncateVisible(row.updated, widths.updated), widths.updated),
    truncateVisible(row.id, widths.id),
  ].join('  ')
}

function formatCompactSessionRow(
  row: { id: string; project: string; session: string; state: string; updated: string },
  width: number
): string {
  return formatSingleLineRow({
    coreParts: [row.id],
    metadataParts: [
      width >= LIST_COMPACT_UPDATED_MIN_WIDTH ? row.updated : '',
      width >= LIST_COMPACT_PROJECT_MIN_WIDTH ? row.project : '',
    ],
    prefix: `${row.state} `,
    primary: row.session,
    primaryMaxWidth: compactSessionPrimaryWidth(width),
    primaryMinWidth: LIST_TABLE_MIN_SESSION_WIDTH,
    width,
  })
}

function compactSessionPrimaryWidth(width: number): number {
  if (width >= LIST_COMPACT_PROJECT_MIN_WIDTH) return 36
  if (width >= LIST_COMPACT_UPDATED_MIN_WIDTH) return 32
  return 28
}
