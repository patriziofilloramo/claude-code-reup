import type { Context } from 'hono'

const LOCAL_HOST_PATTERN = /^(localhost|127\.0\.0\.1)(:\d+)?$/

/**
 * Rejects state-changing requests that do not originate from the local server.
 * Returns null when the request is allowed.
 */
export function guardLocalRequest(context: Context): Response | null {
  const origin = context.req.header('Origin')
  const host = context.req.header('Host') ?? ''

  if (origin) {
    try {
      if (!LOCAL_HOST_PATTERN.test(new URL(origin).hostname)) {
        return new Response('Forbidden', { status: 403 })
      }
    } catch {
      return new Response('Forbidden', { status: 403 })
    }
  }

  return LOCAL_HOST_PATTERN.test(host) ? null : new Response('Forbidden', { status: 403 })
}
