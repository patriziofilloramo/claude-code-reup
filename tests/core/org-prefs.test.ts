import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  createProjectGroup,
  createWorkStack,
  deleteProjectGroup,
  deleteWorkStack,
  OrgNotFoundError,
  readOrgData,
  setProjectGroup,
  addStackItem,
  removeStackItem,
  recordTagInPalette,
  updateProjectGroup,
  updateWorkStack,
} from '../../src/core/org/org-prefs.js'
import { OrgSchemaVersionError } from '../../src/core/org/org-model.js'
import { OrgValidationError } from '../../src/core/org/org-validation.js'

describe('org prefs', () => {
  let temporaryClaudeDirectory: string
  let originalClaudeConfigDirectory: string | undefined

  beforeEach(async () => {
    temporaryClaudeDirectory = await mkdtemp(join(tmpdir(), 'reup-org-test-'))
    originalClaudeConfigDirectory = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = temporaryClaudeDirectory
    await mkdir(join(temporaryClaudeDirectory, 'reup'), { recursive: true })
  })

  afterEach(async () => {
    if (originalClaudeConfigDirectory === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDirectory
    await rm(temporaryClaudeDirectory, { force: true, recursive: true })
  })

  // ---------------------------------------------------------------------------
  // readOrgData — graceful degradation
  // ---------------------------------------------------------------------------

  it('returns empty org data when org.json does not exist', async () => {
    const data = await readOrgData()
    expect(data.schemaVersion).toBe(1)
    expect(data.groups).toEqual([])
    expect(data.stacks).toEqual([])
    expect(data.tagPalette).toEqual([])
    expect(data.projectGroupAssignments).toEqual({})
  })

  it('degrades to empty when org.json has an unknown schema version', async () => {
    await writeFile(
      join(temporaryClaudeDirectory, 'reup', 'org.json'),
      JSON.stringify({ schemaVersion: 99, groups: [{ id: 'x', name: 'Future' }] })
    )
    const data = await readOrgData()
    expect(data.groups).toEqual([])
    expect(data.stacks).toEqual([])
  })

  it('degrades to empty for malformed org.json', async () => {
    await writeFile(join(temporaryClaudeDirectory, 'reup', 'org.json'), 'not-json{{{')
    const data = await readOrgData()
    expect(data.groups).toEqual([])
  })

  // ---------------------------------------------------------------------------
  // enqueueOrgUpdate — refuses to write on unknown schema version
  // ---------------------------------------------------------------------------

  it('throws OrgSchemaVersionError on write when persisted schema version is unknown', async () => {
    await writeFile(
      join(temporaryClaudeDirectory, 'reup', 'org.json'),
      JSON.stringify({ schemaVersion: 99 })
    )
    await expect(createProjectGroup('New Group')).rejects.toBeInstanceOf(OrgSchemaVersionError)
  })

  // ---------------------------------------------------------------------------
  // Group CRUD
  // ---------------------------------------------------------------------------

  it('creates a group and persists it', async () => {
    const group = await createProjectGroup('Experiments', '#ff0000')
    expect(group.name).toBe('Experiments')
    expect(group.color).toBe('#ff0000')
    expect(typeof group.id).toBe('string')

    const data = await readOrgData()
    expect(data.groups).toHaveLength(1)
    expect(data.groups[0]!.name).toBe('Experiments')
  })

  it('rejects a duplicate group name (case-insensitive)', async () => {
    await createProjectGroup('Alpha')
    await expect(createProjectGroup('alpha')).rejects.toBeInstanceOf(OrgValidationError)
  })

  it('updates a group name', async () => {
    const group = await createProjectGroup('Old Name')
    await updateProjectGroup(group.id, { name: 'New Name' })
    const data = await readOrgData()
    expect(data.groups[0]!.name).toBe('New Name')
  })

  it('throws OrgNotFoundError when updating a non-existent group', async () => {
    await expect(updateProjectGroup('no-such-id', { name: 'X' })).rejects.toBeInstanceOf(
      OrgNotFoundError
    )
  })

  it('deletes a group and clears its project assignments', async () => {
    const group = await createProjectGroup('ToDelete')
    await setProjectGroup('project-a', group.id)

    await deleteProjectGroup(group.id)

    const data = await readOrgData()
    expect(data.groups).toHaveLength(0)
    expect(data.projectGroupAssignments['project-a']).toBeUndefined()
  })

  it('throws OrgNotFoundError when deleting a non-existent group', async () => {
    await expect(deleteProjectGroup('no-such-id')).rejects.toBeInstanceOf(OrgNotFoundError)
  })

  // ---------------------------------------------------------------------------
  // Project group assignment
  // ---------------------------------------------------------------------------

  it('assigns a project to a group', async () => {
    const group = await createProjectGroup('Work')
    await setProjectGroup('project-1', group.id)

    const data = await readOrgData()
    expect(data.projectGroupAssignments['project-1']).toBe(group.id)
  })

  it('clears a project group assignment when groupId is null', async () => {
    const group = await createProjectGroup('Work')
    await setProjectGroup('project-1', group.id)
    await setProjectGroup('project-1', null)

    const data = await readOrgData()
    expect(data.projectGroupAssignments['project-1']).toBeUndefined()
  })

  it('rejects assigning a project to a non-existent group', async () => {
    await expect(setProjectGroup('project-1', 'no-such-group')).rejects.toBeInstanceOf(
      OrgNotFoundError
    )
  })

  // ---------------------------------------------------------------------------
  // Stack CRUD
  // ---------------------------------------------------------------------------

  it('creates a stack and persists it', async () => {
    const stack = await createWorkStack('Sprint 1')
    expect(stack.name).toBe('Sprint 1')
    expect(stack.items).toEqual([])
    const data = await readOrgData()
    expect(data.stacks).toHaveLength(1)
  })

  it('rejects a duplicate stack name (case-insensitive)', async () => {
    await createWorkStack('Sprint 1')
    await expect(createWorkStack('sprint 1')).rejects.toBeInstanceOf(OrgValidationError)
  })

  it('updates a stack name', async () => {
    const stack = await createWorkStack('Old Stack')
    await updateWorkStack(stack.id, { name: 'New Stack' })
    const data = await readOrgData()
    expect(data.stacks[0]!.name).toBe('New Stack')
  })

  it('deletes a stack', async () => {
    const stack = await createWorkStack('Temp')
    await deleteWorkStack(stack.id)
    const data = await readOrgData()
    expect(data.stacks).toHaveLength(0)
  })

  // ---------------------------------------------------------------------------
  // Stack items
  // ---------------------------------------------------------------------------

  it('adds a project item to a stack', async () => {
    const stack = await createWorkStack('My Stack')
    await addStackItem(stack.id, { kind: 'project', projectId: 'proj-a' })
    const data = await readOrgData()
    expect(data.stacks[0]!.items).toHaveLength(1)
    expect(data.stacks[0]!.items[0]).toMatchObject({ kind: 'project', projectId: 'proj-a' })
  })

  it('adds a session item to a stack', async () => {
    const stack = await createWorkStack('My Stack')
    await addStackItem(stack.id, {
      kind: 'session',
      projectId: 'proj-a',
      sessionId: '00000000-0000-0000-0000-000000000001',
    })
    const data = await readOrgData()
    expect(data.stacks[0]!.items[0]).toMatchObject({
      kind: 'session',
      projectId: 'proj-a',
      sessionId: '00000000-0000-0000-0000-000000000001',
    })
  })

  it('is idempotent when adding a duplicate stack item', async () => {
    const stack = await createWorkStack('My Stack')
    await addStackItem(stack.id, { kind: 'project', projectId: 'proj-a' })
    await addStackItem(stack.id, { kind: 'project', projectId: 'proj-a' })
    const data = await readOrgData()
    expect(data.stacks[0]!.items).toHaveLength(1)
  })

  it('removes a project stack item by projectId key', async () => {
    const stack = await createWorkStack('My Stack')
    await addStackItem(stack.id, { kind: 'project', projectId: 'proj-a' })
    await removeStackItem(stack.id, 'proj-a')
    const data = await readOrgData()
    expect(data.stacks[0]!.items).toHaveLength(0)
  })

  it('throws OrgNotFoundError when removing a non-existent stack item', async () => {
    const stack = await createWorkStack('My Stack')
    await expect(removeStackItem(stack.id, 'no-such-project')).rejects.toBeInstanceOf(
      OrgNotFoundError
    )
  })

  // ---------------------------------------------------------------------------
  // Tag palette
  // ---------------------------------------------------------------------------

  it('records a tag in the palette', async () => {
    await recordTagInPalette('bug')
    await recordTagInPalette('feature')
    const data = await readOrgData()
    expect(data.tagPalette).toContain('bug')
    expect(data.tagPalette).toContain('feature')
  })

  it('does not duplicate tags in the palette', async () => {
    await recordTagInPalette('bug')
    await recordTagInPalette('bug')
    const data = await readOrgData()
    expect(data.tagPalette.filter((t) => t === 'bug')).toHaveLength(1)
  })

  // ---------------------------------------------------------------------------
  // Concurrent writes — in-process queue serialisation
  // ---------------------------------------------------------------------------

  it('serialises concurrent org updates without data loss', async () => {
    await Promise.all([
      createProjectGroup('Group A'),
      createProjectGroup('Group B'),
      createProjectGroup('Group C'),
    ])
    const data = await readOrgData()
    expect(data.groups).toHaveLength(3)
    const names = data.groups.map((g) => g.name).sort()
    expect(names).toEqual(['Group A', 'Group B', 'Group C'])
  })
})
