import { getLiveSessionRecords, mergeSessionLockStatuses } from '../core/session/active-sessions.js'
import {
  applyHookPayload,
  isAttentionActive,
  logHookCapture,
  readAttentionMarkers,
} from '../core/session/attention.js'
import type { HookCaptureResult } from '../core/session/attention.js'
import {
  inspectAttentionHookHealth,
  removeAttentionHook,
  setupAttentionHook,
} from '../core/session/attention-hooks-integration.js'
import { log } from '../utils/logger.js'
import { failCommand, writeOutput } from './output.js'

/**
 * `reup attention` - needs-input alerts for Claude Code sessions.
 *
 * - (no action) / `status`: show whether the hook is installed and what waits
 * - `setup`: register Reup's capture command as a Notification hook
 * - `remove`: unregister the hook and clear stored markers
 * - `capture`: hidden hook entry point; reads the payload from stdin
 */
export async function runAttentionCommand(commandArguments: string[]): Promise<void> {
  const [action, ...actionArguments] = commandArguments

  switch (action) {
    case undefined:
    case 'status':
      if (actionArguments.length > 0) return failUsage()
      await printAttentionStatus()
      return
    case 'setup':
      if (actionArguments.length > 0) return failUsage()
      await setup()
      return
    case 'remove':
    case 'off':
      if (actionArguments.length > 0) return failUsage()
      await remove()
      return
    case 'capture':
      if (actionArguments.length > 0) return
      await captureFromNotificationHook()
      return
    default:
      failUsage()
  }
}

async function printAttentionStatus(): Promise<void> {
  const health = await inspectAttentionHookHealth()
  if (health.state === 'not-configured') {
    writeOutput(
      'Attention alerts are off. Run `reup attention setup` to be alerted when a session waits for your input.'
    )
    return
  }
  // Registered but pointing at nothing: Claude Code runs the command, node
  // fails, and every turn boundary and alert is lost without a word. Saying
  // "on" here would be the lie that hid it for three weeks.
  if (health.state === 'broken') {
    writeOutput(
      [
        'Attention alerts are registered but BROKEN: the command Claude Code runs no longer exists.',
        `  missing: ${health.missingPath}`,
        'Until this is fixed, needs-input alerts and turn boundaries are silently lost,',
        'session state falls back to guessing from transcript activity, and desktop',
        'notifications cannot fire because nothing reports when a turn ended.',
        'Run `reup attention setup` from the current install to repoint the hooks.',
      ].join('\n')
    )
    return
  }

  const [markers, liveRecords] = await Promise.all([
    readAttentionMarkers(),
    getLiveSessionRecords(),
  ])
  const lockStatuses = mergeSessionLockStatuses(liveRecords)
  const waiting = markers.filter((marker) =>
    isAttentionActive(marker, {
      isLive: lockStatuses.has(marker.sessionId),
      lastActivityMs: null,
      statusUpdatedAt: lockStatuses.get(marker.sessionId)?.statusUpdatedAt ?? null,
    })
  )

  if (waiting.length === 0) {
    writeOutput('Attention alerts are on. No session is waiting for your input.')
    return
  }
  writeOutput(
    [
      `Attention alerts are on. ${waiting.length} session(s) need you:`,
      ...waiting.map((marker) => `  ${marker.sessionId.slice(0, 8)}  ${marker.message}`),
    ].join('\n')
  )
}

async function setup(): Promise<void> {
  const result = await setupAttentionHook()
  writeOutput(
    result.changed
      ? 'Attention alerts configured. Reup now hears when a Claude Code session waits for your input.'
      : 'Attention alerts are already configured.'
  )
}

async function remove(): Promise<void> {
  const result = await removeAttentionHook()
  writeOutput(result.changed ? 'Attention alerts removed.' : 'Attention alerts are not configured.')
}

async function captureFromNotificationHook(): Promise<void> {
  let result: HookCaptureResult = {
    hookEvent: null,
    occurredAt: null,
    outcome: 'ignored-tty',
    sessionId: null,
  }
  try {
    if (process.stdin.isTTY) return
    result = await applyHookPayload(await readStdin())
  } catch (error) {
    // A hook failure must never disrupt Claude Code; keep it inspectable.
    result = { ...result, outcome: 'capture-failed' }
    log.debug('attention capture failed:', error)
  } finally {
    // The log line is the only visible trace hooks leave; write it even for
    // failures so a broken hook is distinguishable from one that never fired.
    await logHookCapture({ at: new Date().toISOString(), ...result }).catch(() => {})
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8')
}

function failUsage(): void {
  failCommand('usage: reup attention [status|setup|remove]')
}
