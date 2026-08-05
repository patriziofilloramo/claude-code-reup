import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  resolveSessionLiveState,
  resolveUserInputWait,
} from '../../src/core/session/session-live-state.js'
import type { SessionLiveEvidence } from '../../src/core/session/session-live-state.js'
import type { AttentionMarker } from '../../src/core/session/attention.js'
import type { ClaudeAgentLiveReading } from '../../src/core/session/claude-agent-state.js'
import type { SessionTailActivity } from '../../src/core/session/session-tail.js'

/**
 * The base live experience must be identical in the TUI, the web UI and the
 * VS Code extension. It drifted before precisely because each surface derived
 * its own answer from the same files: the TUI called a session busy for ten
 * seconds after its last transcript event, the web ran the full activity
 * resolver, and the extension had no notion of activity at all. The reported
 * symptom was a session pulsing in one surface and sitting still in another.
 */
describe('shared session live state', () => {
  it('reports a session with no live process as detached, whatever else says', () => {
    // Evidence can look busy after a crash; the absent process settles it.
    expect(
      resolveSessionLiveState(
        evidence({ hasLiveProcess: false, workStatus: 'busy', workStatusUpdatedAt: NOW })
      )
    ).toBe('detached')
  })

  it('puts a session blocked on the user above anything it appears to be doing', () => {
    expect(
      resolveSessionLiveState(
        evidence({ needsInput: true, workStatus: 'busy', workStatusUpdatedAt: NOW })
      )
    ).toBe('needs-input')
  })

  it('lets a fresh official blocked state recover a session with no live lock', () => {
    expect(
      resolveSessionLiveState(
        evidence({
          claudeAgentReading: officialReading({ state: 'needs-input' }),
          hasLiveProcess: false,
        }),
        NOW
      )
    ).toBe('needs-input')
  })

  it('lets a fresh official working state override older fallback evidence', () => {
    expect(
      resolveSessionLiveState(
        evidence({
          claudeAgentReading: officialReading({ state: 'working' }),
          needsInput: true,
          workStatus: 'idle',
        }),
        NOW
      )
    ).toBe('working')
  })

  it('never applies stale or locally superseded official evidence', () => {
    const staleReading = officialReading({ isFresh: false, state: 'needs-input' })
    const supersededReading = officialReading({ isSuperseded: true, state: 'working' })

    expect(
      resolveSessionLiveState(
        evidence({ claudeAgentReading: staleReading, hasLiveProcess: false }),
        NOW
      )
    ).toBe('detached')
    expect(
      resolveSessionLiveState(
        evidence({ claudeAgentReading: supersededReading, workStatus: 'idle' }),
        NOW
      )
    ).toBe('attached')
    // Rejection does not erase the provenance a caller may need to explain.
    expect(staleReading).toMatchObject({ source: 'claude-agents', observedAt: NOW })
  })

  it('reports a session as working while a reported turn is in flight', () => {
    expect(
      resolveSessionLiveState(evidence({ workStatus: 'busy', workStatusUpdatedAt: NOW }), NOW)
    ).toBe('working')
  })

  it('reports a session as working when only the transcript proves the turn is live', () => {
    // No lock status and no hook marker: the VS Code case. The tail's own
    // turn-in-flight marker is the evidence, and it must be believed.
    expect(
      resolveSessionLiveState(
        evidence({ tail: tail({ turnInFlight: true }), workStatus: null }),
        NOW
      )
    ).toBe('working')
  })

  it('collapses every quieter reading into attached rather than guessing', () => {
    // A finished turn and a long tool call look identical once the transcript
    // goes quiet. Attached says what is certain — a process is here — and
    // leaves the rest to surfaces that opt into the finer reading.
    expect(
      resolveSessionLiveState(evidence({ workStatus: 'idle', workStatusUpdatedAt: NOW }), NOW)
    ).toBe('attached')
    expect(
      resolveSessionLiveState(
        evidence({ tail: tail({ turnInFlight: false }), workStatus: null }),
        NOW
      )
    ).toBe('attached')
    // An unreadable transcript is not evidence of anything.
    expect(resolveSessionLiveState(evidence({ tail: null, workStatus: null }), NOW)).toBe(
      'attached'
    )
  })

  it('never reports a state outside the shared vocabulary', () => {
    const allowed = new Set(['needs-input', 'working', 'attached', 'detached'])
    for (const hasLiveProcess of [true, false]) {
      for (const needsInput of [true, false]) {
        for (const workStatus of ['busy', 'idle', null] as const) {
          for (const currentTail of [null, tail({ turnInFlight: true }), tail({})]) {
            const state = resolveSessionLiveState(
              {
                claudeAgentReading: null,
                hasLiveProcess,
                needsInput,
                tail: currentTail,
                workStatus,
                workStatusUpdatedAt: NOW,
              },
              NOW
            )
            expect(allowed).toContain(state)
          }
        }
      }
    }
  })
})

