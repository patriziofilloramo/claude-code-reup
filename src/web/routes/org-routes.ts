import type { Context, Hono } from 'hono'

import {
  addStackItem,
  createProjectGroup,
  createWorkStack,
  deleteProjectGroup,
  deleteWorkStack,
  OrgNotFoundError,
  OrgValidationError,
  readOrgData,
  removeStackItem,
  setProjectGroup,
  updateProjectGroup,
  updateWorkStack,
} from '../../core/org/org-prefs.js'
import { OrgSchemaVersionError } from '../../core/org/org-model.js'
import { log } from '../../utils/logger.js'
import { apiRoute, guardedRoute } from './route-helper.js'

/**
 * Registers endpoints for organization metadata: groups, stacks, tag palette,
 * and project group assignments.
 *
 * GET endpoints use apiRoute (read-only, no origin check).
 * All mutating endpoints use guardedRoute (localhost-only).
 */
export function registerOrgRoutes(app: Hono): void {
  // ---------------------------------------------------------------------------
  // GET /api/org — current org state
  // ---------------------------------------------------------------------------

  app.get(
    '/api/org',
    apiRoute(async (context) => {
      const orgData = await readOrgData()
      return context.json({
        schemaVersion: orgData.schemaVersion,
        groups: orgData.groups,
        stacks: orgData.stacks,
        tagPalette: orgData.tagPalette,
        projectGroupAssignments: orgData.projectGroupAssignments,
      })
    })
  )

  // ---------------------------------------------------------------------------
  // Groups
  // ---------------------------------------------------------------------------

  app.post(
    '/api/org/groups',
    guardedRoute(async (context) => {
      const body = await context.req.json<{ name?: unknown; color?: unknown }>()
      return handleOrgMutation(context, async () => {
        const group = await createProjectGroup(
          body.name as string,
          typeof body.color === 'string' ? body.color : undefined
        )
        return context.json({ group }, 201)
      })
    })
  )

  app.put(
    '/api/org/groups/:groupId',
    guardedRoute(async (context) => {
      const { groupId } = context.req.param()
      const body = await context.req.json<{ name?: unknown; color?: unknown }>()
      return handleOrgMutation(context, async () => {
        await updateProjectGroup(groupId, {
          name: typeof body.name === 'string' ? body.name : undefined,
          color: typeof body.color === 'string' ? body.color : undefined,
        })
        return context.json({ ok: true })
      })
    })
  )

  app.delete(
    '/api/org/groups/:groupId',
    guardedRoute(async (context) => {
      const { groupId } = context.req.param()
      return handleOrgMutation(context, async () => {
        await deleteProjectGroup(groupId)
        log.debug('org: group deleted', groupId)
        return context.json({ ok: true })
      })
    })
  )

  // ---------------------------------------------------------------------------
  // Project group assignment
  // ---------------------------------------------------------------------------

  app.put(
    '/api/projects/:projectId/group',
    guardedRoute(async (context) => {
      const { projectId } = context.req.param()
      if (!projectId) return context.json({ error: 'projectId is required' }, 400)

      const body = await context.req.json<{ groupId?: unknown }>()
      if (body.groupId !== undefined && body.groupId !== null && typeof body.groupId !== 'string') {
        return context.json({ error: 'groupId must be a string or null' }, 400)
      }

      return handleOrgMutation(context, async () => {
        await setProjectGroup(projectId, body.groupId as string | null)
        return context.json({ ok: true })
      })
    })
  )

  // ---------------------------------------------------------------------------
  // Stacks
  // ---------------------------------------------------------------------------

  app.post(
    '/api/org/stacks',
    guardedRoute(async (context) => {
      const body = await context.req.json<{ name?: unknown; color?: unknown }>()
      return handleOrgMutation(context, async () => {
        const stack = await createWorkStack(
          body.name as string,
          typeof body.color === 'string' ? body.color : undefined
        )
        return context.json({ stack }, 201)
      })
    })
  )

  app.put(
    '/api/org/stacks/:stackId',
    guardedRoute(async (context) => {
      const { stackId } = context.req.param()
      const body = await context.req.json<{ name?: unknown; color?: unknown }>()
      return handleOrgMutation(context, async () => {
        await updateWorkStack(stackId, {
          name: typeof body.name === 'string' ? body.name : undefined,
          color: typeof body.color === 'string' ? body.color : undefined,
        })
        return context.json({ ok: true })
      })
    })
  )

  app.delete(
    '/api/org/stacks/:stackId',
    guardedRoute(async (context) => {
      const { stackId } = context.req.param()
      return handleOrgMutation(context, async () => {
        await deleteWorkStack(stackId)
        return context.json({ ok: true })
      })
    })
  )

  app.post(
    '/api/org/stacks/:stackId/items',
    guardedRoute(async (context) => {
      const { stackId } = context.req.param()
      const body = await context.req.json<unknown>()
      return handleOrgMutation(context, async () => {
        await addStackItem(stackId, body)
        return context.json({ ok: true })
      })
    })
  )

  app.delete(
    '/api/org/stacks/:stackId/items/:itemRef',
    guardedRoute(async (context) => {
      const { stackId, itemRef } = context.req.param()
      if (!itemRef) return context.json({ error: 'itemRef is required' }, 400)
      return handleOrgMutation(context, async () => {
        await removeStackItem(stackId, decodeURIComponent(itemRef))
        return context.json({ ok: true })
      })
    })
  )

  log.debug('org routes registered')
}

// ---------------------------------------------------------------------------
// Error mapping helper
// ---------------------------------------------------------------------------

/**
 * Runs an org mutation, mapping domain errors to appropriate HTTP responses.
 * Unhandled errors are re-thrown and caught by guardedRoute's wrapper.
 */
async function handleOrgMutation(
  context: Context,
  handler: () => Promise<Response>
): Promise<Response> {
  try {
    return await handler()
  } catch (error) {
    if (error instanceof OrgValidationError) return context.json({ error: error.message }, 400)
    if (error instanceof OrgNotFoundError) return context.json({ error: error.message }, 404)
    if (error instanceof OrgSchemaVersionError) return context.json({ error: error.message }, 409)
    throw error
  }
}
