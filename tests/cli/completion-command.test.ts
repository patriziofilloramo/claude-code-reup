import { afterEach, describe, expect, it, vi } from 'vitest'

import { printCompletionScript } from '../../src/cli/completion-command.js'

describe('completion command', () => {
  afterEach(() => {
    process.exitCode = undefined
    vi.restoreAllMocks()
  })

  it.each(['powershell', 'bash', 'zsh'])('prints a %s registration script', (shell) => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    printCompletionScript([shell])

    expect(String(log.mock.calls[0][0])).toContain('__complete-session-ids')
    expect(String(log.mock.calls[0][0])).toContain('resume')
    expect(String(log.mock.calls[0][0])).toContain('handoff')
    expect(process.exitCode).toBeUndefined()
  })

  it('preserves Swoop relevance ordering in shells that sort completion results', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    printCompletionScript(['bash'])
    expect(String(log.mock.calls[0][0])).toContain('compopt -o nosort')
    expect(String(log.mock.calls[0][0])).not.toContain('mapfile')

    printCompletionScript(['zsh'])
    expect(String(log.mock.calls[1][0])).toContain('compadd -V swoop-sessions')
  })

  it('rejects unsupported shells', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    printCompletionScript(['fish'])

    expect(error).toHaveBeenCalledWith('swoop: usage: swoop completion <powershell|bash|zsh>')
    expect(process.exitCode).toBe(1)
  })
})
