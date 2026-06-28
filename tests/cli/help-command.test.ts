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
    expect(help).toContain('reup completion <shell>')
    expect(help).toContain('Features')
    expect(help).toContain('reup sync [link|unlink|status] [path]')
    expect(help).not.toContain('reup --theme')
  })

  it.each(PUBLIC_COMMANDS)('provides help for the public %s command', async (command) => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await runCli([command, '--help'])

    expect(log).toHaveBeenCalledOnce()
    expect(String(log.mock.calls[0][0])).toContain(`reup ${command}`)
    expect(process.exitCode).toBeUndefined()
  })

  it('supports the help command and both conventional help flags', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await runCli(['help', 'sync'])
    await runCli(['help'])
    await runCli(['help', '--help'])
    await runCli(['-h'])

    expect(String(log.mock.calls[0][0])).toContain('cross-device session storage (Alpha)')
    expect(log).toHaveBeenCalledTimes(4)
    expect(process.exitCode).toBeUndefined()
  })

  it('keeps the theme shortcut out of the main help but documents it under config', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await runCli(['config', '--help'])

    expect(renderMainHelp(false)).not.toContain('reup --theme')
    expect(String(log.mock.calls[0][0])).toContain('reup --theme <dark|light|terminal>')
  })

  it('documents organization filters for list', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await runCli(['list', '--help'])

    const help = String(log.mock.calls[0][0])
    expect(help).toContain('--tag <name>')
    expect(help).toContain('--group <name>')
    expect(help).toContain('--stack <name>')
  })

  it('rejects unknown help topics cleanly', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    runHelpCommand(['unknown'])

    expect(error).toHaveBeenCalledWith('reup: no help topic for: unknown')
    expect(process.exitCode).toBe(1)
  })
})
