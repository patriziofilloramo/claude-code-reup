import type { Context, Hono } from 'hono'

import { setUserPref } from '../../core/user-prefs.js'
import {
  buildSyncOverview,
  linkAllCloudProjectsForSync,
  linkProjectForSync,
  SyncNoCloudProjectsError,
  SyncProjectActiveError,
  SyncSetupPatchError,
  unlinkAllSyncedProjectsForSync,
  unlinkProjectForSync,
} from '../../core/sync/sync-actions.js'
import { apiRoute, guardedRoute } from './route-helper.js'

const MANAGED_SETUP = {
  updateClaudeMd: true,
  updateGitignore: true,
  updatePermissionRules: true,
} as const

export function registerSyncRoute(app: Hono): void {
  app.get(
    '/api/sync',
    apiRoute(async (context) => {
      return context.json(await buildSyncOverview())
    })
  )

  app.post(
    '/api/sync/feature',
    guardedRoute(async (context) => {
      const body = await context.req.json<{ enabled?: unknown }>()
      if (typeof body.enabled !== 'boolean') {
        return context.json({ error: 'enabled must be boolean' }, 400)
      }
      await setUserPref('experimentalSharedSync', body.enabled ? 'on' : 'off')
      return context.json(await buildSyncOverview())
    })
  )

  app.post(
    '/api/sync/link',
    guardedRoute(async (context) => {
      const disabled = await rejectWhenSyncDisabled(context)
      if (disabled) return disabled

      const body = await context.req.json<{ path?: unknown }>()
      if (typeof body.path !== 'string' || body.path.trim() === '') {
        return context.json({ error: 'path is required' }, 400)
      }

      return jsonSyncOperation(context, () =>
        linkProjectForSync(body.path as string, { setupOptions: MANAGED_SETUP })
      )
    })
  )

  app.post(
    '/api/sync/unlink',
    guardedRoute(async (context) => {
      const disabled = await rejectWhenSyncDisabled(context)
      if (disabled) return disabled

      const body = await context.req.json<{ path?: unknown }>()
      if (typeof body.path !== 'string' || body.path.trim() === '') {
        return context.json({ error: 'path is required' }, 400)
      }

      return jsonSyncOperation(context, () => unlinkProjectForSync(body.path as string))
    })
  )

  app.post(
    '/api/sync/link-all-cloud',
    guardedRoute(async (context) => {
      const disabled = await rejectWhenSyncDisabled(context)
      if (disabled) return disabled

      try {
        return context.json(await linkAllCloudProjectsForSync({ setupOptions: MANAGED_SETUP }))
      } catch (error) {
        if (error instanceof SyncNoCloudProjectsError) {
          return context.json({
            message:
              'no cloud projects found - put projects under a detected cloud folder and try again',
            results: [],
          })
        }
        throw error
      }
    })
  )

  app.post(
    '/api/sync/unlink-all',
    guardedRoute(async (context) => {
      const disabled = await rejectWhenSyncDisabled(context)
      if (disabled) return disabled

      return context.json(await unlinkAllSyncedProjectsForSync())
    })
  )
}

async function rejectWhenSyncDisabled(context: Context): Promise<Response | null> {
  const overview = await buildSyncOverview()
  if (overview.enabled) return null
  return context.json({ error: 'experimental shared sync is disabled' }, 409)
}

async function jsonSyncOperation(
  context: Context,
  operation: () => Promise<unknown>
): Promise<Response> {
  try {
    return context.json(await operation())
  } catch (error) {
    if (error instanceof SyncProjectActiveError) return context.json({ error: error.message }, 409)
    if (error instanceof SyncSetupPatchError) return context.json({ error: error.message }, 400)
    throw error
  }
}
