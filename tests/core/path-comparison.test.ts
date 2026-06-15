import { describe, expect, it } from 'vitest'
import { join } from 'node:path'

import {
  normalizePathForComparison,
  pathsReferToSameLocation,
} from '../../src/core/project/path-comparison.js'

describe('filesystem path comparison', () => {
  it('ignores trailing separators and normalizes path segments', () => {
    const canonicalPath = join('root', 'project')
    const equivalentPath = join('root', 'nested', '..', 'project') + '/'

    expect(pathsReferToSameLocation(canonicalPath, equivalentPath)).toBe(true)
  })

  it('preserves Linux path case sensitivity', () => {
    const normalizedUppercasePath = normalizePathForComparison(join('root', 'Project'))
    const normalizedLowercasePath = normalizePathForComparison(join('root', 'project'))

    if (process.platform === 'linux') {
      expect(normalizedUppercasePath).not.toBe(normalizedLowercasePath)
    } else {
      expect(normalizedUppercasePath).toBe(normalizedLowercasePath)
    }
  })
})
