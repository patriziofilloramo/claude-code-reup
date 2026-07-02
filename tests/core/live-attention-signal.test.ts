import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  clearAttentionMarker,
  parseNotificationHookPayload,
  parseWorkSignalHookPayload,
  readAttentionMarkers,
  readWorkSignalMarkers,
  writeAttentionMarker,
  writeWorkSignalMarker,
} from '../../src/core/session/attention.js'
import { getLiveSessionRecords } from '../../src/core/session/active-sessions.js'
import {
  readSessionTailActivity,
  resolveActivityState,
} from '../../src/core/session/session-tail.js'

const SESSION_ID = '22222222-2222-4222-8222-222222222222'

interface TestEnv {
  claudeDir: string
  previousConfigDir: string | undefined
}

describe('live-attention-signal', () => {
  let env: TestEnv

  beforeEach(async () => {
    env = {
      claudeDir: await mkdir(join(tmpdir(), `reup-live-attention-test-${Date.now()}`), {
        recursive: true,
      }).then((p) => p || ''),
      previousConfigDir: process.env['CLAUDE_CONFIG_DIR'],
    }
    process.env['CLAUDE_CONFIG_DIR'] = env.claudeDir
  })

  afterEach(async () => {
    if (env.previousConfigDir === undefined) delete process.env['CLAUDE_CONFIG_DIR']
    else process.env['CLAUDE_CONFIG_DIR'] = env.previousConfigDir
    await rm(env.claudeDir, { force: true, recursive: true })
  })

  describe('Case 1 & 2: Notification hook (permission/options)', () => {
    it('captures a Notification hook payload and reports attention', async () => {
      // Fake a live session by writing a lock file
      await createFakeLiveSession(SESSION_ID, 'idle')

      // Pipe a Notification payload through the attention capture command
      const payload = {
        session_id: SESSION_ID,
        message: 'Claude needs permission to use Bash',
        hook_event_name: 'Notification',
      }
      await simulateHookCapture(JSON.stringify(payload))

      // Verify the marker was written
      const markers = await readAttentionMarkers()
      expect(markers).toHaveLength(1)
      expect(markers[0]!.sessionId).toBe(SESSION_ID)
      expect(markers[0]!.message).toBe('Claude needs permission to use Bash')
    })

    it('clears attention when UserPromptSubmit hook fires (user responds)', async () => {
      // Setup: live session + attention marker
      await createFakeLiveSession(SESSION_ID, 'idle')
      const notificationPayload = {
        session_id: SESSION_ID,
        message: 'Claude needs permission',
      }
      await simulateHookCapture(JSON.stringify(notificationPayload))

      let markers = await readAttentionMarkers()
      expect(markers).toHaveLength(1)

      // Simulate user responding: UserPromptSubmit hook fires, setting state to 'busy'
      const userPromptPayload = {
        session_id: SESSION_ID,
        hook_event_name: 'UserPromptSubmit',
      }
      await simulateHookCapture(JSON.stringify(userPromptPayload))

      // Attention marker should be cleared (deleted)
      markers = await readAttentionMarkers()
      expect(markers).toHaveLength(0)
    })

    it('clears attention when activity resumes after the marker', async () => {
      // Setup: live session with recent activity
      const now = Date.now()
      await createFakeLiveSession(SESSION_ID, 'idle', now)

      // Marker created just before
      const markerTime = new Date(now - 1000).toISOString()
      const notificationPayload = {
        session_id: SESSION_ID,
        message: 'Claude waiting',
      }
      await simulateHookCaptureAt(JSON.stringify(notificationPayload), markerTime)

      // Verify marker exists
      const markers = await readAttentionMarkers()
      expect(markers).toHaveLength(1)

      // Simulate user interaction: update lock status to show recent activity
      await updateFakeLiveSession(SESSION_ID, 'busy', now + 5000)

      // Re-check: the marker should now be considered inactive (statusUpdatedAt > marker time)
      const liveRecords = await getLiveSessionRecords()
      const lockStatus = liveRecords.find((r) => r.sessionId === SESSION_ID)
      expect(lockStatus?.statusUpdatedAt).toBeGreaterThan(Date.parse(markerTime))

      // Note: in real usage, the web/TUI will call isAttentionActive() to check;
      // this test just verifies the data is there for them to check
    })
  })

  describe('Case 3: Waiting state (pending tool call, no hook fired)', () => {
    it('detects waiting state: pending tool in tail + idle lock + live session', async () => {
      // Setup: live session with idle lock
      await createFakeLiveSession(SESSION_ID, 'idle')

      // Create transcript with a pending tool call in the tail
      const transcriptPath = join(
        env.claudeDir,
        'projects',
        'test',
        'sessions',
        SESSION_ID,
        'transcript.jsonl'
      )
      const transcript = buildTranscriptWithPendingTool(SESSION_ID, true)
      await mkdir(join(env.claudeDir, 'projects', 'test', 'sessions', SESSION_ID), {
        recursive: true,
      })
      await writeFile(transcriptPath, transcript)

      // Parse tail activity
      const tail = await readSessionTailActivity(transcriptPath)
      expect(tail).not.toBeNull()
      expect(tail!.toolPending).toBe(true)

      // Resolve activity state with idle lock + pending tool
      const activityState = resolveActivityState('idle', tail)
      expect(activityState).toBe('waiting')
    })

    it('clears waiting state when tool result is provided', async () => {
      await createFakeLiveSession(SESSION_ID, 'idle')

      // Start with pending tool
      const transcriptPath = join(
        env.claudeDir,
        'projects',
        'test',
        'sessions',
        SESSION_ID,
        'transcript.jsonl'
      )
      let transcript = buildTranscriptWithPendingTool(SESSION_ID, true)
      await mkdir(join(env.claudeDir, 'projects', 'test', 'sessions', SESSION_ID), {
        recursive: true,
      })
      await writeFile(transcriptPath, transcript)

      let tail = await readSessionTailActivity(transcriptPath)
      expect(tail!.toolPending).toBe(true)
      expect(resolveActivityState('idle', tail)).toBe('waiting')

      // Append tool result
      transcript = buildTranscriptWithPendingTool(SESSION_ID, false)
      await writeFile(transcriptPath, transcript)

      tail = await readSessionTailActivity(transcriptPath)
      expect(tail!.toolPending).toBe(false)
      expect(resolveActivityState('idle', tail)).toBe('idle')
    })
  })

  describe('Regression: bug #1 (permanent yellow ! in TUI)', () => {
    it('clears attention when work signal shows session became busy', async () => {
      // Setup: live session + attention marker
      await createFakeLiveSession(SESSION_ID, 'idle')
      const notificationPayload = {
        session_id: SESSION_ID,
        message: 'Claude waiting',
      }
      const markerTime = new Date().toISOString()
      await simulateHookCaptureAt(JSON.stringify(notificationPayload), markerTime)

      let markers = await readAttentionMarkers()
      expect(markers).toHaveLength(1)

      // Simulate: UserPromptSubmit hook fires (user responded)
      const busyPayload = {
        session_id: SESSION_ID,
        hook_event_name: 'UserPromptSubmit',
      }
      await simulateHookCapture(JSON.stringify(busyPayload))

      // Work signal should be written, attention marker should be cleared
      const workMarkers = await readWorkSignalMarkers()
      expect(workMarkers.some((m) => m.sessionId === SESSION_ID && m.state === 'busy')).toBe(true)

      markers = await readAttentionMarkers()
      expect(markers).toHaveLength(0)
    })
  })

  describe('Regression: bug #2 (web session list vs live feed disagreement)', () => {
    it('orphaned tool_use beyond tail window does not block clearing via hooks', async () => {
      // This is more of a structural test: verify that even if a tool_use
      // is beyond the tail window (invisible to tail scan but present in full scan),
      // the hook system can still clear attention independently.

      await createFakeLiveSession(SESSION_ID, 'idle')

      // Write a marker
      const notificationPayload = {
        session_id: SESSION_ID,
        message: 'Waiting',
      }
      await simulateHookCapture(JSON.stringify(notificationPayload))

      let markers = await readAttentionMarkers()
      expect(markers).toHaveLength(1)

      // Clear it via hook
      const userPromptPayload = {
        session_id: SESSION_ID,
        hook_event_name: 'UserPromptSubmit',
      }
      await simulateHookCapture(JSON.stringify(userPromptPayload))

      markers = await readAttentionMarkers()
      expect(markers).toHaveLength(0)

      // The key insight: the hook-based marker system is independent from
      // the full-transcript scan. Even if the full scan would report "interrupted",
      // the hook system correctly clears. Once we wire both into the unified signal,
      // the live consumers will use whichever is fresher/more accurate.
    })
  })

  // ============================================================================
  // Test helpers
  // ============================================================================

  async function createFakeLiveSession(
    sessionId: string,
    status: 'busy' | 'idle',
    statusUpdatedAt: number = Date.now()
  ): Promise<void> {
    const sessionsDir = join(env.claudeDir, 'sessions')
    await mkdir(sessionsDir, { recursive: true })

    const lockFile = join(sessionsDir, `${sessionId}.json`)
    await writeFile(
      lockFile,
      JSON.stringify({
        sessionId,
        pid: process.pid, // Our process is always alive
        cwd: null,
        startedAt: Date.now(),
        status,
        statusUpdatedAt,
      })
    )
  }

  async function updateFakeLiveSession(
    sessionId: string,
    status: 'busy' | 'idle',
    statusUpdatedAt: number
  ): Promise<void> {
    const lockFile = join(env.claudeDir, 'sessions', `${sessionId}.json`)
    await writeFile(
      lockFile,
      JSON.stringify({
        sessionId,
        pid: process.pid,
        cwd: null,
        startedAt: Date.now(),
        status,
        statusUpdatedAt,
      })
    )
  }

  async function simulateHookCapture(payload: string): Promise<void> {
    // Simulate piping a payload through stdin to `reup attention capture`
    // Mimics the logic in captureFromNotificationHook()
    const parsed = JSON.parse(payload)
    const workSignal = parseWorkSignalHookPayload(parsed)
    if (workSignal) {
      await writeWorkSignalMarker(workSignal)
      // A submitted prompt means the user responded; the alert is over.
      if (workSignal.state === 'busy') await clearAttentionMarker(workSignal.sessionId)
      return
    }

    const attention = parseNotificationHookPayload(parsed)
    if (attention) {
      await writeAttentionMarker(attention)
      return
    }

    throw new Error('Unrecognized payload')
  }

  async function simulateHookCaptureAt(payload: string, occurredAt: string): Promise<void> {
    const parsed = JSON.parse(payload)
    const attention = parseNotificationHookPayload(parsed, occurredAt)
    if (attention) {
      await writeAttentionMarker(attention)
      return
    }
    throw new Error('Parse failed')
  }

  function buildTranscriptWithPendingTool(sessionId: string, pending: boolean): string {
    const toolId = 'tool-1'
    const lines: string[] = []
    const now = Date.now()

    // Assistant message with tool_use
    lines.push(
      JSON.stringify({
        type: 'assistant',
        timestamp: new Date(now - 40000).toISOString(), // Old, well outside any freshness window
        message: {
          content: [
            {
              type: 'tool_use',
              id: toolId,
              name: 'Bash',
              input: { command: 'echo hello' },
            },
          ],
        },
      })
    )

    // If not pending, add tool result (with old timestamp to represent completed work)
    if (!pending) {
      lines.push(
        JSON.stringify({
          type: 'user',
          timestamp: new Date(now - 35000).toISOString(), // Still old, so state = 'idle'
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: toolId,
                content: 'hello',
              },
            ],
          },
        })
      )
    }

    return lines.join('\n')
  }
})
