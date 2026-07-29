import { watch } from 'node:fs'

import type { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'

import { APP } from '../../config/app.js'
import { getClaudeDirectory } from '../../core/project/claude-paths.js'
import { invalidateProjectCache } from '../../core/project/project-cache.js'
import { log } from '../../utils/logger.js'
import { buildLiveActivitySnapshot } from '../live-activity-model.js'
import type { LiveActivitySnapshot } from '../live-activity-model.js'

/**
 * The subset of hono's SSE stream the event loop depends on.
 *
 * `closed` only becomes true after a normal `stream.close()`; a client
 * disconnect sets `aborted` instead, so both flags must be checked and
 * `onAbort` is the only prompt disconnect signal.
 */
export interface EventStreamClient {
  aborted: boolean
  closed: boolean
  onAbort(listener: () => void): void
  writeSSE(message: { data: string; event?: string }): Promise<unknown>
}

export interface ClaudeDirectoryWatcher {
  close(): void
}

/**
 * What a changed file means for connected clients:
 * - `activity`: a session lock flipped; only liveness state changed.
 * - `usage`: a usage snapshot or marker changed; only the usage header changed.
 * - `data`: transcripts or metadata changed; project data must be reloaded
 *   (and the activity strip refreshed, since transcripts drive tool state).
 */
export type ClaudeFileCategory = 'activity' | 'data' | 'usage'

export type WatchClaudeDirectory = (
  onRelevantChange: (category: ClaudeFileCategory) => void
) => ClaudeDirectoryWatcher

/** Registers filesystem-backed live-update notifications for browser clients. */
export function registerEventStreamRoute(app: Hono): void {
  app.get('/events', (context) => streamSSE(context, (stream) => runEventStream(stream)))
}

/**
 * Streams change notifications until the client disconnects, then releases the
 * filesystem watcher and timers. Exported for tests; production always uses
 * the real recursive Claude-directory watcher and live-activity model.
 */
export async function runEventStream(
  stream: EventStreamClient,
  watchClaudeDirectory: WatchClaudeDirectory = watchClaudeDirectoryForRelevantChanges,
  loadActivitySnapshot: () => Promise<unknown> = buildLiveActivitySnapshot
): Promise<void> {
  let changeDebounceTimer: ReturnType<typeof setTimeout> | null = null
  let changeMaxWaitTimer: ReturnType<typeof setTimeout> | null = null
  let activityPushTimer: ReturnType<typeof setTimeout> | null = null
  let wakeFromSleep: (() => void) | null = null

  const isClientConnected = (): boolean => !stream.closed && !stream.aborted

  const clearTimers = (): void => {
    if (changeDebounceTimer) clearTimeout(changeDebounceTimer)
    if (changeMaxWaitTimer) clearTimeout(changeMaxWaitTimer)
    if (activityPushTimer) clearTimeout(activityPushTimer)
    changeDebounceTimer = null
    changeMaxWaitTimer = null
    activityPushTimer = null
  }

  const flushChangeNotification = (): void => {
    if (changeDebounceTimer) clearTimeout(changeDebounceTimer)
    if (changeMaxWaitTimer) clearTimeout(changeMaxWaitTimer)
    changeDebounceTimer = null
    changeMaxWaitTimer = null
    if (!isClientConnected()) return
    invalidateProjectCache()
    void stream.writeSSE({ data: 'update', event: 'change' })
  }

  /**
   * Last reported working state per session, for spotting turn boundaries.
   *
   * The browser cannot find them alone: it derives state from snapshots it
   * only receives while awake, and a throttled tab misses one side of the
   * transition. Reporting the boundary as its own event means the page never
   * has to witness both — it only has to decide whether the user needs telling,
   * which is the one thing it knows and the server does not.
   */
  const lastWorkingBySession = new Map<string, boolean>()

  const emitTurnBoundaries = (snapshot: LiveActivitySnapshot): void => {
    const seen = new Set<string>()
    for (const entry of snapshot.entries) {
      seen.add(entry.sessionId)
      const isWorking = entry.liveState === 'working'
      const wasWorking = lastWorkingBySession.get(entry.sessionId)
      lastWorkingBySession.set(entry.sessionId, isWorking)
      // Only a source that reports turn boundaries may claim one ended;
      // recency alone cannot tell a long tool call from a finished turn.
      if (wasWorking === true && !isWorking && entry.stateIsReported) {
        void stream.writeSSE({
          data: JSON.stringify({ sessionId: entry.sessionId, sessionName: entry.sessionName }),
          event: 'turn-finished',
        })
      }
    }
    for (const sessionId of [...lastWorkingBySession.keys()]) {
      if (!seen.has(sessionId)) lastWorkingBySession.delete(sessionId)
    }
  }

  const pushActivitySnapshot = async (): Promise<void> => {
    activityPushTimer = null
    if (!isClientConnected()) return
    try {
      const snapshot = await loadActivitySnapshot()
      if (!isClientConnected()) return
      void stream.writeSSE({ data: JSON.stringify(snapshot), event: 'activity' })
      emitTurnBoundaries(snapshot as LiveActivitySnapshot)
    } catch {
      // The client's reconciliation poll covers a failed push.
    }
  }

  const scheduleActivityPush = (): void => {
    // Events inside the window ride along with the already-scheduled push;
    // the snapshot is computed at fire time, so nothing is lost.
    if (activityPushTimer) return
    activityPushTimer = setTimeout(() => void pushActivitySnapshot(), APP.sseActivityPushDebounceMs)
  }

  const scheduleDataChangeNotification = (): void => {
    if (changeDebounceTimer) clearTimeout(changeDebounceTimer)
    changeDebounceTimer = setTimeout(flushChangeNotification, APP.sseChangeDebounceMs)
    // A pure debounce starves under sustained writes (events arriving faster
    // than the debounce window postpone the flush forever); the max-wait timer
    // guarantees a notification while activity continues.
    if (!changeMaxWaitTimer) {
      changeMaxWaitTimer = setTimeout(flushChangeNotification, APP.sseChangeMaxWaitMs)
    }
  }

  const watcher = watchClaudeDirectory((category) => {
    if (!isClientConnected()) return
    if (category === 'usage') {
      // Usage snapshots are written atomically at most every few seconds per
      // session; a targeted event spares clients a full project refetch.
      void stream.writeSSE({ data: 'update', event: 'usage' })
      return
    }
    if (category === 'activity') {
      // Lock flips change liveness only — project data stays valid, so the
      // cache is left alone and clients get a targeted push instead.
      scheduleActivityPush()
      return
    }
    scheduleActivityPush()
    scheduleDataChangeNotification()
  })

  stream.onAbort(() => {
    wakeFromSleep?.()
  })

  const sleepUnlessDisconnected = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      const timer = setTimeout(finish, ms)
      wakeFromSleep = finish
      function finish(): void {
        clearTimeout(timer)
        wakeFromSleep = null
        resolve()
      }
    })

  while (isClientConnected()) {
    await sleepUnlessDisconnected(APP.projectRefreshMs)
    if (!isClientConnected()) break
    // Git branch changes happen outside Claude's data directory. A slow
    // periodic refresh keeps branch drift and any missed filesystem event
    // eventually consistent without continuously rescanning transcripts.
    invalidateProjectCache()
    void stream.writeSSE({ data: 'periodic-refresh', event: 'change' })
  }

  clearTimers()
  watcher.close()
  log.debug('SSE: client disconnected')
}

