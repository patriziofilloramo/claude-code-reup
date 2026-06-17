import { describe, expect, it } from 'vitest'

import {
  normalizeTagName,
  OrgValidationError,
  validateAndNormalizeTags,
  validateAndTrimName,
  validateNormalizedTag,
  validateStackItem,
  stackItemKey,
} from '../../src/core/org/org-validation.js'

describe('org validation', () => {
  // ---------------------------------------------------------------------------
  // Tag normalization and validation
  // ---------------------------------------------------------------------------

  describe('normalizeTagName', () => {
    it('trims whitespace and lowercases', () => {
      expect(normalizeTagName('  Bug  ')).toBe('bug')
      expect(normalizeTagName('FEATURE')).toBe('feature')
    })
  })

  describe('validateNormalizedTag', () => {
    it('accepts valid tags', () => {
      expect(() => validateNormalizedTag('bug')).not.toThrow()
      expect(() => validateNormalizedTag('my-feature')).not.toThrow()
      expect(() => validateNormalizedTag('v2')).not.toThrow()
      expect(() => validateNormalizedTag('a'.repeat(32))).not.toThrow()
    })

    it('rejects empty tags', () => {
      expect(() => validateNormalizedTag('')).toThrow(OrgValidationError)
    })

    it('rejects tags exceeding 32 characters', () => {
      expect(() => validateNormalizedTag('a'.repeat(33))).toThrow(OrgValidationError)
    })

    it('rejects tags with uppercase letters', () => {
      expect(() => validateNormalizedTag('Bug')).toThrow(OrgValidationError)
    })

    it('rejects tags with spaces', () => {
      expect(() => validateNormalizedTag('my tag')).toThrow(OrgValidationError)
    })

    it('rejects tags with special characters', () => {
      expect(() => validateNormalizedTag('bug!')).toThrow(OrgValidationError)
      expect(() => validateNormalizedTag('a_b')).toThrow(OrgValidationError)
    })
  })

  describe('validateAndNormalizeTags', () => {
    it('normalizes and deduplicates tags', () => {
      const result = validateAndNormalizeTags(['Bug', ' bug ', 'feature'])
      expect(result).toEqual(['bug', 'feature'])
    })

    it('rejects more than 8 tags', () => {
      expect(() => validateAndNormalizeTags(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'])).toThrow(
        OrgValidationError
      )
    })

    it('accepts exactly 8 tags', () => {
      expect(() => validateAndNormalizeTags(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])).not.toThrow()
    })

    it('rejects non-array input', () => {
      expect(() => validateAndNormalizeTags('bug' as unknown as unknown[])).toThrow(
        OrgValidationError
      )
    })

    it('rejects non-string tags', () => {
      expect(() => validateAndNormalizeTags([42] as unknown as unknown[])).toThrow(
        OrgValidationError
      )
    })

    it('returns an empty array for empty input', () => {
      expect(validateAndNormalizeTags([])).toEqual([])
    })
  })

  // ---------------------------------------------------------------------------
  // Group / stack name validation
  // ---------------------------------------------------------------------------

  describe('validateAndTrimName', () => {
    it('trims and returns a valid name', () => {
      expect(validateAndTrimName('  Sprint 1  ', 'stack')).toBe('Sprint 1')
    })

    it('accepts names up to 64 characters', () => {
      expect(() => validateAndTrimName('a'.repeat(64), 'group')).not.toThrow()
    })

    it('rejects names exceeding 64 characters', () => {
      expect(() => validateAndTrimName('a'.repeat(65), 'group')).toThrow(OrgValidationError)
    })

    it('rejects empty names', () => {
      expect(() => validateAndTrimName('   ', 'stack')).toThrow(OrgValidationError)
    })

    it('rejects non-string names', () => {
      expect(() => validateAndTrimName(42 as unknown as string, 'group')).toThrow(
        OrgValidationError
      )
    })
  })

  // ---------------------------------------------------------------------------
  // Stack item validation
  // ---------------------------------------------------------------------------

  describe('validateStackItem', () => {
    it('accepts a valid project item', () => {
      const item = validateStackItem({ kind: 'project', projectId: 'proj-1' })
      expect(item).toMatchObject({ kind: 'project', projectId: 'proj-1' })
    })

    it('accepts a valid session item', () => {
      const item = validateStackItem({
        kind: 'session',
        projectId: 'proj-1',
        sessionId: '00000000-0000-0000-0000-000000000001',
      })
      expect(item).toMatchObject({
        kind: 'session',
        projectId: 'proj-1',
        sessionId: '00000000-0000-0000-0000-000000000001',
      })
    })

    it('rejects a session item without sessionId', () => {
      expect(() => validateStackItem({ kind: 'session', projectId: 'proj-1' })).toThrow(
        OrgValidationError
      )
    })

    it('rejects an invalid kind', () => {
      expect(() => validateStackItem({ kind: 'workspace', projectId: 'proj-1' })).toThrow(
        OrgValidationError
      )
    })

    it('rejects a non-object', () => {
      expect(() => validateStackItem('not-an-object')).toThrow(OrgValidationError)
      expect(() => validateStackItem(null)).toThrow(OrgValidationError)
    })

    it('rejects an empty projectId', () => {
      expect(() => validateStackItem({ kind: 'project', projectId: '' })).toThrow(
        OrgValidationError
      )
    })
  })

  // ---------------------------------------------------------------------------
  // stackItemKey
  // ---------------------------------------------------------------------------

  describe('stackItemKey', () => {
    it('generates a project key', () => {
      expect(stackItemKey({ kind: 'project', projectId: 'proj-1' })).toBe('project:proj-1')
    })

    it('generates a session key', () => {
      expect(stackItemKey({ kind: 'session', projectId: 'proj-1', sessionId: 'ses-1' })).toBe(
        'proj-1:ses-1'
      )
    })
  })
})
