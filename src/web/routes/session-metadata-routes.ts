import type { Hono } from 'hono'

import { loadProjectById } from '../../core/project-discovery.js'
import { isValidSessionId } from '../../core/session-model.js'
import {
  ActiveSessionDeletionError,
  deleteSession,
  setSessionAlias,
  setSessionArchived,
} from '../../core/session-metadata.js'
import { log } from '../../utils/logger.js'
import { guardedRoute } from './route-helper.js'

/**
 * Registers CCM sidecar mutation endpoints for session aliases and archive state.
 *
 * All endpoints are guarded: they require a localhost origin because they write
 * to CCM's `ccm.json` sidecar files on the server filesystem.
 */
export function registerSessionMetadataRoutes(app: Hono): void {
  // ---------------------------------------------------------------------------
  // POST /api/sessions/:projectId/:sessionId/archive
  // Body: { archived: boolean }
  // ---------------------------------------------------------------------------

  app.post(
    '/api/sessions/:projectId/:sessionId/archive',
    guardedRoute(async (context) => {
      const { projectId, sessionId } = context.req.param()

      const idError = validateSessionIdentifiers(projectId, sessionId)
      if (idError) return context.json({ error: idError }, 400)

      const project = await loadProjectById(projectId)
      if (!project) return context.json({ error: 'project not found' }, 404)
      if (!project.sessions.some((s) => s.id === sessionId)) {
        return context.json({ error: 'session not found' }, 404)
      }

      const body = await context.req.json<{ archived?: unknown }>()
      if (typeof body.archived !== 'boolean') {
        return context.json({ error: 'archived must be boolean' }, 400)
      }

      await setSessionArchived(projectId, sessionId, body.archived)
      log.debug('archive: set session', sessionId, 'archived =', body.archived)
      return context.json({ ok: true })
    })
  )

  // ---------------------------------------------------------------------------
  // PUT /api/sessions/:projectId/:sessionId/alias
  // Body: { alias: string | null }
  // ---------------------------------------------------------------------------

  app.put(
    '/api/sessions/:projectId/:sessionId/alias',
    guardedRoute(async (context) => {
      const { projectId, sessionId } = context.req.param()

      const idError = validateSessionIdentifiers(projectId, sessionId)
      if (idError) return context.json({ error: idError }, 400)

      const project = await loadProjectById(projectId)
      if (!project) return context.json({ error: 'project not found' }, 404)
      if (!project.sessions.some((s) => s.id === sessionId)) {
        return context.json({ error: 'session not found' }, 404)
      }

      const body = await context.req.json<{ alias?: unknown }>()
      if (body.alias !== undefined && body.alias !== null && typeof body.alias !== 'string') {
        return context.json({ error: 'alias must be a string or null' }, 400)
      }

      // Normalise: trim whitespace, enforce 160-char cap, treat empty string as
      // "no alias" (undefined) so the field is omitted from the sidecar JSON.
      const normalizedAlias =
        typeof body.alias === 'string' ? body.alias.trim().slice(0, 160) || undefined : undefined

      await setSessionAlias(projectId, sessionId, normalizedAlias)
      log.debug('alias: updated session', sessionId, '→', normalizedAlias ?? '(cleared)')
      return context.json({ ok: true })
    })
  )

  // ---------------------------------------------------------------------------
  // DELETE /api/sessions/:projectId/:sessionId
  // Permanently removes the .jsonl transcript and CCM sidecar entry.
  // ---------------------------------------------------------------------------

  app.delete(
    '/api/sessions/:projectId/:sessionId',
    guardedRoute(async (context) => {
      const { projectId, sessionId } = context.req.param()

      const idError = validateSessionIdentifiers(projectId, sessionId)
      if (idError) return context.json({ error: idError }, 400)

      const project = await loadProjectById(projectId)
      if (!project) return context.json({ error: 'project not found' }, 404)
      if (!project.sessions.some((s) => s.id === sessionId)) {
        return context.json({ error: 'session not found' }, 404)
      }
      try {
        await deleteSession(projectId, sessionId)
      } catch (error) {
        if (error instanceof ActiveSessionDeletionError) {
          return context.json({ error: 'cannot delete an active session' }, 409)
        }
        throw error
      }
      log.debug('delete: removed session', sessionId)
      return context.json({ ok: true })
    })
  )

  log.debug('session metadata routes registered')
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Validates that both route parameters are well-formed before any disk access.
 * Returns an error message string on failure, or null when both are valid.
 */
function validateSessionIdentifiers(projectId: string, sessionId: string): string | null {
  if (!projectId) return 'projectId is required'
  if (!isValidSessionId(sessionId)) return 'invalid session id'
  return null
}
