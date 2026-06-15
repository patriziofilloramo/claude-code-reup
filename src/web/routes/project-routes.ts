import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { Hono } from 'hono'

import { APP } from '../../config/app.js'
import { getActiveSessions } from '../../core/active-sessions.js'
import { getClaudeDirectory } from '../../core/claude-paths.js'
import { loadProjectById, loadProjects } from '../../core/project-discovery.js'
import { isValidSessionId } from '../../core/session-model.js'
import type { Project, Session } from '../../core/session-model.js'
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
  // GET /api/projects — full project + session tree
  // ---------------------------------------------------------------------------

  app.get(
    '/api/projects',
    apiRoute(async (context) => {
      const projects = await loadProjects()
      return context.json(projects.map(serializeProject))
    })
  )

  // ---------------------------------------------------------------------------
  // GET /api/search?q=<query> — metadata search across projects and sessions
  // ---------------------------------------------------------------------------

  app.get(
    '/api/search',
    apiRoute(async (context) => {
      const normalizedQuery = (context.req.query('q') ?? '').toLowerCase().trim()
      if (!normalizedQuery) return context.json([])

      const projects = await loadProjects()
      const hits: Array<ApiSession & { projectName: string }> = []

      for (const project of projects) {
        const projectName = projectDisplayName(project)
        for (const session of project.sessions) {
          if (!sessionMatchesQuery(session, project, projectName, normalizedQuery)) continue
          hits.push({ ...serializeSession(session), projectName })
          if (hits.length >= APP.maxSearchResults) return context.json(hits)
        }
      }

      return context.json(hits)
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
  ]
  return candidates.some((value) => (value ?? '').toLowerCase().includes(normalizedQuery))
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
