import { randomUUID } from 'node:crypto'
import { access, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import { getClaudeDirectory, getReupDirectory } from '../project/claude-paths.js'
import { withReupSettingsLock } from '../project/claude-settings-lock.js'
import { clearAllAttentionMarkers, clearAllWorkSignalMarkers } from './attention.js'

const INTEGRATION_SCHEMA_VERSION = 1
/** Generous bound so a slow disk never stalls Claude Code's notification path. */
const HOOK_TIMEOUT_SECONDS = 10
/**
 * Every hook event Reup listens to, all pointing at the same capture command:
 * Notification carries needs-input alerts; UserPromptSubmit and Stop carry the
 * turn boundaries that give busy/idle state independent of lock-file fields.
 */
const HOOK_EVENTS = ['Notification', 'Stop', 'UserPromptSubmit'] as const

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
  return withReupSettingsLock(async () => {
    const settings = await readJsonObject(getSettingsPath())
    const installedCommand = captureCommand()
    const previousIntegration = await readIntegration()

    let changed = false
    for (const hookEvent of HOOK_EVENTS) {
      const eventHooks = readEventHooks(settings, hookEvent)
      if (findReupEntryIndex(eventHooks, installedCommand) !== -1) continue

      // A stale entry from a previous install location is replaced, not stacked.
      const withoutStaleEntries = previousIntegration
        ? eventHooks.filter(
            (entry) => !isReupHookEntry(entry, previousIntegration.installedCommand)
          )
        : eventHooks

      const hooks = isRecord(settings['hooks']) ? settings['hooks'] : {}
      hooks[hookEvent] = [...withoutStaleEntries, createReupHookEntry(installedCommand)]
      settings['hooks'] = hooks
      changed = true
    }

    await writeIntegration(installedCommand)
    if (!changed) return { changed: false, reason: 'already-configured' }
    try {
      await writeJsonAtomically(getSettingsPath(), settings)
    } catch (error) {
      if (previousIntegration) await writeIntegration(previousIntegration.installedCommand)
      else await unlink(getIntegrationPath()).catch(() => {})
      throw error
    }
    return { changed: true, command: installedCommand }
  })
}

/**
 * How Reup's hooks actually stand, which is not the same question as whether
 * they are registered.
 *
 * A hook entry names a script by absolute path. If that path stops resolving —
 * the install was moved or removed, or it lived on a drive that is no longer
 * mounted — Claude Code still runs the command, node still fails, and nothing
 * anywhere reports it. Every turn boundary and every needs-input alert is then
 * silently lost, and all surfaces fall back to guessing from transcript
 * recency. Observed on a real machine: three weeks of hooks registered and
 * dead, with `status` cheerfully reporting them configured.
 */
export type AttentionHookHealth =
  | { state: 'not-configured' }
  /** Registered, and the script it points at exists. */
  | { state: 'ready'; command: string }
  /** Registered, but the script is gone: hooks are running and failing. */
  | { state: 'broken'; command: string; missingPath: string }

/**
 * Checks that Reup's hooks are registered *and* that what they point at is
 * still there. Only the second half can catch a dead install.
 */
export async function inspectAttentionHookHealth(): Promise<AttentionHookHealth> {
  const integration = await readIntegration()
  if (!integration || !(await isAttentionHookConfigured())) return { state: 'not-configured' }

  const scriptPath = hookScriptPath(integration.installedCommand)
  if (scriptPath === null) return { state: 'ready', command: integration.installedCommand }
  try {
    await access(scriptPath)
  } catch {
    return {
      command: integration.installedCommand,
      missingPath: scriptPath,
      state: 'broken',
    }
  }
  return { state: 'ready', command: integration.installedCommand }
}

/**
 * Repoints Reup's own hook entries at the running install when the ones on
 * disk name a script that no longer exists. Returns true only if it repaired.
 *
 * The absolute path in a hook entry goes stale for ordinary reasons — a Node
 * version manager moves the npm global root, an installer changes location —
 * and the failure is silent, so waiting for the user to notice means weeks of
 * degraded state. This maintains an entry the user already consented to,
 * rather than adding one: if the hooks were never set up, it does nothing.
 *
 * Best-effort by contract. It is called on ordinary startup paths, so any
 * failure must leave the surface running rather than surfacing an error.
 */
export async function repairAttentionHookIfBroken(): Promise<boolean> {
  try {
    const health = await inspectAttentionHookHealth()
    if (health.state !== 'broken') return false
    // Pointless if this install cannot name itself either — a temporary or
    // deleted path would just replace one dead entry with another.
    const ownPath = hookScriptPath(captureCommand())
    if (ownPath === null) return false
    try {
      await access(ownPath)
    } catch {
      return false
    }
    return (await setupAttentionHook()).changed
  } catch {
    return false
  }
}

/**
 * The script path inside a capture command, or null when the command does not
 * have the shape `captureCommand()` produces. Returning null means "cannot
 * check", never "fine": a command Reup did not write is not Reup's to judge.
 */
export function hookScriptPath(command: string): string | null {
  const match = /^node\s+"([^"]+)"\s+attention\s+capture$/.exec(command.trim())
  return match?.[1] ?? null
}

/** True when Reup's capture command is registered for every hook event it needs. */
export async function isAttentionHookConfigured(): Promise<boolean> {
  const integration = await readIntegration()
  if (!integration) return false
  const settings = await readJsonObject(getSettingsPath())
  return HOOK_EVENTS.every(
    (hookEvent) =>
      findReupEntryIndex(readEventHooks(settings, hookEvent), integration.installedCommand) !== -1
  )
}

/** Removes exactly Reup's hook entries and clears captured markers. */
export async function removeAttentionHook(): Promise<RemoveResult> {
  const result = await withReupSettingsLock(async (): Promise<RemoveResult> => {
    const integration = await readIntegration()
    if (!integration) return { changed: false, reason: 'not-configured' }

    const settings = await readJsonObject(getSettingsPath())
    let settingsChanged = false
    for (const hookEvent of HOOK_EVENTS) {
      const eventHooks = readEventHooks(settings, hookEvent)
      const remaining = eventHooks.filter(
        (entry) => !isReupHookEntry(entry, integration.installedCommand)
      )
      if (remaining.length === eventHooks.length) continue

      const hooks = isRecord(settings['hooks']) ? settings['hooks'] : {}
      if (remaining.length > 0) hooks[hookEvent] = remaining
      else delete hooks[hookEvent]
      if (Object.keys(hooks).length > 0) settings['hooks'] = hooks
      else delete settings['hooks']
      settingsChanged = true
    }
    if (settingsChanged) await writeJsonAtomically(getSettingsPath(), settings)

    await unlink(getIntegrationPath()).catch(() => {})
    return { changed: true }
  })
  if (result.changed) {
    await clearAllAttentionMarkers()
    await clearAllWorkSignalMarkers()
  }
  return result
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

function readEventHooks(
  settings: Record<string, unknown>,
  hookEvent: string
): Record<string, unknown>[] {
  const hooks = settings['hooks']
  if (!isRecord(hooks)) return []
  const entries = hooks[hookEvent]
  if (!Array.isArray(entries)) return []
  return entries.filter(isRecord)
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
