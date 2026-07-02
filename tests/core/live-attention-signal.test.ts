import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  applyHookPayload,
  getHookCaptureLogPath,
  logHookCapture,
  readAttentionMarkers,
  readWorkSignalMarkers,
} from '../../src/core/session/attention.js'
import { getLiveSessionRecords } from '../../src/core/session/active-sessions.js'
import {
  isAwaitingUserReply,
  readSessionTailActivity,
} from '../../src/core/session/session-tail.js'
import { resolveSessionAttention } from '../../src/web/live-activity-model.js'

const SESSION_ID = '22222222-2222-4222-8222-222222222222'

describe('live-attention-signal', () => {
  let claudeDirectory: string
  let previousConfigDir: string | undefined

  beforeEach(async () => {
    claudeDirectory = await mkdtemp(join(tmpdir(), 'reup-live-attention-test-'))
    previousConfigDir = process.env['CLAUDE_CONFIG_DIR']
    process.env['CLAUDE_CONFIG_DIR'] = claudeDirectory
  })

  afterEach(async () => {
    if (previousConfigDir === undefined) delete process.env['CLAUDE_CONFIG_DIR']
    else process.env['CLAUDE_CONFIG_DIR'] = previousConfigDir
    await rm(claudeDirectory, { force: true, recursive: true })
  })

  describe('applyHookPayload (the real capture path)', () => {
    it('writes an attention marker for a Notification payload', async () => {
      const result = await applyHookPayload(
        JSON.stringify({
          session_id: SESSION_ID,
          hook_event_name: 'Notification',
          message: 'Claude needs permission to use Bash',
        })
      )
      expect(result).toEqual({
        hookEvent: 'Notification',
        outcome: 'attention-marker-written',
        sessionId: SESSION_ID,
      })
      const markers = await readAttentionMarkers()
      expect(markers).toHaveLength(1)
      expect(markers[0]?.message).toBe('Claude needs permission to use Bash')
    })

    it('clears the attention marker when the user submits a prompt', async () => {
      await applyHookPayload(
        JSON.stringify({ session_id: SESSION_ID, hook_event_name: 'Notification', message: 'x' })
      )
      expect(await readAttentionMarkers()).toHaveLength(1)

      const result = await applyHookPayload(
        JSON.stringify({ session_id: SESSION_ID, hook_event_name: 'UserPromptSubmit' })
      )
      expect(result.outcome).toBe('attention-marker-cleared')
      expect(await readAttentionMarkers()).toHaveLength(0)
      const workMarkers = await readWorkSignalMarkers()
      expect(workMarkers).toEqual([
        expect.objectContaining({ sessionId: SESSION_ID, state: 'busy' }),
      ])
    })

    it('keeps the attention marker on a Stop turn boundary', async () => {
      await applyHookPayload(
        JSON.stringify({ session_id: SESSION_ID, hook_event_name: 'Notification', message: 'x' })
      )
      const result = await applyHookPayload(
        JSON.stringify({ session_id: SESSION_ID, hook_event_name: 'Stop' })
      )
      expect(result.outcome).toBe('work-marker-written')
      expect(await readAttentionMarkers()).toHaveLength(1)
    })

    it('strips a BOM before parsing', async () => {
      const result = await applyHookPayload(
        '﻿' + JSON.stringify({ session_id: SESSION_ID, message: 'hello' })
      )
      expect(result.outcome).toBe('attention-marker-written')
    })

    it('reports malformed and unrecognized payloads without writing anything', async () => {
      expect((await applyHookPayload('not json')).outcome).toBe('parse-failed')
      expect((await applyHookPayload('[1,2]')).outcome).toBe('unrecognized-payload')
      expect((await applyHookPayload(JSON.stringify({ message: 'no id' }))).outcome).toBe(
        'unrecognized-payload'
      )
      expect(await readAttentionMarkers()).toHaveLength(0)
      expect(await readWorkSignalMarkers()).toHaveLength(0)
    })
  })

  describe('hook capture log', () => {
    it('appends one JSONL line per invocation, creating the directory if needed', async () => {
      await logHookCapture({
        at: '2026-07-02T12:00:00.000Z',
        hookEvent: 'Notification',
        sessionId: SESSION_ID,
        outcome: 'attention-marker-written',
      })
      await logHookCapture({
        at: '2026-07-02T12:00:01.000Z',
        hookEvent: null,
        sessionId: null,
        outcome: 'parse-failed',
      })
      const lines = (await readFile(getHookCaptureLogPath(), 'utf8')).trim().split('\n')
      expect(lines).toHaveLength(2)
      expect(JSON.parse(lines[0]!)).toMatchObject({ outcome: 'attention-marker-written' })
      expect(JSON.parse(lines[1]!)).toMatchObject({ outcome: 'parse-failed' })
    })
  })

  describe('fake liveness via lock files', () => {
    it('a lock file with our own pid reads as a live session', async () => {
      await createFakeLiveSession(SESSION_ID, 'idle')
      const records = await getLiveSessionRecords()
      expect(records).toEqual([expect.objectContaining({ sessionId: SESSION_ID, status: 'idle' })])
    })
  })

  describe('isAwaitingUserReply (Case 3: blocked turn, no hook)', () => {
    it('is true when the turn ended with an unanswered tool call', async () => {
      const transcriptPath = await writeTranscript(transcriptWithPendingTool('Bash'))
      const tail = await readSessionTailActivity(transcriptPath)
      expect(tail?.toolPending).toBe(true)
      expect(isAwaitingUserReply('idle', tail)).toBe(true)
    })

    it('is false while an ordinary tool is still running (busy lock)', async () => {
      const transcriptPath = await writeTranscript(transcriptWithPendingTool('Bash'))
      const tail = await readSessionTailActivity(transcriptPath)
      expect(isAwaitingUserReply('busy', tail)).toBe(false)
      expect(isAwaitingUserReply(null, tail)).toBe(false)
    })

    it('is true for a pending user-facing question even while the lock is busy', async () => {
      // AskUserQuestion keeps the turn (and the lock) busy for as long as the
      // user has not answered — the pending tool name is the signal.
      const transcriptPath = await writeTranscript(transcriptWithPendingTool('AskUserQuestion'))
      const tail = await readSessionTailActivity(transcriptPath)
      expect(isAwaitingUserReply('busy', tail)).toBe(true)
      expect(isAwaitingUserReply(null, tail)).toBe(true)
      expect(isAwaitingUserReply('idle', tail)).toBe(true)
    })

    it('is false once the tool call is answered', async () => {
      const transcriptPath = await writeTranscript(transcriptWithResolvedTool())
      const tail = await readSessionTailActivity(transcriptPath)
      expect(tail?.toolPending).toBe(false)
      expect(isAwaitingUserReply('idle', tail)).toBe(false)
    })

    it('is false after the user interrupts or sends a new prompt', async () => {
      const transcriptPath = await writeTranscript(
        transcriptWithPendingTool('AskUserQuestion') +
          '\n' +
          JSON.stringify({
            type: 'user',
            timestamp: isoAgo(1_000),
            message: { content: [{ type: 'text', text: 'never mind, do something else' }] },
          })
      )
      const tail = await readSessionTailActivity(transcriptPath)
      expect(tail?.toolPending).toBe(false)
      expect(isAwaitingUserReply('idle', tail)).toBe(false)
      expect(isAwaitingUserReply('busy', tail)).toBe(false)
    })
  })

  describe('resolveSessionAttention (web live feed)', () => {
    it('does NOT alert for a freshly finished turn (regression: waiting-state false positive)', async () => {
      // A turn that just completed normally: recent event, no pending tool,
      // idle lock. This must never read as "Claude needs you".
      const transcriptPath = await writeTranscript(transcriptWithResolvedTool(2_000))
      const tail = await readSessionTailActivity(transcriptPath)
      expect(tail?.state).not.toBe('idle') // fresh enough to be running/waiting
      expect(resolveSessionAttention(undefined, Date.now() - 2_000, tail, 'idle')).toBeNull()
    })

    it('alerts for a turn that ended on an unanswered tool call', async () => {
      const transcriptPath = await writeTranscript(transcriptWithPendingTool('Bash'))
      const tail = await readSessionTailActivity(transcriptPath)
      const attention = resolveSessionAttention(undefined, Date.now() - 40_000, tail, 'idle')
      expect(attention).not.toBeNull()
      expect(attention?.since).toBe(tail?.lastEventAt)
    })

    it('alerts for a pending user question while the turn is still busy', async () => {
      const transcriptPath = await writeTranscript(transcriptWithPendingTool('AskUserQuestion'))
      const tail = await readSessionTailActivity(transcriptPath)
      expect(resolveSessionAttention(undefined, Date.now(), tail, 'busy')).not.toBeNull()
    })

    it('prefers an active hook marker and reports its message', async () => {
      const occurredAt = new Date().toISOString()
      const marker = {
        message: 'Claude needs your permission to use Bash',
        occurredAt,
        schemaVersion: 1 as const,
        sessionId: SESSION_ID,
      }
      const attention = resolveSessionAttention(marker, null, null, 'idle')
      expect(attention).toEqual({ message: marker.message, since: occurredAt })
    })

    it('clears a hook marker once the session shows later activity', async () => {
      const marker = {
        message: 'stale',
        occurredAt: isoAgo(60_000),
        schemaVersion: 1 as const,
        sessionId: SESSION_ID,
      }
      // statusUpdatedAt after the marker means the user responded.
      expect(resolveSessionAttention(marker, Date.now(), null, 'busy')).toBeNull()
    })
  })

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  async function createFakeLiveSession(sessionId: string, status: 'busy' | 'idle'): Promise<void> {
    const sessionsDirectory = join(claudeDirectory, 'sessions')
    await mkdir(sessionsDirectory, { recursive: true })
    await writeFile(
      join(sessionsDirectory, `${sessionId}.json`),
      JSON.stringify({
        sessionId,
        // The test's own process is always alive, so the lock always passes
        // the liveness probe without needing a real Claude Code process.
        pid: process.pid,
        cwd: null,
        startedAt: Date.now(),
        status,
        statusUpdatedAt: Date.now(),
      })
    )
  }

  async function writeTranscript(contents: string): Promise<string> {
    const transcriptPath = join(claudeDirectory, 'transcript.jsonl')
    await writeFile(transcriptPath, contents)
    return transcriptPath
  }

  function isoAgo(milliseconds: number): string {
    return new Date(Date.now() - milliseconds).toISOString()
  }

  function transcriptWithPendingTool(toolName: string): string {
    return JSON.stringify({
      type: 'assistant',
      timestamp: isoAgo(40_000),
      message: {
        content: [{ type: 'tool_use', id: 'tool-1', name: toolName, input: {} }],
      },
    })
  }

  function transcriptWithResolvedTool(ageMs = 35_000): string {
    return [
      JSON.stringify({
        type: 'assistant',
        timestamp: isoAgo(ageMs + 5_000),
        message: {
          content: [{ type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'ls' } }],
        },
      }),
      JSON.stringify({
        type: 'user',
        timestamp: isoAgo(ageMs),
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'ok' }],
        },
      }),
    ].join('\n')
  }
})
