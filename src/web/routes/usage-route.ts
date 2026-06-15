import type { Hono } from 'hono'

import { readLiveUsageSummary } from '../../core/usage/live-usage.js'
import { log } from '../../utils/logger.js'
import { apiRoute } from './route-helper.js'

/**
 * Registers the usage-summary endpoint used by the web header.
 *
 * This endpoint surfaces locally captured usage observations only — no
 * credentials are sent to external services. See {@link readLiveUsageSummary}
 * for the full list of data sources and privacy boundaries.
 */
export function registerUsageRoute(app: Hono): void {
  // ---------------------------------------------------------------------------
  // GET /api/usage — aggregate usage summary from local snapshots
  // ---------------------------------------------------------------------------

  app.get(
    '/api/usage',
    apiRoute(async (context) => {
      const summary = await readLiveUsageSummary()
      log.debug('usage: summary refreshed, freshness =', summary.freshness)
      return context.json(summary)
    })
  )

  log.debug('usage route registered')
}
