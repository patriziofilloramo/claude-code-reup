import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ReupRefreshController } from '../../extension/src/refresh-controller.js'
import { activeWatchers, resetVscodeStub } from './vscode-stub.js'

const silentLogger = {
  debug: () => {},
  dispose: () => {},
  error: () => {},
  info: () => {},
  show: () => {},
} as never

const WAITING_TRANSCRIPT = join('C:', 'claude', 'projects', 'demo', 'session-a.jsonl')
const OTHER_TRANSCRIPT = join('C:', 'claude', 'projects', 'demo', 'session-b.jsonl')

describe('refresh controller needs-input retraction', () => {
  let controller: ReupRefreshController
  let refreshCount: number

  beforeEach(async () => {
    vi.useFakeTimers()
    resetVscodeStub({ 'reup.refreshMode': 'watch' })
    refreshCount = 0
    controller = new ReupRefreshController(silentLogger, {
      refresh: async () => {
        refreshCount += 1
      },
    })
    // Becoming visible refreshes once by design; settle it so each test counts
    // only the refresh its own trigger caused.
    controller.setScope('signals')
    await vi.advanceTimersByTimeAsync(1_000)
    refreshCount = 0
  })

  afterEach(() => {
    controller.dispose()
    vi.useRealTimers()
  })

  /** Watchers created for a specific transcript file rather than a directory. */
  function transcriptWatchers() {
    return activeWatchers().filter((watcher) => watcher.pattern.pattern.endsWith('.jsonl'))
  }

  it('watches nothing extra while no session claims needs-input', () => {
    controller.setNeedsInputTranscripts([])

    expect(transcriptWatchers()).toHaveLength(0)
  })

  it('watches exactly the transcript of a waiting session', () => {
    controller.setNeedsInputTranscripts([WAITING_TRANSCRIPT])

    const watched = transcriptWatchers()
    expect(watched).toHaveLength(1)
    expect(watched[0]?.pattern.pattern).toBe('session-a.jsonl')
    expect(watched[0]?.pattern.base).toContain('demo')
  })

  it('refreshes when the waiting transcript advances', async () => {
    // Answering a permission prompt ends no turn, so no hook fires and no lock
    // moves. The transcript growing is the only evidence the claim is stale.
    controller.setNeedsInputTranscripts([WAITING_TRANSCRIPT])
    expect(refreshCount).toBe(0)

    for (const listener of transcriptWatchers()[0]!.changeListeners) listener()
    await vi.advanceTimersByTimeAsync(1_000)

    expect(refreshCount).toBe(1)
  })

  it('treats the retraction as urgent, not throttled behind ordinary events', async () => {
    // A throttled retraction would leave the badge standing for seconds after
    // the user has already answered, which is the complaint this fixes.
    controller.setNeedsInputTranscripts([WAITING_TRANSCRIPT])
    for (const listener of transcriptWatchers()[0]!.changeListeners) listener()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(refreshCount).toBe(1)

    for (const listener of transcriptWatchers()[0]!.changeListeners) listener()
    await vi.advanceTimersByTimeAsync(1_000)

    // The 5s watch throttle applies to ordinary events; this one bypasses it.
    expect(refreshCount).toBe(2)
  })

  it('stops watching a transcript once the session no longer waits', () => {
    controller.setNeedsInputTranscripts([WAITING_TRANSCRIPT, OTHER_TRANSCRIPT])
    expect(transcriptWatchers()).toHaveLength(2)

    controller.setNeedsInputTranscripts([OTHER_TRANSCRIPT])

    const watched = transcriptWatchers()
    expect(watched).toHaveLength(1)
    expect(watched[0]?.pattern.pattern).toBe('session-b.jsonl')
  })

  it('does not rebuild watchers when the waiting set is unchanged', () => {
    controller.setNeedsInputTranscripts([WAITING_TRANSCRIPT])
    const created = transcriptWatchers()[0]

    controller.setNeedsInputTranscripts([WAITING_TRANSCRIPT])

    // Same object: a rebuild on every refresh would churn watchers constantly,
    // since refreshAll hands the set over on each pass.
    expect(transcriptWatchers()[0]).toBe(created)
  })

  it('never polls in watch mode, however long the view stays open', async () => {
    // Periodic scanning is reserved for interval mode. A timer was the tempting
    // fix for the stale badge and would have contradicted that; the retraction
    // is an event, so it is watched as one.
    controller.setNeedsInputTranscripts([WAITING_TRANSCRIPT])

    await vi.advanceTimersByTimeAsync(120_000)

    expect(refreshCount).toBe(0)
  })

  it('releases the transcript watchers when the view is hidden', () => {
    controller.setNeedsInputTranscripts([WAITING_TRANSCRIPT])
    expect(transcriptWatchers()).toHaveLength(1)

    controller.setScope('off')

    expect(transcriptWatchers()).toHaveLength(0)
  })
})
