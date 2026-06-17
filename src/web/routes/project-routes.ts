import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { Hono } from 'hono'

import { APP } from '../../config/app.js'
import { getActiveSessions } from '../../core/session/active-sessions.js'
import { getClaudeDirectory } from '../../core/project/claude-paths.js'
import { loadProjectById, loadProjects } from '../../core/project/project-discovery.js'
import { formatHandoff, readTranscriptHandoffContext } from '../../core/session/session-handoff.js'
import { isValidSessionId } from '../../core/session/session-model.js'
import type { Project, Session } from '../../core/session/session-model.js'
import { loadSessionPreview, sessionTranscriptPath } from '../../core/session/session-preview.js'
import { filterProjectsByOrg } from '../../core/org/org-filters.js'
import { readOrgData } from '../../core/org/org-prefs.js'
import { log } from '../../utils/logger.js'
import { projectDisplayName, serializeProject, serializeSession } from '../api-model.js'
import type { ApiSession } from '../api-model.js'
import { apiRoute } from './route-helper.js'

/**
 * Registers read-only endpoints for project discovery, session search,
 * transcript access, and active-session detection.
 *
 * All endpoints here are GET-only and safe to call without origin validation —
 * they never mutate filesystem state or launch processes.
 */
export function registerProjectRoutes(app: Hono): void {
  // ---------------------------------------------------------------------------
  // GET /api/projects?group=:id&stack=:id&tag=:tag — full project + session tree
  // ---------------------------------------------------------------------------

  app.get(
    '/api/projects',
    apiRoute(async (context) => {
      const groupId = context.req.query('group')
      const stackId = context.req.query('stack')
      const tag = context.req.query('tag')

      const projects = await loadProjects()

      if (groupId || stackId || tag) {
        const orgData = await readOrgData()
        const filtered = filterProjectsByOrg(projects, orgData, { groupId, stackId, tag })
        return context.json(filtered.map(serializeProject))
      }

      return context.json(projects.map(serializeProject))
    })
  )

  // ---------------------------------------------------------------------------
  // GET /api/search?q=<query>&tag=:tag&group=:id&stack=:id — metadata search
  // Note: deep/transcript search lives in search-route.ts (/api/search/deep).
  // ---------------------------------------------------------------------------

  app.get(
    '/api/search',
    apiRoute(async (context) => {
      const normalizedQuery = (context.req.query('q') ?? '').toLowerCase().trim()
      const groupId = context.req.query('group')
      const stackId = context.req.query('stack')
      const tag = context.req.query('tag')

      if (!normalizedQuery && !groupId && !stackId && !tag) return context.json([])

      const allProjects = await loadProjects()
      let projects = allProjects

      if (groupId || stackId || tag) {
        const orgData = await readOrgData()
        projects = filterProjectsByOrg(projects, orgData, { groupId, stackId, tag })
      }

      const hits: Array<ApiSession & { projectName: string }> = []

      for (const project of projects) {
        const projectName = projectDisplayName(project)
        for (const session of project.sessions) {
          if (
            normalizedQuery &&
            !sessionMatchesQuery(session, project, projectName, normalizedQuery)
          ) {
            continue
          }
          hits.push({ ...serializeSession(session), projectName })
          if (hits.length >= APP.maxSearchResults) return context.json(hits)
        }
      }

      return context.json(hits)
    })
  )

  // ---------------------------------------------------------------------------
  // GET /api/sessions/:projectId/:sessionId/preview — compact Resume Card data
  // ---------------------------------------------------------------------------

  app.get(
    '/api/sessions/:projectId/:sessionId/preview',
    apiRoute(async (context) => {
      const selection = await resolveProjectSession(
        context.req.param('projectId'),
        context.req.param('sessionId')
      )
      if ('response' in selection) return selection.response

      const preview = await loadSessionPreview(
        sessionTranscriptPath(selection.project.id, selection.session.id)
      )
      return context.json(preview)
    })
  )

  // ---------------------------------------------------------------------------
  // GET /api/sessions/:projectId/:sessionId/handoff — Markdown continuation packet
  // ---------------------------------------------------------------------------

  app.get(
    '/api/sessions/:projectId/:sessionId/handoff',
    apiRoute(async (context) => {
      const selection = await resolveProjectSession(
        context.req.param('projectId'),
        context.req.param('sessionId')
      )
      if ('response' in selection) return selection.response

      try {
        const contextData = await readTranscriptHandoffContext(
          sessionTranscriptPath(selection.project.id, selection.session.id)
        )
        return context.json({
          context: contextData,
          markdown: formatHandoff(selection.session, contextData),
        })
      } catch {
        return context.json({ error: 'session transcript not found' }, 404)
      }
    })
  )

  // ---------------------------------------------------------------------------
  // GET /api/session/:id?project=<projectId> — raw transcript events
  // ---------------------------------------------------------------------------

  app.get(
    '/api/session/:id',
    apiRoute(async (context) => {
      // param('id') is always a string when the route matches — Hono types it as
      // string | undefined for generality but the route pattern guarantees it.
      const sessionId = context.req.param('id') ?? ''
      const projectId = context.req.query('project')

      if (!projectId) return context.json({ error: 'project param required' }, 400)
      if (!isValidSessionId(sessionId)) return context.json({ error: 'invalid session id' }, 400)
      if (!(await loadProjectById(projectId))) {
        return context.json({ error: 'project not found' }, 404)
      }

      const transcriptPath = join(getClaudeDirectory(), 'projects', projectId, `${sessionId}.jsonl`)

      try {
        const raw = await readFile(transcriptPath, 'utf8')
        const events = raw
          .trim()
          .split('\n')
          .filter(Boolean)
          .map(parseTranscriptLine)
          .filter((event): event is Record<string, unknown> => event !== null)
        return context.json({ events })
      } catch {
        // File missing or unreadable — treat as 404 rather than a 500.
        return context.json({ error: 'session not found' }, 404)
      }
    })
  )

  // ---------------------------------------------------------------------------
  // GET /api/active — UUIDs of sessions with a live Claude Code process
  // ---------------------------------------------------------------------------

  app.get(
    '/api/active',
    apiRoute(async (context) => {
      const activeIds = await getActiveSessions()
      return context.json({ sessionIds: [...activeIds] })
    })
  )

  log.debug('project routes registered')
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when any searchable field of a session or its parent project
 * contains the query string (case-insensitive, already normalised by caller).
 *
 * Fields searched: project ID, path, display name; session ID, name, alias,
 * project path, recorded git branch, current git branch, and model names.
 */
function sessionMatchesQuery(
  session: Session,
  project: Project,
  projectName: string,
  normalizedQuery: string
): boolean {
  const candidates = [
    project.id,
    project.path,
    projectName,
    session.id,
    session.name,
    session.alias,
    session.projectPath,
    session.gitBranch,
    session.currentBranch,
    ...(session.context.models ?? []),
    ...(session.tags ?? []),
    ...(project.projectTags ?? []),
  ]
  return candidates.some((value) => (value ?? '').toLowerCase().includes(normalizedQuery))
}

/**
 * Resolves a project/session pair for read-only session detail endpoints.
 * Performs all identifier validation before touching session-specific files.
 */
async function resolveProjectSession(
  projectId: string | undefined,
  sessionId: string | undefined
): Promise<{ project: Project; session: Session } | { response: Response }> {
  if (!projectId)
    return { response: Response.json({ error: 'projectId required' }, { status: 400 }) }
  if (!isValidSessionId(sessionId ?? '')) {
    return { response: Response.json({ error: 'invalid session id' }, { status: 400 }) }
  }

  const project = await loadProjectById(projectId)
  if (!project) return { response: Response.json({ error: 'project not found' }, { status: 404 }) }

  const session = project.sessions.find((candidate) => candidate.id === sessionId)
  if (!session) return { response: Response.json({ error: 'session not found' }, { status: 404 }) }

  return { project, session }
}

/**
 * Parses a single JSONL transcript line.
 * Returns null instead of throwing so a malformed line is silently skipped
 * rather than corrupting the entire transcript response.
 */
function parseTranscriptLine(line: string): Record<string, unknown> | null {
  try {
    return JSON.parse(line) as Record<string, unknown>
  } catch {
    return null
  }
}
