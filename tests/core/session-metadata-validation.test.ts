import { describe, expect, it } from 'vitest'

import {
  normalizeSessionAlias,
  SESSION_ALIAS_MAX_LENGTH,
} from '../../src/core/session/session-metadata.js'

describe('normalizeSessionAlias', () => {
  it('trims aliases and clears blank values', () => {
    expect(normalizeSessionAlias('  useful name  ')).toBe('useful name')
    expect(normalizeSessionAlias('   ')).toBeUndefined()
    expect(normalizeSessionAlias(undefined)).toBeUndefined()
  })

  it('rejects aliases longer than the shared core limit', () => {
    expect(() => normalizeSessionAlias('x'.repeat(SESSION_ALIAS_MAX_LENGTH + 1))).toThrow(
      `at most ${SESSION_ALIAS_MAX_LENGTH}`
    )
  })
})
