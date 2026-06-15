import type { Hono } from 'hono'

import { buildDiagnosticsReport } from '../../core/health/diagnostics.js'
import { log } from '../../utils/logger.js'
import { apiRoute } from './route-helper.js'

/**
 * Registers the diagnostics endpoint that powers the Lost & Found panel.
 *
 * The report is expensive to build (it scans every project directory) so it
 * is only requested when the panel is opened, not on every page refresh.
 */
export function registerDiagnosticsRoute(app: Hono): void {
  // ---------------------------------------------------------------------------
  // GET /api/diagnostics — full diagnostic scan of all known session data
  // ---------------------------------------------------------------------------

  app.get(
    '/api/diagnostics',
    apiRoute(async (context) => {
      const report = await buildDiagnosticsReport()
      log.debug(
        'diagnostics:',
        report.expiring.length,
        'expiring,',
        report.orphanedTranscripts.length,
        'orphaned,',
        report.brokenIndices.length,
        'broken indices'
      )
      return context.json(report)
    })
  )

  log.debug('diagnostics route registered')
}
