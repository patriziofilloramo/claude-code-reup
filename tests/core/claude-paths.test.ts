import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  decodeProjectDirectoryName,
  encodeProjectPath,
  isWindowsShortNameSegment,
  resolveProjectPath,
} from '../../src/core/project/claude-paths.js'

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

    it('resolves existing Unix paths with hyphenated directory names', async () => {
      const root = await mkdtemp(join(tmpdir(), 'reup-path-test-'))
      const projectPath = join(root, 'hyphen-name', 'nested-project')

      try {
        await mkdir(projectPath, { recursive: true })

        await expect(resolveProjectPath(encodeProjectPath(projectPath))).resolves.toBe(projectPath)
      } finally {
        await rm(root, { force: true, recursive: true })
      }
    })
  }
})

describe('isWindowsShortNameSegment', () => {
  it('recognizes conservative Windows 8.3 path aliases', () => {
    expect(isWindowsShortNameSegment('RUNNER~1')).toBe(true)
    expect(isWindowsShortNameSegment('PROGRA~2')).toBe(true)
    expect(isWindowsShortNameSegment('NODEJS~1.TMP')).toBe(true)
  })

  it('does not treat ordinary hyphenated project names as short aliases', () => {
    expect(isWindowsShortNameSegment('reup-loading-test')).toBe(false)
    expect(isWindowsShortNameSegment('slow-first-flush-workspace')).toBe(false)
    expect(isWindowsShortNameSegment('runner')).toBe(false)
  })
})
