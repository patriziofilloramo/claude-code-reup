import { beforeAll, describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { isRelevantClaudeFile } from '../../src/web/routes/event-stream-route.js'

const ROUTE_PATH = join(process.cwd(), 'src', 'web', 'routes', 'event-stream-route.ts')

describe('event stream route', () => {
  let source: string

  beforeAll(async () => {
    source = await readFile(ROUTE_PATH, 'utf8')
  })

  it('observes transcript, index, active-session, and CCM sidecar changes', () => {
    expect(isRelevantClaudeFile('projects/example/session.jsonl')).toBe(true)
    expect(isRelevantClaudeFile('projects/example/sessions-index.json')).toBe(true)
    expect(isRelevantClaudeFile('projects/example/ccm.json')).toBe(true)
    expect(isRelevantClaudeFile('ccm/usage/session.json')).toBe(true)
    expect(isRelevantClaudeFile('ccm/account-usage.json')).toBe(true)
    expect(isRelevantClaudeFile('ccm/usage-capture-error.json')).toBe(true)
    expect(isRelevantClaudeFile('ccm/statusline-integration.json')).toBe(true)
    expect(isRelevantClaudeFile('settings.json')).toBe(true)
    expect(isRelevantClaudeFile('sessions/process.json')).toBe(true)
    expect(isRelevantClaudeFile('projects/example/notes.txt')).toBe(false)
  })

  it('invalidates project data before notifying clients about a filesystem change', () => {
    const watcherCallback = source.slice(
      source.indexOf('const watcher ='),
      source.indexOf('while (')
    )

    expect(watcherCallback.indexOf('invalidateProjectCache()')).toBeGreaterThanOrEqual(0)
    expect(watcherCallback.indexOf('invalidateProjectCache()')).toBeLessThan(
      watcherCallback.indexOf('stream.writeSSE')
    )
  })

  it('periodically invalidates and refreshes branch state outside Claude data', () => {
    const periodicRefresh = source.slice(
      source.indexOf('while ('),
      source.indexOf('watcher.close()')
    )

    expect(periodicRefresh).toContain('APP.projectRefreshMs')
    expect(periodicRefresh).toContain('invalidateProjectCache()')
    expect(periodicRefresh).toContain("event: 'change'")
  })
})
