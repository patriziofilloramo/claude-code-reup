import type { Context } from 'hono'

const LOCAL_HOST_PATTERN = /^(localhost|127\.0\.0\.1)(:\d+)?$/

/**
 * Rejects state-changing requests that do not originate from the local server.
 * Returns null when the request is allowed.
 */
export function guardLocalRequest(context: Context): Response | null {
  const origin = context.req.header('Origin')
  const host = normalizeHost(context.req.header('Host') ?? '')

  if (!LOCAL_HOST_PATTERN.test(host)) return forbidden()

  if (origin) {
    try {
      const parsedOrigin = new URL(origin)
      const originHost = normalizeHost(parsedOrigin.host)
      if (parsedOrigin.protocol !== 'http:' || originHost !== host) return forbidden()
    } catch {
      return forbidden()
    }
  }

  return null
}

function normalizeHost(host: string): string {
  return host.trim().toLowerCase()
}

function forbidden(): Response {
  return new Response('Forbidden', { status: 403 })
}
