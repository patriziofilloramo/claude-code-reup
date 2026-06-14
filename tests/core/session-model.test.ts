import { describe, expect, it } from 'vitest'

import { isValidSessionId } from '../../src/core/session-model.js'

describe('isValidSessionId', () => {
  it('accepts a well-formed lowercase UUID', () => {
    expect(isValidSessionId('550e8400-e29b-41d4-a716-446655440000')).toBe(true)
  })

  it('accepts a well-formed uppercase UUID', () => {
    expect(isValidSessionId('550E8400-E29B-41D4-A716-446655440000')).toBe(true)
  })

  it('rejects an empty string', () => {
    expect(isValidSessionId('')).toBe(false)
  })

  it('rejects a UUID with wrong segment lengths', () => {
    expect(isValidSessionId('550e8400-e29b-41d4-a716-44665544000')).toBe(false)
    expect(isValidSessionId('550e8400-e29b-41d4-a716-4466554400000')).toBe(false)
  })

  it('rejects shell metacharacters', () => {
    expect(isValidSessionId('foo & rm -rf /')).toBe(false)
    expect(isValidSessionId('$(reboot)')).toBe(false)
    expect(isValidSessionId('; shutdown /s')).toBe(false)
  })

  it('rejects a plain word', () => {
    expect(isValidSessionId('not-a-uuid')).toBe(false)
  })
})
