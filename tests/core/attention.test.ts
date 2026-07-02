import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  clearAllAttentionMarkers,
  clearAttentionMarker,
  combineWorkEvidence,
  isAttentionActive,
  parseNotificationHookPayload,
  parseWorkSignalHookPayload,
  readAttentionMarkers,
  readWorkSignalMarkers,
  writeAttentionMarker,
  writeWorkSignalMarker,
} from '../../src/core/session/attention.js'
import type { AttentionMarker, WorkSignalMarker } from '../../src/core/session/attention.js'

const SESSION_ID = '33333333-3333-4333-8333-333333333333'
const NOW = Date.parse('2026-07-02T12:00:00.000Z')

describe('parseNotificationHookPayload', () => {
  it('accepts a Claude Code Notification hook payload', () => {
    const marker = parseNotificationHookPayload(
      JSON.stringify({
        session_id: SESSION_ID,
        transcript_path: '/tmp/t.jsonl',
        hook_event_name: 'Notification',
        message: 'Claude needs your permission to use Bash',
      }),
      '2026-07-02T12:00:00.000Z'
    )
    expect(marker).toEqual({
      message: 'Claude needs your permission to use Bash',
      occurredAt: '2026-07-02T12:00:00.000Z',
      schemaVersion: 1,
      sessionId: SESSION_ID,
    })
  })

  it('substitutes a default message when the payload omits one', () => {
    const marker = parseNotificationHookPayload({ session_id: SESSION_ID })
    expect(marker?.message).toBe('Claude Code is waiting for your input')
  })

  it('rejects payloads without a valid session id', () => {
    expect(parseNotificationHookPayload({ message: 'hello' })).toBeNull()
    expect(parseNotificationHookPayload({ session_id: '../escape', message: 'x' })).toBeNull()
    expect(parseNotificationHookPayload('not json')).toBeNull()
    expect(parseNotificationHookPayload(null)).toBeNull()
  })
})

describe('attention markers on disk', () => {
  let claudeDirectory: string
  let previousConfigDir: string | undefined

  beforeEach(async () => {
    claudeDirectory = await mkdtemp(join(tmpdir(), 'reup-attention-test-'))
    previousConfigDir = process.env['CLAUDE_CONFIG_DIR']
    process.env['CLAUDE_CONFIG_DIR'] = claudeDirectory
  })

  afterEach(async () => {
    if (previousConfigDir === undefined) delete process.env['CLAUDE_CONFIG_DIR']
    else process.env['CLAUDE_CONFIG_DIR'] = previousConfigDir
    await rm(claudeDirectory, { force: true, recursive: true })
  })

  it('round-trips a marker and keeps one file per session', async () => {
    const marker = markerAt('2026-07-02T12:00:00.000Z')
    await writeAttentionMarker(marker)
    await writeAttentionMarker({ ...marker, message: 'updated', occurredAt: nowIso(1_000) })

    const markers = await readAttentionMarkers()
    expect(markers).toHaveLength(1)
    expect(markers[0]?.message).toBe('updated')

    const files = await readdir(join(claudeDirectory, 'reup', 'attention'))
    expect(files).toHaveLength(1)
  })

  it('clears a single session marker and clears everything on request', async () => {
    await writeAttentionMarker(markerAt(nowIso(0)))
    await clearAttentionMarker(SESSION_ID)
    expect(await readAttentionMarkers()).toEqual([])

    await writeAttentionMarker(markerAt(nowIso(0)))
    await clearAllAttentionMarkers()
    expect(await readAttentionMarkers()).toEqual([])
  })

  it('returns nothing when the attention directory does not exist', async () => {
    expect(await readAttentionMarkers()).toEqual([])
  })
})

