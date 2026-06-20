import { describe, expect, it } from 'vitest'

import { FEATURE_SURFACES } from '../../src/config/feature-surfaces.js'

describe('FEATURE_SURFACES', () => {
  it('records an explicit decision for every product surface', () => {
    for (const feature of Object.values(FEATURE_SURFACES)) {
      expect(Object.keys(feature.surfaces).sort()).toEqual(['tui', 'vscode', 'web'])
      expect(feature.description.trim()).not.toBe('')
    }
  })
})
