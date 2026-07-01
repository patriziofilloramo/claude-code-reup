import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { APP } from '../../src/config/app.js'
import { invalidateProjectCache } from '../../src/core/project/project-cache.js'
import {
  classifyClaudeFile,
  isRelevantClaudeFile,
  runEventStream,
  watchClaudeDirectoryForRelevantChanges,
} from '../../src/web/routes/event-stream-route.js'
import type {
  ClaudeFileCategory,
  EventStreamClient,
} from '../../src/web/routes/event-stream-route.js'

vi.mock('../../src/core/project/project-cache.js', () => ({
  invalidateProjectCache: vi.fn(),
}))

vi.mock('../../src/web/live-activity-model.js', () => ({
  buildLiveActivitySnapshot: vi.fn(async () => ({ activeSessionIds: [], entries: [] })),
}))

interface FakeStream extends EventStreamClient {
  abort(): void
  writes: Array<{ data: string; event?: string }>
}

function createFakeStream(): FakeStream {
  const abortListeners: Array<() => void> = []
  const stream: FakeStream = {
    aborted: false,
    closed: false,
    writes: [],
    onAbort(listener) {
      abortListeners.push(listener)
    },
    writeSSE: vi.fn(async (message: { data: string; event?: string }) => {
      stream.writes.push(message)
    }),
    abort() {
      stream.aborted = true
      for (const listener of abortListeners) listener()
    },
  }
  return stream
}

function createFakeWatcher() {
  let notifyChange: ((category: ClaudeFileCategory) => void) | null = null
  const watcher = { close: vi.fn() }
  return {
    factory: (onRelevantChange: (category: ClaudeFileCategory) => void) => {
      notifyChange = onRelevantChange
      return watcher
    },
    watcher,
    emitChange: (category: ClaudeFileCategory) => notifyChange?.(category),
  }
}

const emptySnapshot = async (): Promise<unknown> => ({ activeSessionIds: [], entries: [] })

describe('event stream connection lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(invalidateProjectCache).mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('exits the loop and closes the watcher promptly when the client aborts', async () => {
    const stream = createFakeStream()
    const { factory, watcher } = createFakeWatcher()

    const connection = runEventStream(stream, factory, emptySnapshot)
    stream.abort()
    await connection

    expect(watcher.close).toHaveBeenCalledTimes(1)
  })

  it('releases the watcher even when the abort arrives mid-sleep', async () => {
    const stream = createFakeStream()
    const { factory, watcher } = createFakeWatcher()

    const connection = runEventStream(stream, factory, emptySnapshot)
    await vi.advanceTimersByTimeAsync(APP.projectRefreshMs / 2)
    stream.abort()
    await connection

    expect(watcher.close).toHaveBeenCalledTimes(1)
  })

  it('debounces a data burst into one invalidation followed by one notification', async () => {
    const stream = createFakeStream()
    const { factory, emitChange } = createFakeWatcher()

    const connection = runEventStream(stream, factory, emptySnapshot)
    emitChange('data')
    emitChange('data')
    await vi.advanceTimersByTimeAsync(APP.sseChangeDebounceMs)

    expect(invalidateProjectCache).toHaveBeenCalledTimes(1)
    const changeWrites = stream.writes.filter((write) => write.event === 'change')
    expect(changeWrites).toEqual([{ data: 'update', event: 'change' }])

    stream.abort()
    await connection
  })

  it('still notifies during sustained filesystem activity via the max-wait bound', async () => {
    const stream = createFakeStream()
    const { factory, emitChange } = createFakeWatcher()

    const connection = runEventStream(stream, factory, emptySnapshot)
    // Events arrive faster than the debounce window for longer than the
    // max-wait bound; a pure debounce would never flush.
    const stepMs = Math.floor(APP.sseChangeDebounceMs / 2)
    for (let elapsed = 0; elapsed <= APP.sseChangeMaxWaitMs + stepMs; elapsed += stepMs) {
      emitChange('data')
      await vi.advanceTimersByTimeAsync(stepMs)
    }

    expect(
      stream.writes.filter((write) => write.event === 'change' && write.data === 'update').length
    ).toBeGreaterThanOrEqual(1)

    stream.abort()
    await connection
  })

  it('sends periodic refresh notifications while the client stays connected', async () => {
    const stream = createFakeStream()
    const { factory } = createFakeWatcher()

    const connection = runEventStream(stream, factory, emptySnapshot)
    await vi.advanceTimersByTimeAsync(APP.projectRefreshMs)

    expect(stream.writes).toEqual([{ data: 'periodic-refresh', event: 'change' }])

    stream.abort()
    await connection
  })

  it('stops notifying after the client disconnects', async () => {
    const stream = createFakeStream()
    const { factory, emitChange } = createFakeWatcher()

    const connection = runEventStream(stream, factory, emptySnapshot)
    stream.abort()
    await connection

    emitChange('data')
    emitChange('activity')
    await vi.advanceTimersByTimeAsync(APP.sseChangeMaxWaitMs + APP.projectRefreshMs)

    expect(stream.writes).toEqual([])
  })
})

