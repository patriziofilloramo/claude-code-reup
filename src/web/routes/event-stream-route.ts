import { watch } from 'node:fs'

import type { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'

import { APP } from '../../config/app.js'
import { getClaudeDirectory } from '../../core/project/claude-paths.js'
import { invalidateProjectCache } from '../../core/project/project-cache.js'
import { log } from '../../utils/logger.js'

/** Registers filesystem-backed live-update notifications for browser clients. */
export function registerEventStreamRoute(app: Hono): void {
  app.get('/events', (context) =>
    streamSSE(context, async (stream) => {
      const claudeDirectory = getClaudeDirectory()
      log.debug('SSE: client connected, watching', claudeDirectory)

      const watcher = watch(claudeDirectory, { recursive: true }, (_event, fileName) => {
        if (!stream.closed && isRelevantClaudeFile(fileName)) {
          invalidateProjectCache()
          void stream.writeSSE({ data: 'update', event: 'change' })
        }
      })

      while (!stream.closed) {
        await stream.sleep(APP.projectRefreshMs)
        // Git branch changes happen outside Claude's data directory. A slow
        // periodic refresh keeps branch drift and any missed filesystem event
        // eventually consistent without continuously rescanning transcripts.
        invalidateProjectCache()
        void stream.writeSSE({ data: 'periodic-refresh', event: 'change' })
      }

      watcher.close()
      log.debug('SSE: client disconnected')
    })
  )
}

export function isRelevantClaudeFile(fileName: string | null): boolean {
  return (
    fileName?.endsWith('.jsonl') === true ||
    fileName?.endsWith('sessions-index.json') === true ||
    fileName?.endsWith('ccm.json') === true ||
    fileName === 'settings.json' ||
    /^ccm[/\\](account-usage|statusline-integration|usage-capture-error)\.json$/i.test(
      fileName ?? ''
    ) ||
    /^ccm[/\\]usage[/\\].*\.json$/i.test(fileName ?? '') ||
    /^sessions[/\\].*\.json$/i.test(fileName ?? '')
  )
}
