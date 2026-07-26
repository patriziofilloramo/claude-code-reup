import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { copyLaunchCommand, executeShellCommand, which } = vi.hoisted(() => ({
  copyLaunchCommand: vi.fn(),
  executeShellCommand: vi.fn(),
  which: vi.fn(),
}))

vi.mock('which', () => ({ default: which }))
vi.mock('../../src/core/terminal/terminal-shared.js', () => ({
  copyLaunchCommand,
  executeShellCommand,
  successfulLaunch: () => ({ copied: false, launched: true }),
}))

import { launchUnix } from '../../src/core/terminal/terminal-unix.js'

describe('Unix terminal launcher', () => {
  let previousTermProgram: string | undefined
  let previousTmux: string | undefined

  beforeEach(() => {
    previousTermProgram = process.env.TERM_PROGRAM
    previousTmux = process.env.TMUX
    delete process.env.TERM_PROGRAM
    delete process.env.TMUX
    copyLaunchCommand.mockReset()
    executeShellCommand.mockReset().mockResolvedValue(undefined)
    which.mockReset()
  })

  afterEach(() => {
    if (previousTermProgram === undefined) delete process.env.TERM_PROGRAM
    else process.env.TERM_PROGRAM = previousTermProgram
    if (previousTmux === undefined) delete process.env.TMUX
    else process.env.TMUX = previousTmux
  })

  it.each(['ghostty', 'kitty', 'xterm'])(
    'changes directory inside the %s fallback command',
    async (availableEmulator) => {
      which.mockImplementation(async (name: string) => {
        if (name === availableEmulator) return `/usr/bin/${name}`
        throw new Error('not installed')
      })

      await expect(launchUnix('claude --resume session-id', "/work/Pat's app")).resolves.toEqual({
        copied: false,
        launched: true,
      })

      const launchedCommand = String(executeShellCommand.mock.calls[0]?.[0])
      expect(launchedCommand).toContain('cd ')
      expect(launchedCommand).toContain('claude --resume session-id')
      expect(launchedCommand).toContain('Pat')
      expect(copyLaunchCommand).not.toHaveBeenCalled()
    }
  )
})
