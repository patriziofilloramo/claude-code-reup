import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import { APP } from '../../config/app.js'
import { getReupDirectory, getClaudeDirectory } from '../project/claude-paths.js'
import { clearLiveUsageSnapshots } from './live-usage.js'

const INTEGRATION_SCHEMA_VERSION = 1

interface StatusLineIntegration {
  hadPreviousStatusLine: boolean
  installedCommand: string
  previousStatusLine?: unknown
  schemaVersion: typeof INTEGRATION_SCHEMA_VERSION
}

type SetupResult =
  | { changed: true; command: string; replacedExisting: boolean }
  | { changed: false; reason: 'already-configured' }

type RemoveResult =
  | { changed: true; restoredPrevious: boolean }
  | { changed: false; reason: 'not-configured' }

interface StatusLineConfiguration {
  command: string
  refreshInterval: number
  type: 'command'
}

/** Installs Reup as the user-level Claude Code status line. */
export async function setupUsageStatusLine(replaceExisting = false): Promise<SetupResult> {
  const settings = await readJsonObject(getSettingsPath())
  const integration = await readIntegration()
  const installedCommand = captureCommand()
  const installedStatusLine = createInstalledStatusLine(installedCommand)
  const currentCommand = statusLineCommand(settings['statusLine'])
  const ownsCurrentStatusLine =
    integration !== null && currentCommand === integration.installedCommand

  if (
    ownsCurrentStatusLine &&
    integration.installedCommand === installedCommand &&
    isInstalledStatusLine(settings['statusLine'], installedStatusLine)
  ) {
    return { changed: false, reason: 'already-configured' }
  }
  if (!ownsCurrentStatusLine && settings['statusLine'] !== undefined && !replaceExisting) {
    throw new Error(
      'an existing Claude Code status line is configured; rerun with --replace to preserve and temporarily replace it'
    )
  }

  const hadPreviousStatusLine = ownsCurrentStatusLine
    ? integration.hadPreviousStatusLine
    : settings['statusLine'] !== undefined
  const previousStatusLine = ownsCurrentStatusLine
    ? integration.previousStatusLine
    : settings['statusLine']
  const nextIntegration: StatusLineIntegration = {
    hadPreviousStatusLine,
    installedCommand,
    ...(hadPreviousStatusLine ? { previousStatusLine } : {}),
    schemaVersion: INTEGRATION_SCHEMA_VERSION,
  }
  await writeJsonAtomically(getIntegrationPath(), nextIntegration)

  try {
    settings['statusLine'] = installedStatusLine
    await writeJsonAtomically(getSettingsPath(), settings)
  } catch (error) {
    if (integration) await writeJsonAtomically(getIntegrationPath(), integration)
    else await unlink(getIntegrationPath()).catch(() => {})
    throw error
  }
  return { changed: true, command: installedCommand, replacedExisting: hadPreviousStatusLine }
}

/** Returns true when Reup's usage capture is the active Claude Code status line. */
export async function isUsageStatusLineConfigured(): Promise<boolean> {
  const integration = await readIntegration()
  if (!integration) return false
  const settings = await readJsonObject(getSettingsPath())
  return statusLineCommand(settings['statusLine']) === integration.installedCommand
}

/** Restores the exact status-line value saved during setup. */
export async function removeUsageStatusLine(): Promise<RemoveResult> {
  const integration = await readIntegration()
  if (!integration) return { changed: false, reason: 'not-configured' }

  const settings = await readJsonObject(getSettingsPath())
  if (statusLineCommand(settings['statusLine']) !== integration.installedCommand) {
    throw new Error('Claude Code statusLine changed after Reup setup; refusing to overwrite it')
  }

  if (integration.hadPreviousStatusLine) settings['statusLine'] = integration.previousStatusLine
  else delete settings['statusLine']

  await writeJsonAtomically(getSettingsPath(), settings)
  await unlink(getIntegrationPath()).catch(() => {})
  await clearLiveUsageSnapshots()
  return { changed: true, restoredPrevious: integration.hadPreviousStatusLine }
}

function captureCommand(): string {
  // Claude Code may run Windows status lines through Git Bash; forward slashes
  // keep the same command valid there and in PowerShell.
  const entryPoint = resolve(process.argv[1]).replaceAll('\\', '/')
  return `node "${entryPoint}" usage capture`
}

function createInstalledStatusLine(command: string): StatusLineConfiguration {
  return {
    command,
    refreshInterval: APP.usageCaptureRefreshSeconds,
    type: 'command',
  }
}

function getSettingsPath(): string {
  return join(getClaudeDirectory(), 'settings.json')
}

function getIntegrationPath(): string {
  return join(getReupDirectory(), 'statusline-integration.json')
}

async function readIntegration(): Promise<StatusLineIntegration | null> {
  try {
    const parsed = parseJson(await readFile(getIntegrationPath(), 'utf8'))
    if (
      isRecord(parsed) &&
      parsed['schemaVersion'] === INTEGRATION_SCHEMA_VERSION &&
      typeof parsed['hadPreviousStatusLine'] === 'boolean' &&
      typeof parsed['installedCommand'] === 'string'
    ) {
      return parsed as unknown as StatusLineIntegration
    }
    return null
  } catch {
    return null
  }
}

async function readJsonObject(path: string): Promise<Record<string, unknown>> {
  try {
    const parsed = parseJson(await readFile(path, 'utf8'))
    if (!isRecord(parsed)) throw new Error(`${path} must contain a JSON object`)
    return parsed
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw new Error(
      `cannot read Claude Code settings: ${error instanceof Error ? error.message : error}`,
      { cause: error }
    )
  }
}

async function writeJsonAtomically(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, JSON.stringify(value, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    })
    await rename(temporaryPath, path)
  } finally {
    await unlink(temporaryPath).catch(() => {})
  }
}

function statusLineCommand(value: unknown): string | undefined {
  return isRecord(value) && typeof value['command'] === 'string' ? value['command'] : undefined
}

function isInstalledStatusLine(
  value: unknown,
  installedStatusLine: StatusLineConfiguration
): boolean {
  return (
    isRecord(value) &&
    value['command'] === installedStatusLine.command &&
    value['refreshInterval'] === installedStatusLine.refreshInterval &&
    value['type'] === installedStatusLine.type
  )
}

function parseJson(contents: string): unknown {
  return JSON.parse(contents.replace(/^\uFEFF/, '')) as unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
