import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { releaseTerminalInput, runConfigApp } = vi.hoisted(() => ({
  releaseTerminalInput: vi.fn(),
  runConfigApp: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../src/tui/terminal-input.js', () => ({ releaseTerminalInput }))
vi.mock('../../src/tui/ConfigApp.js', () => ({ runConfigApp }))

import { openConfigInterface } from '../../src/cli/open-config-interface.js'

describe('openConfigInterface', () => {
  let originalStdinIsTTY: boolean | undefined
  let originalStdoutIsTTY: boolean | undefined

  beforeEach(() => {
    originalStdinIsTTY = process.stdin.isTTY
    originalStdoutIsTTY = process.stdout.isTTY
  })

  afterEach(() => {
    setTTYState(originalStdinIsTTY, originalStdoutIsTTY)
    process.exitCode = undefined
    vi.restoreAllMocks()
    releaseTerminalInput.mockClear()
    runConfigApp.mockClear()
  })

  it('opens the requested tab after releasing terminal input', async () => {
    setTTYState(true, true)

    await openConfigInterface({ commandName: 'swoop sync', initialTab: 'Experimental' })

    expect(releaseTerminalInput).toHaveBeenCalledOnce()
    expect(runConfigApp).toHaveBeenCalledWith({ initialTab: 'Experimental' })
    expect(process.exitCode).toBeUndefined()
  })

  it('fails predictably without loading Ink outside an interactive terminal', async () => {
    setTTYState(false, false)
    const writeError = vi.spyOn(console, 'error').mockImplementation(() => {})

    await openConfigInterface({
      commandName: 'swoop config',
      nonInteractiveAlternative: 'use `swoop config get` in scripts',
    })

    expect(process.exitCode).toBe(1)
    expect(writeError).toHaveBeenCalledWith(
      'swoop: swoop config requires an interactive terminal; use `swoop config get` in scripts'
    )
    expect(releaseTerminalInput).not.toHaveBeenCalled()
    expect(runConfigApp).not.toHaveBeenCalled()
  })
})

function setTTYState(stdinIsTTY: boolean | undefined, stdoutIsTTY: boolean | undefined): void {
  Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: stdinIsTTY })
  Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: stdoutIsTTY })
}
