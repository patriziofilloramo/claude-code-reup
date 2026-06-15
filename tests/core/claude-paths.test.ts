import { describe, expect, it } from 'vitest'

import { decodeProjectDirectoryName } from '../../src/core/project/claude-paths.js'

describe('decodeProjectDirectoryName', () => {
  if (process.platform === 'win32') {
    it('converts Windows encoded directory names to drive paths', () => {
      expect(decodeProjectDirectoryName('P--Projects-IT')).toBe('P:\\Projects\\IT')
      expect(decodeProjectDirectoryName('C--Users-john-code')).toBe('C:\\Users\\john\\code')
    })

    it('upcases the drive letter', () => {
      expect(decodeProjectDirectoryName('p--Projects')).toBe('P:\\Projects')
      expect(decodeProjectDirectoryName('c--Work')).toBe('C:\\Work')
    })

    it('falls back to a Unix-style path when no drive prefix matches', () => {
      expect(decodeProjectDirectoryName('no-drive-prefix')).toBe('/no/drive/prefix')
    })
  } else {
    it('converts Unix encoded directory names to absolute paths', () => {
      expect(decodeProjectDirectoryName('home-user-projects')).toBe('/home/user/projects')
    })
  }
})
