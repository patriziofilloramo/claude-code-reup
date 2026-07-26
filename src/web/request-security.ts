import type { Context, MiddlewareHandler } from 'hono'

const LOCAL_HOST_PATTERN = /^(localhost|127\.0\.0\.1)(:\d+)?$/

/**
 * Rejects any request whose `Host` header is not the loopback address the
 * server was reached on.
 *
 * The server binds 127.0.0.1, so a remote host can never connect directly.
 * A browser can, though: DNS rebinding points an attacker-controlled name at
 * 127.0.0.1, and every request the attacker's page then makes is same-origin
 * from the browser's perspective — the same-origin policy stops protecting the
 * response body. The `Host` header still carries the attacker's name, which is
 * what makes this check the reliable discriminator.
 *
 * It applies to reads as much as writes: transcripts, project paths, and
 * CLAUDE.md contents are exactly what such a page would come for.
 *
 * Returns null when the request is allowed.
 */
export function guardLocalHost(context: Context): Response | null {
  return LOCAL_HOST_PATTERN.test(requestHost(context)) ? null : forbidden()
}

/**
 * Rejects state-changing requests that do not originate from the local server.
 *
 * Adds cross-origin protection on top of {@link guardLocalHost}: a page on
 * another origin can issue a request the browser still sends, and only the
 * `Origin` header reveals where it came from.
 *
 * Returns null when the request is allowed.
 */
export function guardLocalRequest(context: Context): Response | null {
  const rejectedHost = guardLocalHost(context)
  if (rejectedHost) return rejectedHost

  const origin = context.req.header('Origin')
  const host = requestHost(context)

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

/**
 * Applies {@link guardLocalHost} to every request, including reads and the
 * application shell.
 *
 * Registering this once in the app factory is deliberate: a per-route opt-in
 * only protects the routes someone remembered to annotate, and new read
 * endpoints are added far more often than they are security-reviewed.
 */
export function localHostOnly(): MiddlewareHandler {
  return async (context, next) => {
    const rejected = guardLocalHost(context)
    if (rejected) return rejected
    await next()
  }
}

/**
 * Returns the host the client addressed, however the request carries it.
 *
 * `@hono/node-server` builds the request URL from the incoming `Host` header,
 * so the two agree at runtime; the header is preferred and the URL is the
 * fallback for Fetch-API `Request` objects, where `Host` is a forbidden header
 * name and only the URL holds it. Both are equally client-controlled, so
 * reading either is the same trust decision — no host means no match.
 */
function requestHost(context: Context): string {
  const headerHost = context.req.header('Host')
  if (headerHost) return normalizeHost(headerHost)

  try {
    return normalizeHost(new URL(context.req.url).host)
  } catch {
    return ''
  }
}

function normalizeHost(host: string): string {
  return host.trim().toLowerCase()
}

function forbidden(): Response {
  return new Response('Forbidden', { status: 403 })
}
