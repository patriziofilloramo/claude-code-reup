import type { Project } from '../session/session-model.js'

interface ProjectCacheEntry {
  cacheKey: string
  projects: Project[]
  timestamp: number
}

/**
 * Short-lived in-process cache for loaded project data.
 *
 * The TTL protects bursts of related API requests. Filesystem events and
 * sidecar mutations call `invalidateProjectCache()` before clients refresh.
 * Callers include the resolved projects directory plus discovery-mode bits in
 * the key, so test runs and preference toggles get the right scan scope.
 */
const CACHE_TTL_MS = 2_000

let cachedEntry: ProjectCacheEntry | null = null
let cacheGeneration = 0

export function getCachedProjects(cacheKey: string): Project[] | null {
  if (!cachedEntry) return null
  if (cachedEntry.cacheKey !== cacheKey) {
    cachedEntry = null
    return null
  }
  if (Date.now() - cachedEntry.timestamp > CACHE_TTL_MS) {
    cachedEntry = null
    return null
  }
  return cachedEntry.projects
}

/** Returns a token that becomes stale after the next explicit invalidation. */
export function getProjectCacheGeneration(): number {
  return cacheGeneration
}

/**
 * Stores a discovery result only when no invalidation happened while it was
 * being assembled. This prevents an older in-flight scan from repopulating the
 * cache after a filesystem event or sidecar mutation cleared it.
 */
export function setCachedProjects(
  cacheKey: string,
  projects: Project[],
  expectedGeneration = cacheGeneration
): boolean {
  if (expectedGeneration !== cacheGeneration) return false
  cachedEntry = { cacheKey, projects, timestamp: Date.now() }
  return true
}

export function invalidateProjectCache(): void {
  cacheGeneration += 1
  cachedEntry = null
}
