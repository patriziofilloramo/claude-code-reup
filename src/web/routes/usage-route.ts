import type { Hono } from 'hono'

import { readLiveUsageSummary } from '../../core/usage/live-usage.js'
import { log } from '../../utils/logger.js'
import { apiRoute } from './route-helper.js'

/**
 * Registers the usage-summary endpoint used by the web header.
 *
 * Before explicit usage setup this endpoint surfaces local observations only.
 * Once configured, the shared summary may also refresh Claude's account-limit
 * endpoint with Claude Code's locally managed OAuth credential. Reup never
 * returns, logs, or persists that credential. See {@link readLiveUsageSummary}
 * for the full source and privacy contract.
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
