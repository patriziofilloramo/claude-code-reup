import { Hono } from 'hono'

import { getStoredThemeName } from '../core/theme-preference.js'
import { localHostOnly } from './request-security.js'
import { registerClaudeInstructionRoutes } from './routes/claude-instruction-routes.js'
import { registerDiagnosticsRoute } from './routes/diagnostics-route.js'
import { registerEventStreamRoute } from './routes/event-stream-route.js'
import { registerOrgRoutes } from './routes/org-routes.js'
import { registerProjectRoutes } from './routes/project-routes.js'
import { registerResumeRoute } from './routes/resume-route.js'
import { registerSearchRoute } from './routes/search-route.js'
import { registerSessionMetadataRoutes } from './routes/session-metadata-routes.js'
import { registerTouchedRoute } from './routes/touched-route.js'
import { registerThemeRoute } from './routes/theme-route.js'
import { registerUsageRoute } from './routes/usage-route.js'
import { buildUiDocument } from './ui.js'

/**
 * Creates the local web application.
 *
 * This file intentionally remains a compact map of the HTTP surface. Route
 * groups own their validation and domain-specific helpers.
 */
export function buildApp(): Hono {
  const app = new Hono()

  // Every route, read or write, is loopback-only. Registered before the routes
  // so no endpoint can be reachable without it.
  app.use('*', localHostOnly())

  app.get('/', (context) => {
    const document = buildUiDocument(getStoredThemeName() ?? 'dark')
    context.header('Content-Security-Policy', document.contentSecurityPolicy)
    context.header('X-Frame-Options', 'DENY')
    return context.html(document.html)
  })
  app.get('/api/health', (context) => context.json({ status: 'ok' }))
  registerProjectRoutes(app)
  registerOrgRoutes(app)
  registerResumeRoute(app)
  registerSearchRoute(app)
  registerTouchedRoute(app)
  registerSessionMetadataRoutes(app)
  registerClaudeInstructionRoutes(app)
  registerDiagnosticsRoute(app)
  registerUsageRoute(app)
  registerThemeRoute(app)
  registerEventStreamRoute(app)

  return app
}
