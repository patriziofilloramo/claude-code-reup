import type { Project } from '../session/session-model.js'
import type { OrgData, ProjectGroup, WorkStack } from './org-model.js'

// ---------------------------------------------------------------------------
// Public filter types
// ---------------------------------------------------------------------------

export interface OrgProjectFilter {
  groupId?: string
  stackId?: string
  tag?: string
}

// ---------------------------------------------------------------------------
// Apply org metadata to discovered projects
// ---------------------------------------------------------------------------

/**
 * Merges group assignments from org.json into a project list.
 * Returns new project objects with the `group` (groupId) and `groupName` fields populated.
 * Pure: does not modify the input array or project objects.
 */
export function applyOrgMetadata(projects: Project[], orgData: OrgData): Project[] {
  const groupsById = new Map(orgData.groups.map((g) => [g.id, g]))
  return projects.map((project) => {
    const groupId = orgData.projectGroupAssignments[project.id]
    if (!groupId) return project
    const groupDef = groupsById.get(groupId)
    return { ...project, group: groupId, groupName: groupDef?.name }
  })
}

// ---------------------------------------------------------------------------
// Filter
// ---------------------------------------------------------------------------

/**
 * Filters projects and their session lists by an org-layer criterion.
 * Only one of groupId, stackId, or tag may be active at a time; the first
 * non-empty value wins. Returns the original array when no filter is set.
 *
 * For tag filters: a session matches if its own tags or its project's
 * projectTags include the tag.
 */
export function filterProjectsByOrg(
  projects: Project[],
  orgData: OrgData,
  filter: OrgProjectFilter
): Project[] {
  const { groupId, stackId, tag } = filter

  if (groupId) return filterByGroup(projects, orgData, groupId)
  if (stackId) return filterByStack(projects, orgData, stackId)
  if (tag) return filterByTag(projects, tag)
  return projects
}

function filterByGroup(projects: Project[], orgData: OrgData, groupId: string): Project[] {
  return projects.filter((project) => orgData.projectGroupAssignments[project.id] === groupId)
}

function filterByStack(projects: Project[], orgData: OrgData, stackId: string): Project[] {
  const stack = orgData.stacks.find((s) => s.id === stackId)
  if (!stack) return []

  const stackProjectIds = new Set<string>()
  const stackSessionKeys = new Set<string>() // "projectId:sessionId"

  for (const item of stack.items) {
    if (item.kind === 'project') {
      stackProjectIds.add(item.projectId)
    } else if (item.kind === 'session' && item.sessionId) {
      stackSessionKeys.add(`${item.projectId}:${item.sessionId}`)
    }
  }

  const results: Project[] = []
  for (const project of projects) {
    if (stackProjectIds.has(project.id)) {
      results.push(project)
      continue
    }
    const matchingSessions = project.sessions.filter((session) =>
      stackSessionKeys.has(`${project.id}:${session.id}`)
    )
    if (matchingSessions.length > 0) {
      results.push({ ...project, sessions: matchingSessions })
    }
  }
  return results
}

function filterByTag(projects: Project[], tag: string): Project[] {
  const results: Project[] = []
  for (const project of projects) {
    const hasProjectTag = project.projectTags?.includes(tag) ?? false
    const matchingSessions = project.sessions.filter(
      (session) => hasProjectTag || (session.tags?.includes(tag) ?? false)
    )
    if (matchingSessions.length > 0) {
      results.push({ ...project, sessions: matchingSessions })
    }
  }
  return results
}

// ---------------------------------------------------------------------------
// Counts
// ---------------------------------------------------------------------------

/**
 * Number of unique non-archived sessions in a stack.
 *
 * When a stack contains both a project P and an individual session S from P,
 * session S is counted exactly once — project membership and session membership
 * are deduplicated by (projectId, sessionId).
 */
export function countStackSessions(stack: WorkStack, projects: Project[]): number {
  const seenSessionKeys = new Set<string>() // "projectId:sessionId"

  for (const item of stack.items) {
    const project = projects.find((p) => p.id === item.projectId)
    if (!project) continue

    if (item.kind === 'project') {
      for (const session of project.sessions) {
        if (!session.signals.archived) {
          seenSessionKeys.add(`${project.id}:${session.id}`)
        }
      }
    } else if (item.kind === 'session' && item.sessionId) {
      const session = project.sessions.find((s) => s.id === item.sessionId)
      if (session && !session.signals.archived) {
        seenSessionKeys.add(`${project.id}:${item.sessionId}`)
      }
    }
  }

  return seenSessionKeys.size
}

/** Number of projects currently assigned to a group. */
export function countGroupProjects(group: ProjectGroup, orgData: OrgData): number {
  let count = 0
  for (const assignedGroupId of Object.values(orgData.projectGroupAssignments)) {
    if (assignedGroupId === group.id) count++
  }
  return count
}
