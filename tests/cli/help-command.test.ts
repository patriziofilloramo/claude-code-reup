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
  'touched',
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
    expect(help).toContain('Maintenance')
    expect(help).not.toContain('reup sync')
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

    await runCli(['help'])
    await runCli(['help', '--help'])
    await runCli(['-h'])

    expect(String(log.mock.calls[0][0])).toContain('session manager for Claude Code')
    expect(log).toHaveBeenCalledTimes(3)
    expect(process.exitCode).toBeUndefined()
  })

  it('does not expose a sync help topic', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    runHelpCommand(['sync'])

    expect(error).toHaveBeenCalledWith('reup: no help topic for: sync')
    expect(process.exitCode).toBe(1)
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

  it('keeps usage help focused on status and JSON output', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await runCli(['usage', '--help'])

    const help = String(log.mock.calls[0][0])
    expect(help).toContain('reup usage --json')
    expect(help).toContain('setup/remove manage the optional')
    expect(help).not.toContain('reup usage toggle')
  })

  it('rejects unknown help topics cleanly', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    runHelpCommand(['unknown'])

    expect(error).toHaveBeenCalledWith('reup: no help topic for: unknown')
    expect(process.exitCode).toBe(1)
  })
})
