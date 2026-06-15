import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderMainHelp, runHelpCommand } from '../../src/cli/help-command.js'
import { runCli } from '../../src/cli/run-cli.js'

const PUBLIC_COMMANDS = [
  'cleanup',
  'completion',
  'config',
  'doctor',
  'handoff',
  'inbox',
  'list',
  'resume',
  'search',
  'sync',
  'usage',
  'web',
]

describe('CLI help', () => {
  afterEach(() => {
    process.exitCode = undefined
    vi.restoreAllMocks()
  })

  it('presents a concise product hierarchy', () => {
    const help = renderMainHelp(false)

    expect(help).toContain('Configuration')
    expect(help).toContain('swoop completion <shell>')
    expect(help).toContain('Experimental')
    expect(help).toContain('swoop sync [link|unlink] [path]')
    expect(help).not.toContain('swoop --theme')
  })

  it.each(PUBLIC_COMMANDS)('provides help for the public %s command', async (command) => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await runCli([command, '--help'])

    expect(log).toHaveBeenCalledOnce()
    expect(String(log.mock.calls[0][0])).toContain(`swoop ${command}`)
    expect(process.exitCode).toBeUndefined()
  })

  it('supports the help command and both conventional help flags', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await runCli(['help', 'sync'])
    await runCli(['help'])
    await runCli(['help', '--help'])
    await runCli(['-h'])

    expect(String(log.mock.calls[0][0])).toContain('experimental')
    expect(log).toHaveBeenCalledTimes(4)
    expect(process.exitCode).toBeUndefined()
  })

  it('keeps the theme shortcut out of the main help but documents it under config', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await runCli(['config', '--help'])

    expect(renderMainHelp(false)).not.toContain('swoop --theme')
    expect(String(log.mock.calls[0][0])).toContain('swoop --theme <dark|light|terminal>')
  })

  it('rejects unknown help topics cleanly', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    runHelpCommand(['unknown'])

    expect(error).toHaveBeenCalledWith('swoop: no help topic for: unknown')
    expect(process.exitCode).toBe(1)
  })
})
