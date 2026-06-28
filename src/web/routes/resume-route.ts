import type { Hono } from 'hono'

import { loadProjectById } from '../../core/project/project-discovery.js'
import { isValidSessionId } from '../../core/session/session-model.js'
import { launchNewSession, launchResume } from '../../core/terminal/terminal.js'
import { log } from '../../utils/logger.js'
import { guardedRoute } from './route-helper.js'

/**
 * Registers terminal-launch endpoints for resuming an existing session or
 * starting a new one inside a given project directory.
 *
 * Both endpoints are guarded: they require a localhost origin and must not be
 * reachable from any page other than the Reup web UI itself, because they
 * spawn real system processes.
 */
export function registerResumeRoute(app: Hono): void {
  // ---------------------------------------------------------------------------
  // POST /api/new-session — launch Claude Code in a project directory
  // ---------------------------------------------------------------------------

  app.post(
    '/api/new-session',
    guardedRoute(async (context) => {
      const body = await context.req.json<{ projectId?: unknown }>()
      if (typeof body.projectId !== 'string') {
        return context.json({ error: 'projectId required' }, 400)
      }

      const project = await loadProjectById(body.projectId)
      if (!project) return context.json({ error: 'project not found' }, 404)

      const result = await launchNewSession(project.path)
      if (result.launched) {
        log.debug('new-session: launched terminal in', project.path)
      } else {
        log.warn('new-session: terminal launch failed, fell back to clipboard:', result.message)
      }
      return context.json(result)
    })
  )

  // ---------------------------------------------------------------------------
  // POST /api/resume/:id — resume an existing session by UUID
  // ---------------------------------------------------------------------------

  app.post(
    '/api/resume/:id',
    guardedRoute(async (context) => {
      const sessionId = context.req.param('id') ?? ''
      if (!isValidSessionId(sessionId)) {
        return context.json({ error: 'invalid session id' }, 400)
      }

      const body = await context.req.json<{ projectId?: unknown }>()
      if (typeof body.projectId !== 'string') {
        return context.json({ error: 'projectId required' }, 400)
      }

      // Resolve both project and session server-side so that browser-supplied
      // paths never reach the terminal launcher directly.
      const project = await loadProjectById(body.projectId as string)
      if (!project) return context.json({ error: 'project not found' }, 404)

      const session = project.sessions.find((s) => s.id === sessionId)
      if (!session) return context.json({ error: 'session not found in project' }, 404)

      const result = await launchResume(sessionId, session.projectPath)
      if (result.launched) {
        log.debug('resume: launched session', sessionId)
      } else {
        log.warn('resume: terminal launch failed, fell back to clipboard:', result.message)
      }
      return context.json(result)
    })
  )

  log.debug('resume routes registered')
}
