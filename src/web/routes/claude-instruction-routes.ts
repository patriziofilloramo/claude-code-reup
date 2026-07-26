import type { Hono } from 'hono'

import { log } from '../../utils/logger.js'
import { readClaudeInstructions, writeClaudeInstructions } from '../claude-instructions.js'
import { apiRoute, guardedRoute } from './route-helper.js'

/**
 * Registers read/write access to server-resolved CLAUDE.md instruction files.
 *
 * The read endpoint skips the origin check because it changes no state; like
 * every route it still passes the global loopback-host middleware, which is
 * what keeps project instructions off a rebound origin. The write endpoint is
 * guarded because it mutates the filesystem.
 */
export function registerClaudeInstructionRoutes(app: Hono): void {
  // ---------------------------------------------------------------------------
  // GET /api/claude-md/:projectId — read the project CLAUDE.md if one exists
  // ---------------------------------------------------------------------------

  app.get(
    '/api/claude-md/:projectId',
    apiRoute(async (context) => {
      const projectId = context.req.param('projectId') ?? ''
      const instructions = await readClaudeInstructions(projectId)

      if (!instructions) return context.json({ error: 'project not found' }, 404)

      return context.json(instructions)
    })
  )

  // ---------------------------------------------------------------------------
  // PUT /api/claude-md/:projectId — save new content to the project CLAUDE.md
  // Body: { content: string }
  // ---------------------------------------------------------------------------

  app.put(
    '/api/claude-md/:projectId',
    guardedRoute(async (context) => {
      const projectId = context.req.param('projectId') ?? ''
      const body = await context.req.json<{ content?: unknown }>()

      if (typeof body.content !== 'string') {
        return context.json({ error: 'content must be a string' }, 400)
      }

      const savedPath = await writeClaudeInstructions(projectId, body.content)
      if (!savedPath) return context.json({ error: 'project not found' }, 404)

      log.debug('claude-md: saved', savedPath)
      return context.json({ ok: true })
    })
  )

  log.debug('claude-md routes registered')
}
