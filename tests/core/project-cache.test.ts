import { describe, expect, it } from 'vitest'

import {
  getCachedProjects,
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
})
