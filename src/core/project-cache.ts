import type { Project } from './session-model.js'

interface ProjectCacheEntry {
  projectsDirectory: string
  projects: Project[]
  timestamp: number
}

/**
 * Short-lived in-process cache for loaded project data.
 *
 * The TTL protects bursts of related API requests. Filesystem events and
 * sidecar mutations call `invalidateProjectCache()` before clients refresh.
 * The cache is keyed on the resolved projects directory so test runs that swap
 * CLAUDE_CONFIG_DIR always get a fresh scan for the new path.
 */
const CACHE_TTL_MS = 2_000

let cachedEntry: ProjectCacheEntry | null = null

export function getCachedProjects(projectsDirectory: string): Project[] | null {
  if (!cachedEntry) return null
  if (cachedEntry.projectsDirectory !== projectsDirectory) {
    cachedEntry = null
    return null
  }
  if (Date.now() - cachedEntry.timestamp > CACHE_TTL_MS) {
    cachedEntry = null
    return null
  }
  return cachedEntry.projects
}

export function setCachedProjects(projectsDirectory: string, projects: Project[]): void {
  cachedEntry = { projectsDirectory, projects, timestamp: Date.now() }
}

export function invalidateProjectCache(): void {
  cachedEntry = null
}
