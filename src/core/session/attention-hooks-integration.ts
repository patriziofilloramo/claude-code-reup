import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import { getClaudeDirectory, getReupDirectory } from '../project/claude-paths.js'
import { clearAllAttentionMarkers } from './attention.js'

const INTEGRATION_SCHEMA_VERSION = 1
/** Generous bound so a slow disk never stalls Claude Code's notification path. */
const HOOK_TIMEOUT_SECONDS = 10

interface AttentionHookIntegration {
  installedCommand: string
  schemaVersion: typeof INTEGRATION_SCHEMA_VERSION
}

type SetupResult =
  | { changed: true; command: string }
  | { changed: false; reason: 'already-configured' }

type RemoveResult = { changed: true } | { changed: false; reason: 'not-configured' }

/**
 * Registers Reup's capture command as a Claude Code `Notification` hook.
 *
 * Unlike the status line (a single owned value), hooks are additive lists, so
 * setup only ever appends Reup's own entry and removal only ever filters that
 * exact entry back out — other hooks the user configured are never touched.
 */
export async function setupAttentionHook(): Promise<SetupResult> {
  const settings = await readJsonObject(getSettingsPath())
  const installedCommand = captureCommand()

  const notificationHooks = readNotificationHooks(settings)
  if (findReupEntryIndex(notificationHooks, installedCommand) !== -1) {
    await writeIntegration(installedCommand)
    return { changed: false, reason: 'already-configured' }
  }

  // A stale entry from a previous install location is replaced, not stacked.
  const previousIntegration = await readIntegration()
  const withoutStaleEntries = previousIntegration
    ? notificationHooks.filter(
        (entry) => !isReupHookEntry(entry, previousIntegration.installedCommand)
      )
    : notificationHooks

  const hooks = isRecord(settings['hooks']) ? settings['hooks'] : {}
  hooks['Notification'] = [...withoutStaleEntries, createReupHookEntry(installedCommand)]
  settings['hooks'] = hooks

  await writeIntegration(installedCommand)
  try {
    await writeJsonAtomically(getSettingsPath(), settings)
  } catch (error) {
    await unlink(getIntegrationPath()).catch(() => {})
    throw error
  }
  return { changed: true, command: installedCommand }
}

/** True when Reup's capture command is currently registered as a Notification hook. */
export async function isAttentionHookConfigured(): Promise<boolean> {
  const integration = await readIntegration()
  if (!integration) return false
  const settings = await readJsonObject(getSettingsPath())
  return findReupEntryIndex(readNotificationHooks(settings), integration.installedCommand) !== -1
}

/** Removes exactly Reup's hook entry and clears captured markers. */
export async function removeAttentionHook(): Promise<RemoveResult> {
  const integration = await readIntegration()
  if (!integration) return { changed: false, reason: 'not-configured' }

  const settings = await readJsonObject(getSettingsPath())
  const notificationHooks = readNotificationHooks(settings)
  const remaining = notificationHooks.filter(
    (entry) => !isReupHookEntry(entry, integration.installedCommand)
  )

  if (remaining.length !== notificationHooks.length) {
    const hooks = isRecord(settings['hooks']) ? settings['hooks'] : {}
    if (remaining.length > 0) hooks['Notification'] = remaining
    else delete hooks['Notification']
    if (Object.keys(hooks).length > 0) settings['hooks'] = hooks
    else delete settings['hooks']
    await writeJsonAtomically(getSettingsPath(), settings)
  }

  await unlink(getIntegrationPath()).catch(() => {})
  await clearAllAttentionMarkers()
  return { changed: true }
}

function captureCommand(): string {
  // Claude Code may run Windows hooks through Git Bash; forward slashes keep
  // the same command valid there and in PowerShell.
  const entryPoint = resolve(process.argv[1]).replaceAll('\\', '/')
  return `node "${entryPoint}" attention capture`
}

function createReupHookEntry(command: string): Record<string, unknown> {
  return { hooks: [{ command, timeout: HOOK_TIMEOUT_SECONDS, type: 'command' }] }
}

function readNotificationHooks(settings: Record<string, unknown>): Record<string, unknown>[] {
  const hooks = settings['hooks']
  if (!isRecord(hooks)) return []
  const notification = hooks['Notification']
  if (!Array.isArray(notification)) return []
  return notification.filter(isRecord)
}

function findReupEntryIndex(entries: Record<string, unknown>[], command: string): number {
  return entries.findIndex((entry) => isReupHookEntry(entry, command))
}

function isReupHookEntry(entry: Record<string, unknown>, command: string): boolean {
  const commands = entry['hooks']
  if (!Array.isArray(commands)) return false
  return commands.some((hook) => isRecord(hook) && hook['command'] === command)
}

function getSettingsPath(): string {
  return join(getClaudeDirectory(), 'settings.json')
}

function getIntegrationPath(): string {
  return join(getReupDirectory(), 'attention-integration.json')
}

async function writeIntegration(installedCommand: string): Promise<void> {
  await writeJsonAtomically(getIntegrationPath(), {
    installedCommand,
    schemaVersion: INTEGRATION_SCHEMA_VERSION,
  } satisfies AttentionHookIntegration)
}

async function readIntegration(): Promise<AttentionHookIntegration | null> {
  try {
    const parsed = parseJson(await readFile(getIntegrationPath(), 'utf8'))
    if (
      isRecord(parsed) &&
      parsed['schemaVersion'] === INTEGRATION_SCHEMA_VERSION &&
      typeof parsed['installedCommand'] === 'string'
    ) {
      return parsed as unknown as AttentionHookIntegration
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

function parseJson(contents: string): unknown {
  return JSON.parse(contents.replace(/^\uFEFF/, '')) as unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
