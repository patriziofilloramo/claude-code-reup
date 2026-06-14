import type { Context } from 'hono'

import { log } from '../../utils/logger.js'
import { guardLocalRequest } from '../request-security.js'

/** A Hono-compatible async route handler. */
export type RouteHandler = (context: Context) => Promise<Response>

/**
 * Wraps a route handler with centralized error catching and logging.
 *
 * Individual handlers only need to express the happy path. Any thrown
 * exception is caught here, logged with the endpoint identity, and
 * converted to a standard 500 response — so the error shape and log
 * format are consistent across every endpoint.
 *
 * @example
 * app.get('/api/projects', apiRoute(async (c) => {
 *   const projects = await loadProjects()
 *   return c.json(projects.map(serializeProject))
 * }))
 */
export function apiRoute(handler: RouteHandler): RouteHandler {
  return async (context: Context) => {
    try {
      return await handler(context)
    } catch (error) {
      log.error(`${context.req.method} ${context.req.path} failed:`, error)
      return context.json({ error: 'Internal server error' }, 500)
    }
  }
}

/**
 * Like {@link apiRoute} but also enforces that the request originates from
 * the local browser before invoking the handler.
 *
 * This is the correct wrapper for **all state-changing endpoints** (POST, PUT,
 * DELETE). Read-only endpoints that do not touch the filesystem or launch
 * processes use {@link apiRoute} instead.
 *
 * Returns 403 Forbidden before the handler is called when the origin check
 * fails, keeping the security gate close to the surface and impossible to
 * accidentally omit inside the handler body.
 *
 * @example
 * app.post('/api/sessions/:id/archive', guardedRoute(async (c) => {
 *   const body = await c.req.json<{ archived: boolean }>()
 *   await setSessionArchived(c.req.param('id'), body.archived)
 *   return c.json({ ok: true })
 * }))
 */
export function guardedRoute(handler: RouteHandler): RouteHandler {
  return async (context: Context) => {
    const forbidden = guardLocalRequest(context)
    if (forbidden) return forbidden

    try {
      return await handler(context)
    } catch (error) {
      log.error(`${context.req.method} ${context.req.path} failed:`, error)
      return context.json({ error: 'Internal server error' }, 500)
    }
  }
}
