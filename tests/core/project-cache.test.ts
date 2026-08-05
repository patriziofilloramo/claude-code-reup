import { describe, expect, it, vi } from 'vitest'

import type { Project } from '../../src/core/session/session-model.js'

import {
  coalesceProjectLoad,
  getCachedProjects,
  getProjectCacheGeneration,
  invalidateProjectCache,
  setCachedProjects,
} from '../../src/core/project/project-cache.js'

describe('project cache', () => {
  it('returns cached projects until explicitly invalidated', () => {
    const projects = []
    setCachedProjects('/projects', projects)

    expect(getCachedProjects('/projects')).toBe(projects)

    invalidateProjectCache()
    expect(getCachedProjects('/projects')).toBeNull()
  })

  it('does not return data cached for another Claude projects directory', () => {
    setCachedProjects('/first-projects', [])

    expect(getCachedProjects('/second-projects')).toBeNull()
  })

  it('does not let an in-flight scan repopulate the cache after invalidation', () => {
    const scanGeneration = getProjectCacheGeneration()
    invalidateProjectCache()

    expect(setCachedProjects('/projects', [], scanGeneration)).toBe(false)
    expect(getCachedProjects('/projects')).toBeNull()
  })

  it('coalesces concurrent discovery only within the same cache generation', async () => {
    invalidateProjectCache()
    let completeFirst: ((projects: Project[]) => void) | undefined
    const firstLoad = vi.fn(
      () =>
        new Promise<Project[]>((resolve) => {
          completeFirst = resolve
        })
    )
    const generation = getProjectCacheGeneration()

    const first = coalesceProjectLoad('/projects', generation, firstLoad)
    const concurrent = coalesceProjectLoad('/projects', generation, firstLoad)
    await Promise.resolve()

    expect(concurrent).toBe(first)
    expect(firstLoad).toHaveBeenCalledTimes(1)

    invalidateProjectCache()
    const afterInvalidation = coalesceProjectLoad(
      '/projects',
      getProjectCacheGeneration(),
      async () => []
    )
    expect(afterInvalidation).not.toBe(first)

    completeFirst?.([])
    await expect(Promise.all([first, concurrent, afterInvalidation])).resolves.toEqual([[], [], []])
  })

  it('allows a retry after a coalesced discovery fails synchronously', async () => {
    invalidateProjectCache()
    const generation = getProjectCacheGeneration()
    const failed = coalesceProjectLoad('/projects', generation, () => {
      throw new Error('scan failed')
    })

    await expect(failed).rejects.toThrow('scan failed')
    await expect(coalesceProjectLoad('/projects', generation, async () => [])).resolves.toEqual([])
  })
})