/**
 * One implementation for every surface. This decision previously existed
 * twice — once for the inbox and the extension, once inside the web activity
 * model, which needed a message rather than a boolean — and two copies of it
 * is exactly how surfaces drift apart.
 */
describe('shared user-input wait', () => {
  it('reports an active marker, which outranks anything the tail says', () => {
    const marker = attentionMarker()
    const result = resolveUserInputWait(marker, 'busy', NOW, tail({ turnInFlight: true }))

    expect(result.wait).toEqual({ kind: 'marker', marker })
    expect(result.staleMarkerSessionId).toBeNull()
  })

  it('uses a fresh official wait reason ahead of fallback sources', () => {
    const result = resolveUserInputWait(
      attentionMarker(),
      'busy',
      NOW,
      tail({ turnInFlight: true }),
      officialReading({ state: 'needs-input', waitingFor: 'sandbox request' })
    )

    expect(result.wait).toEqual({
      kind: 'claude-agents',
      since: NOW,
      waitingFor: 'sandbox request',
    })
    expect(result.staleMarkerSessionId).toBe(attentionMarker().sessionId)
  })

  it('does not let a stale official wait suppress a current marker', () => {
    const marker = attentionMarker()
    const result = resolveUserInputWait(
      marker,
      'idle',
      NOW,
      null,
      officialReading({ isFresh: false, state: 'working' })
    )

    expect(result.wait).toEqual({ kind: 'marker', marker })
  })

  it('reports a stale marker for deletion instead of deleting it', () => {
    // Pure by contract: surfaces call this at render time, so it may not touch
    // the filesystem. The caller that owns marker storage does the deleting.
    const marker = attentionMarker({ occurredAt: new Date(NOW - 60_000).toISOString() })
    const result = resolveUserInputWait(marker, 'busy', NOW, tail({ lastEventAt: isoAt(NOW) }))

    expect(result.wait).toBeNull()
    expect(result.staleMarkerSessionId).toBe(marker.sessionId)
  })

  it('falls back to a blocked turn when no hook fired', () => {
    // The permission-prompt case for clients whose hooks never reach us: the
    // turn ended with a tool call nobody answered.
    const result = resolveUserInputWait(
      undefined,
      'idle',
      NOW,
      tail({ lastEventAt: isoAt(NOW), toolPending: true })
    )

    expect(result.wait).toEqual({ kind: 'blocked-turn', since: isoAt(NOW) })
  })

  it('reports no wait for a session that is simply working', () => {
    expect(
      resolveUserInputWait(undefined, 'busy', NOW, tail({ turnInFlight: true })).wait
    ).toBeNull()
  })
})

/**
 * Guards the boundary itself, not just the resolver. Each surface must consume
 * the shared state; a surface that rebuilds liveness from raw evidence is the
 * regression, even when its own tests pass.
 */