describe('work signal markers', () => {
  let claudeDirectory: string
  let previousConfigDir: string | undefined

  beforeEach(async () => {
    claudeDirectory = await mkdtemp(join(tmpdir(), 'reup-worksignal-test-'))
    previousConfigDir = process.env['CLAUDE_CONFIG_DIR']
    process.env['CLAUDE_CONFIG_DIR'] = claudeDirectory
  })

  afterEach(async () => {
    if (previousConfigDir === undefined) delete process.env['CLAUDE_CONFIG_DIR']
    else process.env['CLAUDE_CONFIG_DIR'] = previousConfigDir
    await rm(claudeDirectory, { force: true, recursive: true })
  })

  it('maps turn-boundary hooks to busy and idle markers', () => {
    const busy = parseWorkSignalHookPayload(
      { hook_event_name: 'UserPromptSubmit', session_id: SESSION_ID },
      '2026-07-02T12:00:00.000Z'
    )
    expect(busy).toEqual({
      occurredAt: '2026-07-02T12:00:00.000Z',
      schemaVersion: 1,
      sessionId: SESSION_ID,
      state: 'busy',
    })
    expect(
      parseWorkSignalHookPayload({ hook_event_name: 'Stop', session_id: SESSION_ID })?.state
    ).toBe('idle')
  })

  it('rejects payloads for other hook events or invalid session ids', () => {
    expect(
      parseWorkSignalHookPayload({ hook_event_name: 'Notification', session_id: SESSION_ID })
    ).toBeNull()
    expect(
      parseWorkSignalHookPayload({ hook_event_name: 'Stop', session_id: '../nope' })
    ).toBeNull()
    expect(parseWorkSignalHookPayload(null)).toBeNull()
  })

  it('round-trips one marker per session, newest turn winning', async () => {
    await writeWorkSignalMarker(workMarker('busy', '2026-07-02T12:00:00.000Z'))
    await writeWorkSignalMarker(workMarker('idle', '2026-07-02T12:05:00.000Z'))

    const markers = await readWorkSignalMarkers()
    expect(markers).toHaveLength(1)
    expect(markers[0]?.state).toBe('idle')
  })
})

describe('combineWorkEvidence', () => {
  const T1 = Date.parse('2026-07-02T12:00:00.000Z')
  const T2 = Date.parse('2026-07-02T12:05:00.000Z')

  it('uses the work marker when the lock has no status field', () => {
    expect(combineWorkEvidence(null, null, workMarker('busy', new Date(T1).toISOString()))).toEqual(
      { status: 'busy', statusUpdatedAt: T1 }
    )
  })

  it('lets the newer transition win between lock and marker', () => {
    expect(combineWorkEvidence('idle', T1, workMarker('busy', new Date(T2).toISOString()))).toEqual(
      { status: 'busy', statusUpdatedAt: T2 }
    )
    expect(combineWorkEvidence('busy', T2, workMarker('idle', new Date(T1).toISOString()))).toEqual(
      { status: 'busy', statusUpdatedAt: T2 }
    )
  })

  it('keeps the lock evidence when no marker exists', () => {
    expect(combineWorkEvidence('busy', T1, undefined)).toEqual({
      status: 'busy',
      statusUpdatedAt: T1,
    })
    expect(combineWorkEvidence(null, null, undefined)).toEqual({
      status: null,
      statusUpdatedAt: null,
    })
  })
})

describe('isAttentionActive', () => {
  const marker = markerAt(new Date(NOW).toISOString())

  it('stays active while the session shows no life after the event', () => {
    expect(
      isAttentionActive(marker, {
        isLive: true,
        lastActivityMs: NOW - 5_000,
        statusUpdatedAt: NOW - 60_000,
      })
    ).toBe(true)
  })

  it('resolves as soon as the session transitions or the transcript advances', () => {
    expect(
      isAttentionActive(marker, { isLive: true, lastActivityMs: null, statusUpdatedAt: NOW + 1 })
    ).toBe(false)
    expect(
      isAttentionActive(marker, { isLive: true, lastActivityMs: NOW + 1, statusUpdatedAt: null })
    ).toBe(false)
  })

  it('never alerts for a dead session', () => {
    expect(
      isAttentionActive(marker, { isLive: false, lastActivityMs: null, statusUpdatedAt: null })
    ).toBe(false)
  })
})

function markerAt(occurredAt: string): AttentionMarker {
  return {
    message: 'Claude needs your permission to use Bash',
    occurredAt,
    schemaVersion: 1,
    sessionId: SESSION_ID,
  }
}

function nowIso(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString()
}

function workMarker(state: WorkSignalMarker['state'], occurredAt: string): WorkSignalMarker {
  return { occurredAt, schemaVersion: 1, sessionId: SESSION_ID, state }
}
