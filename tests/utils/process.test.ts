import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'

import { readCurrentWorkingDirectory, tryChangeWorkingDirectory } from '../../src/utils/process.js'

describe('working directory helpers', () => {
  let originalWorkingDirectory: string
  let existingDirectory: string

  beforeEach(async () => {
    originalWorkingDirectory = process.cwd()
    existingDirectory = realpathSync(await mkdtemp(join(tmpdir(), 'reup-cwd-test-')))
  })

  afterEach(async () => {
    process.chdir(originalWorkingDirectory)
    vi.restoreAllMocks()
    await rm(existingDirectory, { force: true, recursive: true })
  })

  it('reports the current working directory', () => {
    expect(readCurrentWorkingDirectory()).toBe(originalWorkingDirectory)
  })

  it('moves into a directory that exists', () => {
    expect(tryChangeWorkingDirectory(existingDirectory)).toBe(true)
    expect(realpathSync(process.cwd())).toBe(existingDirectory)
  })

  /**
   * Reup surfaces sessions whose recorded project directory is gone as
   * `path-missing`, and both resume paths still let the user launch one. An
   * unguarded chdir turned that into an aborted launch with a raw libuv error.
   */
  it('stays in the current directory when the recorded path is gone', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(tryChangeWorkingDirectory(join(existingDirectory, 'deleted-last-week'))).toBe(false)
    expect(process.cwd()).toBe(originalWorkingDirectory)
  })

  it('explains the fallback rather than failing silently', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    tryChangeWorkingDirectory(join(existingDirectory, 'deleted-last-week'))

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('[reup:warn]'),
      expect.stringContaining('recorded project path is unavailable')
    )
  })

  it('treats an unrecorded path as nothing to do', () => {
    expect(tryChangeWorkingDirectory(undefined)).toBe(false)
    expect(process.cwd()).toBe(originalWorkingDirectory)
  })
})