/**
 * Watches Claude's data directory recursively and reports relevant changes.
 * Watcher failures (deleted directory, exhausted handles) must not crash the
 * server: they close the watcher and leave the periodic refresh as fallback.
 */
export function watchClaudeDirectoryForRelevantChanges(
  onRelevantChange: (category: ClaudeFileCategory) => void
): ClaudeDirectoryWatcher {
  const claudeDirectory = getClaudeDirectory()
  try {
    const watcher = watch(claudeDirectory, { recursive: true }, (_event, fileName) => {
      const category = classifyClaudeFile(fileName)
      if (category) onRelevantChange(category)
    })
    watcher.on('error', (error) => {
      log.debug('SSE: filesystem watcher failed, relying on periodic refresh:', error)
      watcher.close()
    })
    log.debug('SSE: client connected, watching', claudeDirectory)
    return watcher
  } catch (error) {
    log.debug('SSE: cannot watch Claude directory, relying on periodic refresh:', error)
    return { close: () => undefined }
  }
}

/** Maps a changed file inside the Claude directory to its client-facing meaning. */
export function classifyClaudeFile(fileName: string | null): ClaudeFileCategory | null {
  if (fileName === null) return null
  if (/^sessions[/\\].*\.json$/i.test(fileName)) return 'activity'
  if (/^reup[/\\](attention|activity)[/\\].*\.json$/i.test(fileName)) return 'activity'
  if (
    /^reup[/\\](account-usage|statusline-integration|usage-capture-error)\.json$/i.test(fileName) ||
    /^reup[/\\]usage[/\\].*\.json$/i.test(fileName)
  ) {
    return 'usage'
  }
  if (
    fileName.endsWith('.jsonl') ||
    fileName.endsWith('sessions-index.json') ||
    fileName.endsWith('reup.json') ||
    fileName === 'settings.json' ||
    /^reup[/\\]org\.json$/i.test(fileName)
  ) {
    return 'data'
  }
  return null
}

export function isRelevantClaudeFile(fileName: string | null): boolean {
  return classifyClaudeFile(fileName) !== null
}
