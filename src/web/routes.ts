import { Hono } from 'hono'

import { registerClaudeInstructionRoutes } from './routes/claude-instruction-routes.js'
import { registerDiagnosticsRoute } from './routes/diagnostics-route.js'
import { registerEventStreamRoute } from './routes/event-stream-route.js'
import { registerProjectRoutes } from './routes/project-routes.js'
import { registerResumeRoute } from './routes/resume-route.js'
import { registerSearchRoute } from './routes/search-route.js'
import { registerSessionMetadataRoutes } from './routes/session-metadata-routes.js'
import { registerUsageRoute } from './routes/usage-route.js'
import { UI_HTML } from './ui.js'

/**
 * Creates the local web application.
 *
 * This file intentionally remains a compact map of the HTTP surface. Route
 * groups own their validation and domain-specific helpers.
 */
export function buildApp(): Hono {
  const app = new Hono()

  app.get('/', (context) => context.html(UI_HTML))
  registerProjectRoutes(app)
  registerResumeRoute(app)
  registerSearchRoute(app)
  registerSessionMetadataRoutes(app)
  registerClaudeInstructionRoutes(app)
  registerDiagnosticsRoute(app)
  registerUsageRoute(app)
  registerEventStreamRoute(app)

  return app
}
