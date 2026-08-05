import type { Hono } from 'hono'

import { loadProjects } from '../../core/project/project-discovery.js'
import { getActiveSessions } from '../../core/session/active-sessions.js'
import { collectTouchedFiles, searchTouchedFiles } from '../../core/session/session-file-search.js'
import { log } from '../../utils/logger.js'
import { projectDisplayName } from '../api-model.js'
import type { ApiTouchedFile, ApiTouchedSession } from '../api-model.js'
import { apiRoute } from './route-helper.js'

/**
 * Registers the reverse file→session lookup endpoints.
 *
 * `GET /api/touched/files` lists every file written across sessions; the client
 * drills into one with `GET /api/touched/sessions?path=` to see which sessions
 * wrote it. Both read the immutable write events Claude Code already recorded.
 */
export function registerTouchedRoute(app: Hono): void {
  app.get(
    '/api/touched/files',
    apiRoute(async (context) => {
      const includeArchived = context.req.query('archived') === 'true'
      const projects = await loadProjects()
      const files = await collectTouchedFiles(projects, { includeArchived })

      const payload: ApiTouchedFile[] = files.map((file) => ({
        path: file.path,
        sessionCount: file.sessionCount,
        lastTouchedAt: file.lastTouchedAt,
        gitBranch: file.gitBranch,
      }))
      return context.json({ files: payload })
    })
  )

  app.get(
    '/api/touched/sessions',
    apiRoute(async (context) => {
      const path = (context.req.query('path') ?? '').trim()
      if (!path) return context.json({ matches: [] })

      const includeArchived = context.req.query('archived') === 'true'
      const [projects, activeSessionIds] = await Promise.all([
        loadProjects(),
        getActiveSessions({ officialRefresh: 'background' }),
      ])
      const matches = await searchTouchedFiles(path, projects, { includeArchived })

      const payload: ApiTouchedSession[] = matches.map((match) => ({
        sessionId: match.session.id,
        sessionName: match.session.alias ?? match.session.name,
        projectId: match.project.id,
        projectName: projectDisplayName(match.project),
        matchCount: match.matchCount,
        lastTouchedAt: match.lastTouchedAt,
        gitBranch:
          match.gitBranch ?? match.session.gitBranch ?? match.session.currentBranch ?? null,
        active: activeSessionIds.has(match.session.id),
      }))

      log.debug(`touched: "${path}" → ${payload.length} session(s) matched`)
      return context.json({ matches: payload })
    })
  )

  log.debug('touched routes registered')
}
