/**
 * Tests for the Windows terminal launcher.
 *
 * All external process spawning (execFile, which, clipboardy) is stubbed so
 * tests run on any platform. The primary goal is to verify argument structure:
 * that paths and command parts are passed as discrete argv elements rather than
 * interpolated into a shell string.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'

// vi.hoisted variables are available inside the vi.mock factory (hoisted alongside it).
const { mockExecFile, mockSpawn, mockWhich, mockClipboardyWrite } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
  mockSpawn: vi.fn(),
  mockWhich: vi.fn(),
  mockClipboardyWrite: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, execFile: mockExecFile, spawn: mockSpawn }
})
vi.mock('which', () => ({ default: mockWhich }))
vi.mock('clipboardy', () => ({ default: { write: mockClipboardyWrite } }))

import { launchWindows } from '../../src/core/terminal/terminal-windows.js'

// Helpers -----------------------------------------------------------------

// The launcher calls execFile both as (cmd, args, cb) and (cmd, args, opts, cb),
// so the promisified callback is always the last argument.
function lastArg(args: unknown[]): (err: Error | null) => void {
  return args[args.length - 1] as (err: Error | null) => void
}

/** Makes execFile invoke its callback with null (success). */
function execFileSucceeds(): void {
  mockExecFile.mockImplementation((...args: unknown[]) => lastArg(args)(null))
}

/** Makes the Nth execFile call fail with an error, all others succeed. */
function execFileFailsOnCall(n: number): void {
  let calls = 0
  mockExecFile.mockImplementation((...args: unknown[]) => {
    calls++
    lastArg(args)(calls === n ? new Error('spawn failed') : null)
  })
}

/** Makes every execFile call fail. */
function execFileAlwaysFails(): void {
  mockExecFile.mockImplementation((...args: unknown[]) => lastArg(args)(new Error('spawn failed')))
}

/** Returns the options object ({ env, … }) from the Nth execFile call, if any. */
function execCallOptions(n: number): { env?: Record<string, string | undefined> } | undefined {
  const candidate = mockExecFile.mock.calls[n][2]
  return candidate && typeof candidate === 'object' && !Array.isArray(candidate)
    ? (candidate as { env?: Record<string, string | undefined> })
    : undefined
}

function spawnSucceeds(): void {
  mockSpawn.mockImplementation(() => {
    const child = new EventEmitter() as EventEmitter & { unref: () => void }
    child.unref = vi.fn()
    queueMicrotask(() => child.emit('spawn'))
    return child
  })
}

function spawnFails(): void {
  mockSpawn.mockImplementation(() => {
    const child = new EventEmitter() as EventEmitter & { unref: () => void }
    child.unref = vi.fn()
    queueMicrotask(() => child.emit('error', new Error('spawn failed')))
    return child
  })
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
  mockSpawn.mockReset()
  mockWhich.mockReset()
  mockClipboardyWrite.mockReset().mockResolvedValue(undefined)
  // Default: wt not available
  delete process.env['WT_SESSION']
  mockWhich.mockRejectedValue(new Error('not found'))
  spawnSucceeds()
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

  it('keeps the -Command script static and carries the command via an env var', async () => {
    await launchWindows('claude --resume abc-123', undefined)

    const cmdIdx = execCallArgs(0).indexOf('-Command')
    const script = execCallArgs(0)[cmdIdx + 1]
    // No user data interpolated into the script — only an $env reference.
    expect(script).toContain('$env:REUP_LAUNCH_CMD')
    expect(script).not.toContain('claude')
    expect(execCallOptions(0)?.env?.REUP_LAUNCH_CMD).toBe('claude --resume abc-123')
  })

  it('references -WorkingDirectory via $env and carries the raw path in the env var', async () => {
    await launchWindows('claude', 'C:\\Projects\\App')

    const cmdIdx = execCallArgs(0).indexOf('-Command')
    expect(execCallArgs(0)[cmdIdx + 1]).toContain('-WorkingDirectory $env:REUP_LAUNCH_CWD')
    expect(execCallOptions(0)?.env?.REUP_LAUNCH_CWD).toBe('C:\\Projects\\App')
  })

  it('passes the working directory unescaped (no manual quote-doubling)', async () => {
    await launchWindows('claude', "C:\\John's Projects")

    const cmdIdx = execCallArgs(0).indexOf('-Command')
    // The path never touches the script string, so it is never escaped there.
    expect(execCallArgs(0)[cmdIdx + 1]).not.toContain("John's")
    expect(execCallOptions(0)?.env?.REUP_LAUNCH_CWD).toBe("C:\\John's Projects")
  })

  it('omits -WorkingDirectory from the script when no directory is given', async () => {
    await launchWindows('claude', undefined)

    const cmdIdx = execCallArgs(0).indexOf('-Command')
    expect(execCallArgs(0)[cmdIdx + 1]).not.toContain('-WorkingDirectory')
  })
})

// -------------------------------------------------------------------------
// Detached cmd path
// -------------------------------------------------------------------------

describe('detached cmd path', () => {
  it('falls through to a detached cmd when PowerShell fails', async () => {
    execFileFailsOnCall(1)

    const result = await launchWindows('claude --resume abc-123', undefined)

    expect(result).toMatchObject({ launched: true })
    expect(mockSpawn).toHaveBeenCalledWith(
      'cmd.exe',
      ['/k', 'claude', '--resume', 'abc-123'],
      expect.objectContaining({ detached: true })
    )
  })

  it('passes workingDirectory as the process cwd', async () => {
    execFileFailsOnCall(1)

    await launchWindows('claude', 'C:\\My Projects & Tools\\App')

    expect(mockSpawn).toHaveBeenCalledWith(
      'cmd.exe',
      ['/k', 'claude'],
      expect.objectContaining({ cwd: 'C:\\My Projects & Tools\\App' })
    )
  })
})

// -------------------------------------------------------------------------
// Fallback chain
// -------------------------------------------------------------------------

describe('fallback chain', () => {
  it('returns clipboard fallback when all launchers fail', async () => {
    execFileAlwaysFails()
    spawnFails()

    const result = await launchWindows('claude --resume abc-123', undefined)

    expect(result).toMatchObject({ launched: false, copied: true })
    expect(mockClipboardyWrite).toHaveBeenCalledWith('claude --resume abc-123')
  })

  it('includes workingDirectory in the clipboard fallback command', async () => {
    execFileAlwaysFails()
    spawnFails()

    await launchWindows('claude', 'C:\\Projects\\App')

    expect(mockClipboardyWrite).toHaveBeenCalledWith(expect.stringContaining('C:\\Projects\\App'))
  })

  it('records error messages from each failed attempt', async () => {
    execFileAlwaysFails()
    spawnFails()

    const result = await launchWindows('claude', undefined)

    expect(result.message).toContain('ps5:')
    expect(result.message).toContain('cmd:')
  })
})
