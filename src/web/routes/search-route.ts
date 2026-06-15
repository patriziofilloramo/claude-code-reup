import type { Hono } from 'hono'

import { loadProjects } from '../../core/project/project-discovery.js'
import { searchTranscripts } from '../../core/session/session-search.js'
import { log } from '../../utils/logger.js'
import { projectDisplayName } from '../api-model.js'
import type { ApiDeepSearchHit } from '../api-model.js'
import { apiRoute } from './route-helper.js'

/**
 * Registers the transcript deep-search endpoint.
 *
 * Unlike the metadata search at `/api/search`, this endpoint scans the raw
 * JSONL transcript content of every session, which makes it significantly
 * slower — queries under 2 characters are rejected early to prevent
 * accidentally scanning the full transcript corpus on every keystroke.
 */
export function registerSearchRoute(app: Hono): void {
  // ---------------------------------------------------------------------------
  // GET /api/search/deep?q=<query> — full-text search inside transcripts
  // ---------------------------------------------------------------------------

  app.get(
    '/api/search/deep',
    apiRoute(async (context) => {
      const query = (context.req.query('q') ?? '').trim()

      // Reject trivially short queries before touching the filesystem.
      if (query.length < 2) return context.json({ matches: [] })

      const projects = await loadProjects()
      const rawMatches = await searchTranscripts(query, projects)

      const matches: ApiDeepSearchHit[] = rawMatches.map((m) => ({
        sessionId: m.session.id,
        sessionName: m.session.alias ?? m.session.name,
        projectId: m.project.id,
        projectName: projectDisplayName(m.project),
        matchCount: m.matchCount,
        snippet: m.snippet,
      }))

      log.debug(`deep-search: "${query}" → ${matches.length} session(s) matched`)
      return context.json({ matches })
    })
  )

  log.debug('search routes registered')
}
