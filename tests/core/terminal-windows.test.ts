/**
 * Tests for the Windows terminal launcher.
 *
 * All external process spawning (execFile, which, clipboardy) is stubbed so
 * tests run on any platform. The primary goal is to verify argument structure:
 * that paths and command parts are passed as discrete argv elements rather than
 * interpolated into a shell string.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// vi.hoisted variables are available inside the vi.mock factory (hoisted alongside it).
const { mockExecFile, mockWhich, mockClipboardyWrite } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
  mockWhich: vi.fn(),
  mockClipboardyWrite: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, execFile: mockExecFile }
})
vi.mock('which', () => ({ default: mockWhich }))
vi.mock('clipboardy', () => ({ default: { write: mockClipboardyWrite } }))

import { launchWindows } from '../../src/core/terminal-windows.js'

// Helpers -----------------------------------------------------------------

/** Makes execFile invoke its callback with null (success). */
function execFileSucceeds(): void {
  mockExecFile.mockImplementation(
    (_cmd: string, _args: string[], callback: (err: Error | null) => void) => {
      callback(null)
    }
  )
}

/** Makes the Nth execFile call fail with an error, all others succeed. */
function execFileFailsOnCall(n: number): void {
  let calls = 0
  mockExecFile.mockImplementation(
    (_cmd: string, _args: string[], callback: (err: Error | null) => void) => {
      calls++
      callback(calls === n ? new Error('spawn failed') : null)
    }
  )
}

/** Returns the args array from the Nth execFile call (0-indexed). */
function execCallArgs(n: number): string[] {
  return mockExecFile.mock.calls[n][1] as string[]
}

/** Returns the command (first arg) from the Nth execFile call. */
function execCallCmd(n: number): string {
  return mockExecFile.mock.calls[n][0] as string
}

// Setup -------------------------------------------------------------------

beforeEach(() => {
  mockExecFile.mockReset()
  mockWhich.mockReset()
  mockClipboardyWrite.mockReset().mockResolvedValue(undefined)
  // Default: wt not available
  delete process.env['WT_SESSION']
  mockWhich.mockRejectedValue(new Error('not found'))
})

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env['WT_SESSION']
})

// -------------------------------------------------------------------------
// Windows Terminal (wt)
// -------------------------------------------------------------------------

describe('Windows Terminal path', () => {
  beforeEach(() => {
    process.env['WT_SESSION'] = '1'
    execFileSucceeds()
  })

  it('calls wt with new-tab and the command as separate args', async () => {
    const result = await launchWindows('claude --resume abc-123', undefined)

    expect(result).toMatchObject({ launched: true })
    expect(execCallCmd(0)).toBe('wt')
    expect(execCallArgs(0)).toEqual(['new-tab', '--', 'cmd', '/k', 'claude', '--resume', 'abc-123'])
  })

  it('passes --startingDirectory as a separate arg (no shell quoting)', async () => {
    await launchWindows('claude', 'C:\\My Projects\\App')

    expect(execCallArgs(0)).toContain('--startingDirectory')
    const startIdx = execCallArgs(0).indexOf('--startingDirectory')
    expect(execCallArgs(0)[startIdx + 1]).toBe('C:\\My Projects\\App')
  })

  it('omits --startingDirectory when workingDirectory is undefined', async () => {
    await launchWindows('claude', undefined)

    expect(execCallArgs(0)).not.toContain('--startingDirectory')
  })
})

// -------------------------------------------------------------------------
// PowerShell path
// -------------------------------------------------------------------------

describe('PowerShell path', () => {
  beforeEach(() => {
    execFileSucceeds()
  })

  it('calls powershell.exe with -Command as a direct argv element', async () => {
    const result = await launchWindows('claude --resume abc-123', undefined)

    expect(result).toMatchObject({ launched: true })
    expect(execCallCmd(0)).toBe('powershell.exe')
    expect(execCallArgs(0)).toContain('-NoProfile')
    expect(execCallArgs(0)).toContain('-NonInteractive')
    expect(execCallArgs(0)).toContain('-Command')
  })

  it('-Command arg contains the claude command', async () => {
    await launchWindows('claude --resume abc-123', undefined)

    const cmdIdx = execCallArgs(0).indexOf('-Command')
    expect(execCallArgs(0)[cmdIdx + 1]).toContain('claude --resume abc-123')
  })

  it('includes -WorkingDirectory in the PS command string when provided', async () => {
    await launchWindows('claude', 'C:\\Projects\\App')

    const cmdIdx = execCallArgs(0).indexOf('-Command')
    expect(execCallArgs(0)[cmdIdx + 1]).toContain('-WorkingDirectory')
    expect(execCallArgs(0)[cmdIdx + 1]).toContain('C:\\Projects\\App')
  })

  it('escapes single quotes in workingDirectory for PowerShell', async () => {
    await launchWindows('claude', "C:\\John's Projects")

    const cmdIdx = execCallArgs(0).indexOf('-Command')
    // Single quote in PS strings must be doubled: ' → ''
    expect(execCallArgs(0)[cmdIdx + 1]).toContain("John''s Projects")
  })
})

// -------------------------------------------------------------------------
// cmd /c start path
// -------------------------------------------------------------------------

describe('cmd start path', () => {
  it('falls through to cmd when powershell fails', async () => {
    execFileFailsOnCall(1)  // first call (powershell) fails, second (cmd) succeeds

    const result = await launchWindows('claude --resume abc-123', undefined)

    expect(result).toMatchObject({ launched: true })
    expect(execCallCmd(1)).toBe('cmd')
    expect(execCallArgs(1)).toContain('/c')
    expect(execCallArgs(1)).toContain('start')
  })

  it('passes workingDirectory as separate /d arg', async () => {
    execFileFailsOnCall(1)

    await launchWindows('claude', 'C:\\My Projects\\App')

    expect(execCallArgs(1)).toContain('/d')
    const dIdx = execCallArgs(1).indexOf('/d')
    expect(execCallArgs(1)[dIdx + 1]).toBe('C:\\My Projects\\App')
  })
})

// -------------------------------------------------------------------------
// Fallback chain
// -------------------------------------------------------------------------

describe('fallback chain', () => {
  it('returns clipboard fallback when all launchers fail', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], callback: (err: Error | null) => void) => {
        callback(new Error('spawn failed'))
      }
    )

    const result = await launchWindows('claude --resume abc-123', undefined)

    expect(result).toMatchObject({ launched: false, copied: true })
    expect(mockClipboardyWrite).toHaveBeenCalledWith('claude --resume abc-123')
  })

  it('includes workingDirectory in the clipboard fallback command', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], callback: (err: Error | null) => void) => {
        callback(new Error('spawn failed'))
      }
    )

    await launchWindows('claude', 'C:\\Projects\\App')

    expect(mockClipboardyWrite).toHaveBeenCalledWith(
      expect.stringContaining('C:\\Projects\\App')
    )
  })

  it('records error messages from each failed attempt', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], callback: (err: Error | null) => void) => {
        callback(new Error('spawn failed'))
      }
    )

    const result = await launchWindows('claude', undefined)

    expect(result.message).toContain('ps5:')
    expect(result.message).toContain('start:')
  })
})