describe('event stream targeted pushes', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(invalidateProjectCache).mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('pushes a computed activity snapshot without touching the project cache', async () => {
    const stream = createFakeStream()
    const { factory, emitChange } = createFakeWatcher()
    const snapshot = { activeSessionIds: ['abc'], entries: [{ sessionId: 'abc' }] }

    const connection = runEventStream(stream, factory, async () => snapshot)
    emitChange('activity')
    emitChange('activity')
    await vi.advanceTimersByTimeAsync(APP.sseActivityPushDebounceMs)

    expect(stream.writes).toEqual([{ data: JSON.stringify(snapshot), event: 'activity' }])
    expect(invalidateProjectCache).not.toHaveBeenCalled()

    stream.abort()
    await connection
  })

  it('emits a targeted usage event instead of a full change notification', async () => {
    const stream = createFakeStream()
    const { factory, emitChange } = createFakeWatcher()

    const connection = runEventStream(stream, factory, emptySnapshot)
    emitChange('usage')
    await vi.advanceTimersByTimeAsync(APP.sseChangeMaxWaitMs)

    expect(stream.writes).toEqual([{ data: 'update', event: 'usage' }])
    expect(invalidateProjectCache).not.toHaveBeenCalled()

    stream.abort()
    await connection
  })

  it('refreshes the activity strip alongside data changes from transcript writes', async () => {
    const stream = createFakeStream()
    const { factory, emitChange } = createFakeWatcher()

    const connection = runEventStream(stream, factory, emptySnapshot)
    emitChange('data')
    await vi.advanceTimersByTimeAsync(
      Math.max(APP.sseChangeDebounceMs, APP.sseActivityPushDebounceMs)
    )

    const events = stream.writes.map((write) => write.event)
    expect(events).toContain('activity')
    expect(events).toContain('change')

    stream.abort()
    await connection
  })

  it('keeps streaming when a snapshot computation fails', async () => {
    const stream = createFakeStream()
    const { factory, emitChange } = createFakeWatcher()

    const connection = runEventStream(stream, factory, async () => {
      throw new Error('discovery failed')
    })
    emitChange('activity')
    await vi.advanceTimersByTimeAsync(APP.sseActivityPushDebounceMs)
    await vi.advanceTimersByTimeAsync(APP.projectRefreshMs)

    expect(stream.writes).toEqual([{ data: 'periodic-refresh', event: 'change' }])

    stream.abort()
    await connection
  })
})

describe('claude directory watcher', () => {
  let claudeDirectory: string
  let previousConfigDir: string | undefined

  beforeEach(async () => {
    claudeDirectory = await mkdtemp(join(tmpdir(), 'reup-watch-test-'))
    previousConfigDir = process.env['CLAUDE_CONFIG_DIR']
    process.env['CLAUDE_CONFIG_DIR'] = claudeDirectory
  })

  afterEach(async () => {
    if (previousConfigDir === undefined) delete process.env['CLAUDE_CONFIG_DIR']
    else process.env['CLAUDE_CONFIG_DIR'] = previousConfigDir
    await rm(claudeDirectory, { force: true, recursive: true })
  })

  it('survives watcher error events instead of crashing the process', () => {
    const watcher = watchClaudeDirectoryForRelevantChanges(() => undefined)
    expect(() =>
      (watcher as unknown as { emit(event: string, error: Error): void }).emit(
        'error',
        new Error('watch failure')
      )
    ).not.toThrow()
  })

  it('falls back to a no-op watcher when the directory cannot be watched', () => {
    process.env['CLAUDE_CONFIG_DIR'] = join(claudeDirectory, 'does-not-exist')
    const watcher = watchClaudeDirectoryForRelevantChanges(() => undefined)
    expect(() => watcher.close()).not.toThrow()
  })
})

describe('event stream relevance filter', () => {
  it('observes transcript, index, active-session, and Reup sidecar changes', () => {
    expect(isRelevantClaudeFile('projects/example/session.jsonl')).toBe(true)
    expect(isRelevantClaudeFile('projects/example/sessions-index.json')).toBe(true)
    expect(isRelevantClaudeFile('projects/example/reup.json')).toBe(true)
    expect(isRelevantClaudeFile('reup/usage/session.json')).toBe(true)
    expect(isRelevantClaudeFile('reup/account-usage.json')).toBe(true)
    expect(isRelevantClaudeFile('reup/usage-capture-error.json')).toBe(true)
    expect(isRelevantClaudeFile('reup/statusline-integration.json')).toBe(true)
    expect(isRelevantClaudeFile('settings.json')).toBe(true)
    expect(isRelevantClaudeFile('sessions/process.json')).toBe(true)
    expect(isRelevantClaudeFile('projects/example/notes.txt')).toBe(false)
  })

  it('classifies changes by what clients must refresh', () => {
    expect(classifyClaudeFile('sessions/process.json')).toBe('activity')
    expect(classifyClaudeFile('reup/attention/abc123.json')).toBe('activity')
    expect(classifyClaudeFile('reup/usage/session.json')).toBe('usage')
    expect(classifyClaudeFile('reup/account-usage.json')).toBe('usage')
    expect(classifyClaudeFile('reup/statusline-integration.json')).toBe('usage')
    expect(classifyClaudeFile('reup/usage-capture-error.json')).toBe('usage')
    expect(classifyClaudeFile('projects/example/session.jsonl')).toBe('data')
    expect(classifyClaudeFile('projects/example/sessions-index.json')).toBe('data')
    expect(classifyClaudeFile('projects/example/reup.json')).toBe('data')
    expect(classifyClaudeFile('reup/org.json')).toBe('data')
    expect(classifyClaudeFile('settings.json')).toBe('data')
    expect(classifyClaudeFile('projects/example/notes.txt')).toBeNull()
    expect(classifyClaudeFile(null)).toBeNull()
  })
})