describe('every surface draws the shared live state', () => {
  it('resolves the TUI marker from the core instead of its own recency rule', () => {
    const app = readFileSync('src/tui/App.tsx', 'utf8')
    const marker = readFileSync('src/tui/session-status-marker.ts', 'utf8')

    expect(app).toContain('resolveLiveSessionSignals(')
    // The rule that made the TUI disagree with the web: a session counted as
    // busy purely because its transcript was written in the last ten seconds.
    expect(app).not.toContain('TRANSCRIPT_RUNNING_WINDOW_MS')
    expect(marker).toContain('liveState')
    expect(marker).not.toContain('isBusy')
  })

  it('draws every TUI liveness dot through the one marker', () => {
    // The resume card used to colour its own dot from a bare isActive boolean,
    // so it showed full green for a session the list beside it had already
    // dimmed to attached. A second mapping is a second source of truth.
    const resumeCard = readFileSync('src/tui/components/ResumeCard.tsx', 'utf8')

    expect(resumeCard).toContain('sessionStatusMarker(')
    expect(resumeCard).not.toContain('isActive ? COLORS.ok')
  })

  it('resolves the web dot from the core, refining only the attached state', () => {
    const model = readFileSync('src/web/live-activity-model.ts', 'utf8')
    const client = readFileSync('src/web/client.js', 'utf8')

    expect(model).toContain('resolveSessionLiveState(')
    expect(model).toContain('liveState:')
    expect(client).toContain('entry.liveState')
    // The refinement is allowed only on top of the shared reading, and only
    // when a source actually reported the turn boundary.
    expect(client).toContain("entry.activityState === 'waiting' && entry.stateIsReported === true")
  })

  it('asks the core whether a session is blocked on the user, in one place', () => {
    const signals = readFileSync('src/core/session/live-attention.ts', 'utf8')
    const model = readFileSync('src/web/live-activity-model.ts', 'utf8')

    for (const source of [signals, model]) {
      expect(source).toContain('resolveUserInputWait(')
      // The two ingredients of that decision. A surface reaching for them
      // directly is rebuilding the copy this consolidated.
      expect(source).not.toContain('isAttentionActive(')
      expect(source).not.toContain('isAwaitingUserReply(')
    }
  })

  it('states the work-state alphabet once', () => {
    // Three names and four inline spellings of 'busy' | 'idle' used to coexist,
    // which is how a rule written against one source silently misses another.
    const sources = [
      'src/core/session/active-sessions.ts',
      'src/core/session/attention.ts',
      'src/core/session/session-live-state.ts',
      'src/core/session/session-tail.ts',
      'src/web/live-activity-model.ts',
    ].map((path) => readFileSync(path, 'utf8'))
    const declarations = sources.filter((source) => source.includes("= 'busy' | 'idle'"))

    expect(declarations).toHaveLength(1)
    expect(sources.join('\n')).not.toContain('SessionLockStatus =')
  })

  /**
   * The extension draws liveness in three places, and checking only the tree
   * icon let the dashboard and the inspector keep a binary `isActive` dot long
   * after the TUI and the web had four states. Reported from real use: a
   * session between turns showed bright green there and dimmed everywhere
   * else. Every place that paints liveness has to read the shared state.
   */
  it('draws every VS Code liveness indicator from the shared state', () => {
    const dashboard = readFileSync('extension/src/dashboard.ts', 'utf8')
    const inspector = readFileSync('extension/src/inspector-html.ts', 'utf8')

    for (const source of [dashboard, inspector]) {
      expect(source).toContain('liveState')
      // The binary reading that hid the distinction.
      expect(source).not.toContain("isActive ? 'live'")
      expect(source).not.toContain('isActive && !session.needsInput')
    }
    // Attached is the live colour held back, never a second colour.
    expect(dashboard).toContain('.dot.attached')
    expect(inspector).toContain('.pill-attached')
  })

  it('resolves the VS Code icon from the core instead of a bare live flag', () => {
    const signals = readFileSync('src/core/session/live-attention.ts', 'utf8')
    const formatting = readFileSync('extension/src/formatting.ts', 'utf8')

    expect(signals).toContain('resolveSessionLiveState(')
    expect(signals).toContain('liveStateBySession')
    expect(formatting).toContain('liveState: SessionLiveState')
    // isActive alone cannot distinguish working from attached, which is why
    // the extension showed one icon for both.
    expect(formatting).not.toContain('isActive')
  })
})

const NOW = 1_700_000_000_000

function isoAt(ms: number): string {
  return new Date(ms).toISOString()
}

function attentionMarker(overrides: Partial<AttentionMarker> = {}): AttentionMarker {
  return {
    message: 'Claude needs your permission to use Bash',
    occurredAt: isoAt(NOW),
    schemaVersion: 1,
    sessionId: '00000000-0000-4000-8000-000000000000',
    ...overrides,
  } as AttentionMarker
}

function evidence(overrides: Partial<SessionLiveEvidence> = {}): SessionLiveEvidence {
  return {
    claudeAgentReading: null,
    hasLiveProcess: true,
    needsInput: false,
    tail: null,
    workStatus: null,
    workStatusUpdatedAt: null,
    ...overrides,
  }
}

function officialReading(overrides: Partial<ClaudeAgentLiveReading> = {}): ClaudeAgentLiveReading {
  return {
    isFresh: true,
    isSuperseded: false,
    observedAt: NOW,
    source: 'claude-agents',
    state: 'working',
    stateSince: NOW,
    waitingFor: null,
    ...overrides,
  }
}

function tail(overrides: Partial<SessionTailActivity> = {}): SessionTailActivity {
  return {
    conversationalEvents: 3,
    endsWithQuestion: false,
    lastEventAt: new Date(NOW).toISOString(),
    lastToolName: null,
    toolPending: false,
    turnInFlight: false,
    ...overrides,
  }
}
