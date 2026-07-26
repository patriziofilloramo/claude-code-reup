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
 * This wrapper adds no access control. The loopback-host check is applied
 * globally in `buildApp`, so read endpoints are already protected against
 * DNS rebinding; use {@link guardedRoute} whenever a request also changes
 * state and therefore needs cross-origin protection.
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
 * the Reup page itself before invoking the handler.
 *
 * This is the correct wrapper for **all state-changing endpoints** (POST, PUT,
 * DELETE). Read-only endpoints use {@link apiRoute} instead and rely on the
 * global loopback-host middleware alone.
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
