import { readFile } from 'node:fs/promises'

import type { Context, Hono } from 'hono'

import { APP } from '../../config/app.js'
import { getActiveSessions } from '../../core/session/active-sessions.js'
import { loadProjectById, loadProjects } from '../../core/project/project-discovery.js'
import { formatHandoff, readTranscriptHandoffContext } from '../../core/session/session-handoff.js'
import { isValidSessionId } from '../../core/session/session-model.js'
import type { Project, Session } from '../../core/session/session-model.js'
import { loadSessionPreview, sessionTranscriptPath } from '../../core/session/session-preview.js'
import {
  buildLiveActivitySnapshot,
  readPresentableActiveSessionIds,
} from '../live-activity-model.js'
import { isResumeVisibleSession } from '../../core/session/session-visibility.js'
import { filterProjectsByOrg, type OrgProjectFilter } from '../../core/org/org-filters.js'
import { readOrgData } from '../../core/org/org-prefs.js'
import { log } from '../../utils/logger.js'
import { projectDisplayName, serializeProject, serializeSession } from '../api-model.js'
import type { ApiSession } from '../api-model.js'
import { apiRoute } from './route-helper.js'

/**
 * Registers read-only endpoints for project discovery, session search,
 * transcript access, and active-session detection.
 *
 * These endpoints return transcript content and filesystem paths, so they are
 * not "safe by virtue of being GET". They rely on the global loopback-host
 * middleware registered in `buildApp`; they skip the origin check only because
 * they change no state.
 */
export function registerProjectRoutes(app: Hono): void {
  app.get(
    '/api/projects',
    apiRoute(async (context) => {
      const orgFilter = orgProjectFilterFromQuery(context)
      const [projects, activeSessionIds] = await Promise.all([
        loadProjectsMatchingOrgFilter(orgFilter),
        getActiveSessions({ officialRefresh: 'background' }),
      ])
      return context.json(projects.map((project) => serializeProject(project, activeSessionIds)))
    })
  )

  app.get(
    '/api/search',
    apiRoute(async (context) => {
      const normalizedQuery = (context.req.query('q') ?? '').toLowerCase().trim()
      const orgFilter = orgProjectFilterFromQuery(context)

      if (!normalizedQuery && !hasOrgProjectFilter(orgFilter)) return context.json([])

      const [projects, activeSessionIds] = await Promise.all([
        loadProjectsMatchingOrgFilter(orgFilter),
        getActiveSessions({ officialRefresh: 'background' }),
      ])

      const hits: Array<ApiSession & { projectName: string }> = []

      for (const project of projects) {
        const projectName = projectDisplayName(project)
        for (const session of project.sessions) {
          if (!isResumeVisibleSession(session)) continue
          if (
            normalizedQuery &&
            !sessionMatchesQuery(session, project, projectName, normalizedQuery)
          ) {
            continue
          }
          hits.push({ ...serializeSession(session, activeSessionIds.has(session.id)), projectName })
          if (hits.length >= APP.maxSearchResults) return context.json(hits)
        }
      }

      return context.json(hits)
    })
  )

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

  app.get(
    '/api/session/:id',
    apiRoute(async (context) => {
      const selection = await resolveProjectSession(
        context.req.query('project'),
        context.req.param('id'),
        'project param required'
      )
      if ('response' in selection) return selection.response

      const transcriptPath = sessionTranscriptPath(selection.project.id, selection.session.id)

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
        return context.json({ error: 'session not found' }, 404)
      }
    })
  )

  app.get(
    '/api/active',
    apiRoute(async (context) => {
      const sessionIds = await readPresentableActiveSessionIds({ officialRefresh: 'background' })
      return context.json({ sessionIds })
    })
  )

  // Per-active-session last tool and activity state for the activity strip.
  // The same model is pushed over SSE; this route remains the poll fallback.
  app.get(
    '/api/live-activity',
    apiRoute(async (context) => context.json((await buildLiveActivitySnapshot()).entries))
  )

  log.debug('project routes registered')
}

function orgProjectFilterFromQuery(context: Context): OrgProjectFilter {
  return {
    groupId: context.req.query('group'),
    stackId: context.req.query('stack'),
    tag: context.req.query('tag'),
  }
}

function hasOrgProjectFilter(filter: OrgProjectFilter): boolean {
  return Boolean(filter.groupId || filter.stackId || filter.tag)
}

async function loadProjectsMatchingOrgFilter(filter: OrgProjectFilter): Promise<Project[]> {
  const projects = await loadProjects()
  if (!hasOrgProjectFilter(filter)) return projects

  const orgData = await readOrgData()
  return filterProjectsByOrg(projects, orgData, filter)
}

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

async function resolveProjectSession(
  projectId: string | undefined,
  sessionId: string | undefined,
  missingProjectMessage = 'projectId required'
): Promise<{ project: Project; session: Session } | { response: Response }> {
  if (!projectId)
    return { response: Response.json({ error: missingProjectMessage }, { status: 400 }) }
  if (!isValidSessionId(sessionId ?? '')) {
    return { response: Response.json({ error: 'invalid session id' }, { status: 400 }) }
  }

  const project = await loadProjectById(projectId)
  if (!project) return { response: Response.json({ error: 'project not found' }, { status: 404 }) }

  const session = project.sessions.find(
    (candidate) => candidate.id === sessionId && isResumeVisibleSession(candidate)
  )
  if (!session) return { response: Response.json({ error: 'session not found' }, { status: 404 }) }

  return { project, session }
}

function parseTranscriptLine(line: string): Record<string, unknown> | null {
  try {
    return JSON.parse(line) as Record<string, unknown>
  } catch {
    return null
  }
}
