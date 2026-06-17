import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { getSwoopDirectory } from '../project/claude-paths.js'
import { withAdvisoryFileLock } from '../project/project-sidecar-lock.js'
import { log } from '../../utils/logger.js'
import {
  ORG_SCHEMA_VERSION,
  OrgSchemaVersionError,
  type OrgData,
  type ProjectGroup,
  type StackItem,
  type WorkStack,
} from './org-model.js'
import {
  normalizeTagName,
  OrgValidationError,
  stackItemKey,
  validateAndTrimName,
  validateNormalizedTag,
  validateStackItem,
} from './org-validation.js'

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function orgJsonPath(): string {
  return join(getSwoopDirectory(), 'org.json')
}

function orgLockPath(): string {
  return join(getSwoopDirectory(), 'org.json.lock')
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

export function emptyOrgData(): OrgData {
  return {
    schemaVersion: ORG_SCHEMA_VERSION,
    tagPalette: [],
    groups: [],
    stacks: [],
    projectGroupAssignments: {},
  }
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Reads org.json from disk.
 * Returns empty state when the file is missing or contains an unknown schema
 * version — callers must not attempt to write in the latter case, as the write
 * queue guard will refuse and throw OrgSchemaVersionError.
 */
export async function readOrgData(): Promise<OrgData> {
  try {
    const raw = await readFile(orgJsonPath(), 'utf8')
    const parsed = JSON.parse(raw) as Record<string, unknown>

    if (parsed['schemaVersion'] !== ORG_SCHEMA_VERSION) {
      log.warn(
        'org.json: unsupported schemaVersion',
        parsed['schemaVersion'],
        '— returning empty state for UI display'
      )
      return emptyOrgData()
    }

    return coerceOrgData(parsed)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyOrgData()
    log.warn('org.json: failed to read:', error)
    return emptyOrgData()
  }
}

// ---------------------------------------------------------------------------
// Write queue + lock
// ---------------------------------------------------------------------------

/**
 * Serialises concurrent in-process org mutations. Combined with the filesystem
 * advisory lock, this prevents races from both concurrent Swoop processes and
 * concurrent async operations within the same process.
 */
let orgWriteQueue: Promise<void> = Promise.resolve()

/**
 * Enqueues an org mutation.
 *
 * The updater receives the current OrgData and mutates it in place.
 * The write is atomic: temp file → rename, same pattern as swoop.json.
 * Throws OrgSchemaVersionError when org.json contains an unknown schema version
 * (prevents overwriting data written by a newer Swoop version).
 */
async function enqueueOrgUpdate(updater: (data: OrgData) => void): Promise<void> {
  const previousUpdate = orgWriteQueue
  const queuedUpdate = previousUpdate.then(() =>
    withAdvisoryFileLock(orgLockPath(), async () => {
      const data = await readOrgDataFromDisk()
      // Guard: refuse to write if a newer Swoop version owns this file.
      if (data !== null && data.schemaVersion !== ORG_SCHEMA_VERSION) {
        throw new OrgSchemaVersionError(data.schemaVersion)
      }
      const currentData = data ?? emptyOrgData()
      updater(currentData)
      await writeOrgDataAtomically(currentData)
    })
  )

  // A failed update must not poison later updates in the same process.
  orgWriteQueue = queuedUpdate.catch(() => {})
  return queuedUpdate
}

/** Raw disk read that returns null when the file is missing (not the same as readOrgData). */
async function readOrgDataFromDisk(): Promise<OrgData | null> {
  try {
    const raw = await readFile(orgJsonPath(), 'utf8')
    return JSON.parse(raw) as OrgData
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

async function writeOrgDataAtomically(data: OrgData): Promise<void> {
  const targetPath = orgJsonPath()
  const tempPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`

  await mkdir(getSwoopDirectory(), { recursive: true })
  try {
    await writeFile(tempPath, JSON.stringify(data, null, 2) + '\n', 'utf8')
    await rename(tempPath, targetPath)
  } finally {
    await unlink(tempPath).catch(() => {})
  }
}

// ---------------------------------------------------------------------------
// Coercion (lenient parse for unknown-shaped data)
// ---------------------------------------------------------------------------

function coerceOrgData(raw: Record<string, unknown>): OrgData {
  return {
    schemaVersion: ORG_SCHEMA_VERSION,
    tagPalette: Array.isArray(raw['tagPalette'])
      ? (raw['tagPalette'] as unknown[]).filter((t): t is string => typeof t === 'string')
      : [],
    groups: Array.isArray(raw['groups']) ? (raw['groups'] as unknown[]).filter(isValidGroup) : [],
    stacks: Array.isArray(raw['stacks'])
      ? (raw['stacks'] as unknown[]).filter(isValidStack).map(coerceStack)
      : [],
    projectGroupAssignments:
      raw['projectGroupAssignments'] &&
      typeof raw['projectGroupAssignments'] === 'object' &&
      !Array.isArray(raw['projectGroupAssignments'])
        ? (raw['projectGroupAssignments'] as Record<string, string>)
        : {},
  }
}

function isValidGroup(obj: unknown): obj is ProjectGroup {
  return (
    !!obj &&
    typeof obj === 'object' &&
    typeof (obj as Record<string, unknown>)['id'] === 'string' &&
    typeof (obj as Record<string, unknown>)['name'] === 'string'
  )
}

function isValidStack(obj: unknown): obj is WorkStack {
  return (
    !!obj &&
    typeof obj === 'object' &&
    typeof (obj as Record<string, unknown>)['id'] === 'string' &&
    typeof (obj as Record<string, unknown>)['name'] === 'string'
  )
}

function coerceStack(raw: WorkStack): WorkStack {
  return {
    id: raw.id,
    name: raw.name,
    color: typeof raw.color === 'string' ? raw.color : undefined,
    items: Array.isArray(raw.items)
      ? (raw.items as unknown[]).filter(
          (item): item is StackItem =>
            !!item &&
            typeof item === 'object' &&
            ((item as StackItem).kind === 'project' || (item as StackItem).kind === 'session') &&
            typeof (item as StackItem).projectId === 'string'
        )
      : [],
  }
}

// ---------------------------------------------------------------------------
// Group CRUD
// ---------------------------------------------------------------------------

export async function createProjectGroup(name: string, color?: string): Promise<ProjectGroup> {
  const validatedName = validateAndTrimName(name, 'group')
  const group: ProjectGroup = { id: randomUUID(), name: validatedName, color }
  await enqueueOrgUpdate((data) => {
    if (data.groups.some((g) => g.name.toLowerCase() === validatedName.toLowerCase())) {
      throw new OrgValidationError(`a group named "${validatedName}" already exists`)
    }
    data.groups.push(group)
  })
  log.debug('org: created group', group.id, group.name)
  return group
}

export async function updateProjectGroup(
  groupId: string,
  patch: { name?: string; color?: string }
): Promise<void> {
  const validatedName =
    patch.name !== undefined ? validateAndTrimName(patch.name, 'group') : undefined
  await enqueueOrgUpdate((data) => {
    const group = data.groups.find((g) => g.id === groupId)
    if (!group) throw new OrgNotFoundError('group', groupId)
    if (validatedName !== undefined) {
      const conflict = data.groups.find(
        (g) => g.id !== groupId && g.name.toLowerCase() === validatedName.toLowerCase()
      )
      if (conflict) throw new OrgValidationError(`a group named "${validatedName}" already exists`)
      group.name = validatedName
    }
    if (patch.color !== undefined) group.color = patch.color || undefined
  })
  log.debug('org: updated group', groupId)
}

/** Deletes a group and removes all projectGroupAssignments pointing to it. */
export async function deleteProjectGroup(groupId: string): Promise<void> {
  await enqueueOrgUpdate((data) => {
    const index = data.groups.findIndex((g) => g.id === groupId)
    if (index === -1) throw new OrgNotFoundError('group', groupId)
    data.groups.splice(index, 1)
    // Clear all assignments for this group.
    for (const [projectId, assignedGroupId] of Object.entries(data.projectGroupAssignments)) {
      if (assignedGroupId === groupId) delete data.projectGroupAssignments[projectId]
    }
  })
  log.debug('org: deleted group', groupId)
}

/** Assigns a project to a group, or clears the assignment when groupId is null. */
export async function setProjectGroup(projectId: string, groupId: string | null): Promise<void> {
  await enqueueOrgUpdate((data) => {
    if (groupId === null) {
      delete data.projectGroupAssignments[projectId]
    } else {
      if (!data.groups.some((g) => g.id === groupId)) {
        throw new OrgNotFoundError('group', groupId)
      }
      data.projectGroupAssignments[projectId] = groupId
    }
  })
  log.debug('org: set project', projectId, 'group →', groupId ?? '(none)')
}

// ---------------------------------------------------------------------------
// Stack CRUD
// ---------------------------------------------------------------------------

export async function createWorkStack(name: string, color?: string): Promise<WorkStack> {
  const validatedName = validateAndTrimName(name, 'stack')
  const stack: WorkStack = { id: randomUUID(), name: validatedName, items: [], color }
  await enqueueOrgUpdate((data) => {
    if (data.stacks.some((s) => s.name.toLowerCase() === validatedName.toLowerCase())) {
      throw new OrgValidationError(`a stack named "${validatedName}" already exists`)
    }
    data.stacks.push(stack)
  })
  log.debug('org: created stack', stack.id, stack.name)
  return stack
}

export async function updateWorkStack(
  stackId: string,
  patch: { name?: string; color?: string }
): Promise<void> {
  const validatedName =
    patch.name !== undefined ? validateAndTrimName(patch.name, 'stack') : undefined
  await enqueueOrgUpdate((data) => {
    const stack = data.stacks.find((s) => s.id === stackId)
    if (!stack) throw new OrgNotFoundError('stack', stackId)
    if (validatedName !== undefined) {
      const conflict = data.stacks.find(
        (s) => s.id !== stackId && s.name.toLowerCase() === validatedName.toLowerCase()
      )
      if (conflict) throw new OrgValidationError(`a stack named "${validatedName}" already exists`)
      stack.name = validatedName
    }
    if (patch.color !== undefined) stack.color = patch.color || undefined
  })
  log.debug('org: updated stack', stackId)
}

export async function deleteWorkStack(stackId: string): Promise<void> {
  await enqueueOrgUpdate((data) => {
    const index = data.stacks.findIndex((s) => s.id === stackId)
    if (index === -1) throw new OrgNotFoundError('stack', stackId)
    data.stacks.splice(index, 1)
  })
  log.debug('org: deleted stack', stackId)
}

export async function addStackItem(stackId: string, rawItem: unknown): Promise<void> {
  const item = validateStackItem(rawItem)
  const key = stackItemKey(item)
  await enqueueOrgUpdate((data) => {
    const stack = data.stacks.find((s) => s.id === stackId)
    if (!stack) throw new OrgNotFoundError('stack', stackId)
    if (stack.items.some((existing) => stackItemKey(existing) === key)) return // idempotent
    stack.items.push(item)
  })
  log.debug('org: added item', key, 'to stack', stackId)
}

/**
 * Removes a stack item by its reference string.
 * itemRef = "projectId" for project items, "projectId:sessionId" for session items.
 */
export async function removeStackItem(stackId: string, itemRef: string): Promise<void> {
  await enqueueOrgUpdate((data) => {
    const stack = data.stacks.find((s) => s.id === stackId)
    if (!stack) throw new OrgNotFoundError('stack', stackId)
    const before = stack.items.length
    stack.items = stack.items.filter((item) => {
      const key = item.kind === 'session' ? `${item.projectId}:${item.sessionId}` : item.projectId
      return key !== itemRef
    })
    if (stack.items.length === before) throw new OrgNotFoundError('stack item', itemRef)
  })
  log.debug('org: removed item', itemRef, 'from stack', stackId)
}

// ---------------------------------------------------------------------------
// Tag palette (best-effort; failure here must not fail the caller)
// ---------------------------------------------------------------------------

/**
 * Prepends a tag to the palette (most-recently-used first) if not already present.
 * This write is best-effort: failure is logged but does not propagate to the caller.
 */
export async function recordTagInPalette(tag: string): Promise<void> {
  try {
    const normalizedTag = normalizeTagName(tag)
    validateNormalizedTag(normalizedTag)
    await enqueueOrgUpdate((data) => {
      data.tagPalette = [normalizedTag, ...data.tagPalette.filter((t) => t !== normalizedTag)]
    })
  } catch (error) {
    // palette update is best-effort; tag in the sidecar remains valid regardless
    log.warn('org: palette update failed (tag still saved in sidecar):', error)
  }
}

// ---------------------------------------------------------------------------
// Domain errors
// ---------------------------------------------------------------------------

class OrgNotFoundError extends Error {
  constructor(kind: string, id: string) {
    super(`org: ${kind} not found: ${id}`)
    this.name = 'OrgNotFoundError'
  }
}

// Re-export so route layer can catch without importing org-validation directly.
export { OrgValidationError } from './org-validation.js'
export { OrgNotFoundError }
