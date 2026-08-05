import { describe, expect, it, vi } from 'vitest'

import { APP } from '../../src/config/app.js'

const execFileMock = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ execFile: execFileMock }))

import {
  activeClaudeAgentSessionIds,
  claudeAgentLiveReading,
  createClaudeAgentSnapshotReader,
  isPresentableClaudeAgentSession,
  parseClaudeAgentSnapshot,
  runClaudeAgentsJsonCommand,
} from '../../src/core/session/claude-agent-state.js'

const SESSION_ID = '11111111-1111-4111-8111-111111111111'
const SECOND_SESSION_ID = '22222222-2222-4222-8222-222222222222'
const NOW = 1_800_000_000_000

describe('claude agents process boundary', () => {
  it('uses fixed argv without a shell and bounds runtime and output', async () => {
    execFileMock.mockImplementationOnce(
      (
        _command: string,
        _args: string[],
        _options: object,
        callback: (error: Error | null, stdout: string) => void
      ) => callback(null, '[]')
    )

    await expect(runClaudeAgentsJsonCommand()).resolves.toBe('[]')
    expect(execFileMock).toHaveBeenCalledWith(
      'claude',
      ['agents', '--json'],
      expect.objectContaining({
        maxBuffer: APP.claudeAgentsMaxOutputBytes,
        shell: false,
        timeout: APP.claudeAgentsCommandTimeoutMs,
        windowsHide: true,
      }),
      expect.any(Function)
    )
  })

  it('propagates process errors to the cache boundary', async () => {
    const error = Object.assign(new Error('command failed'), { code: 'ENOENT' })
    execFileMock.mockImplementationOnce(
      (
        _command: string,
        _args: string[],
        _options: object,
        callback: (error: Error | null, stdout: string) => void
      ) => callback(error, '')
    )

    await expect(runClaudeAgentsJsonCommand()).rejects.toBe(error)
  })
})

describe('claude agents schema boundary', () => {
  it('accepts the measured interactive shape without inventing a state', () => {
    const snapshot = parse([record({ kind: 'interactive', pid: 123 })])

    expect(snapshot?.records.get(SESSION_ID)).toEqual({
      cwd: 'C:\\workspace',
      kind: 'interactive',
      pid: 123,
      reportedLiveState: null,
      reportedStateSince: null,
      sessionId: SESSION_ID,
      startedAt: NOW - 1_000,
      state: null,
      waitingFor: null,
    })
  })

  it('retains the documented pidless blocked background shape as managed state', () => {
    const snapshot = parse([
      record({
        kind: 'background',
        pid: undefined,
        startedAt: NOW - 30 * 24 * 60 * 60_000,
        state: 'blocked',
      }),
    ])
    const parsed = snapshot?.records.get(SESSION_ID)

    expect(parsed).toMatchObject({
      pid: null,
      reportedLiveState: 'needs-input',
      state: 'blocked',
      reportedStateSince: NOW,
    })
    expect(activeClaudeAgentSessionIds(snapshot, NOW)).toEqual(new Set([SESSION_ID]))
  })

  it('requires a local anchor before presenting a pidless official-only row', () => {
    const snapshot = parse([record({ kind: 'background', pid: undefined, state: 'blocked' })])
    const parsed = snapshot?.records.get(SESSION_ID)
    const processBacked = parse([
      record({ kind: 'background', pid: 456, state: 'blocked' }),
    ])?.records.get(SESSION_ID)

    expect(
      isPresentableClaudeAgentSession(parsed, {
        hasLiveLock: false,
        hasResumeVisibleSession: false,
      })
    ).toBe(false)
    expect(
      isPresentableClaudeAgentSession(parsed, {
        hasLiveLock: true,
        hasResumeVisibleSession: false,
      })
    ).toBe(true)
    expect(
      isPresentableClaudeAgentSession(parsed, {
        hasLiveLock: false,
        hasResumeVisibleSession: true,
      })
    ).toBe(true)
    expect(
      isPresentableClaudeAgentSession(undefined, {
        hasLiveLock: false,
        hasResumeVisibleSession: false,
      })
    ).toBe(false)
    expect(
      isPresentableClaudeAgentSession(undefined, {
        hasLiveLock: true,
        hasResumeVisibleSession: false,
      })
    ).toBe(true)
    expect(
      isPresentableClaudeAgentSession(processBacked, {
        hasLiveLock: false,
        hasResumeVisibleSession: false,
      })
    ).toBe(true)
  })

  it.each([
    'permission prompt',
    'input needed',
    'sandbox request',
    'worker request',
    'dialog open',
  ] as const)('keeps the documented waiting reason %s', (waitingFor) => {
    const snapshot = parse([
      record({ kind: 'background', state: 'blocked', status: 'waiting', waitingFor }),
    ])

    expect(snapshot?.records.get(SESSION_ID)).toMatchObject({
      reportedLiveState: 'needs-input',
      waitingFor,
    })
  })

  it('does not promote an unknown or out-of-context waiting reason', () => {
    const unknown = parse([
      record({ kind: 'background', state: 'blocked', waitingFor: 'future request' }),
    ])
    const outOfContext = parse([
      record({ kind: 'interactive', pid: 123, waitingFor: 'permission prompt' }),
    ])

    expect(unknown?.records.get(SESSION_ID)?.waitingFor).toBeNull()
    expect(outOfContext?.records.get(SESSION_ID)?.waitingFor).toBeNull()
  })

  it.each(['done', 'failed', 'stopped'] as const)(
    'maps terminal state %s explicitly from process presence',
    (state) => {
      const snapshot = parse([
        record({ kind: 'background', pid: undefined, state }),
        record({ kind: 'background', pid: 456, sessionId: SECOND_SESSION_ID, state }),
      ])

      expect(snapshot?.records.get(SESSION_ID)?.reportedLiveState).toBe('detached')
      expect(snapshot?.records.get(SECOND_SESSION_ID)?.reportedLiveState).toBe('attached')
      expect(activeClaudeAgentSessionIds(snapshot, NOW)).toEqual(new Set([SECOND_SESSION_ID]))
    }
  )

  it('isolates malformed records and rejects duplicate session IDs', () => {
    const snapshot = parse([
      record({ sessionId: 'not-a-session-id' }),
      record({ kind: 'background', state: 'blocked' }),
      record({ kind: 'background', state: 'working' }),
      record({ sessionId: SECOND_SESSION_ID, startedAt: 'yesterday' }),
    ])

    expect(snapshot?.records.size).toBe(0)
  })

  it('rejects malformed envelopes instead of interpreting partial data', () => {
    expect(parseClaudeAgentSnapshot('{"agents":[]}', NOW)).toBeNull()
    expect(parseClaudeAgentSnapshot('not json', NOW)).toBeNull()
    expect(parseClaudeAgentSnapshot('', NOW)).toBeNull()
  })

  it('marks readings stale or superseded without erasing provenance', () => {
    const snapshot = parse([record({ kind: 'background', state: 'working' })])
    const stale = claudeAgentLiveReading(
      snapshot,
      SESSION_ID,
      null,
      false,
      NOW + APP.claudeAgentsStateFreshMs + 1
    )
    const superseded = claudeAgentLiveReading(snapshot, SESSION_ID, NOW + 1, false, NOW)

    expect(stale).toMatchObject({
      isFresh: false,
      observedAt: NOW,
      source: 'claude-agents',
      state: 'working',
    })
    expect(superseded?.isSuperseded).toBe(true)
  })

  it('does not trust a snapshot timestamp from the future', () => {
    const snapshot = parseClaudeAgentSnapshot(
      JSON.stringify([record({ kind: 'background', state: 'working' })]),
      NOW + 1
    )

    expect(claudeAgentLiveReading(snapshot, SESSION_ID, null, false, NOW)?.isFresh).toBe(false)
    expect(activeClaudeAgentSessionIds(snapshot, NOW)).toEqual(new Set())
  })

  it('does not let a terminal no-process row override a currently live lock', () => {
    const snapshot = parse([record({ kind: 'background', pid: undefined, state: 'stopped' })])

    expect(claudeAgentLiveReading(snapshot, SESSION_ID, null, true, NOW)?.isSuperseded).toBe(true)
  })
})

describe('claude agents stale-while-revalidate cache', () => {
  it('returns the lock-only cold path immediately and single-flights its refresh', async () => {
    let completeCommand: ((output: string) => void) | undefined
    const execute = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          completeCommand = resolve
        })
    )
    const reader = createClaudeAgentSnapshotReader(execute, () => NOW)

    await expect(reader.read('background')).resolves.toBeNull()
    const waitingRead = reader.read('wait')
    expect(execute).toHaveBeenCalledTimes(1)
    completeCommand?.(JSON.stringify([record({ kind: 'background', state: 'blocked' })]))
    await expect(waitingRead).resolves.toMatchObject({ observedAt: NOW })
  })

  it('retains a failed refresh only for safety while the live reading expires', async () => {
    let currentTime = NOW
    const execute = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce(JSON.stringify([record({ kind: 'background', state: 'working' })]))
      .mockRejectedValueOnce(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }))
    const reader = createClaudeAgentSnapshotReader(execute, () => currentTime)

    const initial = await reader.read('wait')
    currentTime += APP.claudeAgentsRefreshMs + 1
    const retainedAfterFailure = await reader.read('wait')
    currentTime = NOW + APP.claudeAgentsStateFreshMs + 1

    expect(retainedAfterFailure).toBe(initial)
    expect(
      claudeAgentLiveReading(retainedAfterFailure, SESSION_ID, null, false, currentTime)?.isFresh
    ).toBe(false)
    expect(activeClaudeAgentSessionIds(retainedAfterFailure, currentTime)).toEqual(new Set())
    expect(activeClaudeAgentSessionIds(retainedAfterFailure, currentTime, true)).toEqual(
      new Set([SESSION_ID])
    )

    currentTime = NOW + APP.claudeAgentsSafetyRetentionMs + 1
    await expect(reader.read('cached')).resolves.toBeNull()
  })

  it('replaces retained records after a successful empty snapshot', async () => {
    let currentTime = NOW
    const execute = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce(JSON.stringify([record({ kind: 'background', state: 'blocked' })]))
      .mockResolvedValueOnce('[]')
    const reader = createClaudeAgentSnapshotReader(execute, () => currentTime)

    expect((await reader.read('wait'))?.records.size).toBe(1)
    currentTime += APP.claudeAgentsRefreshMs + 1
    expect((await reader.read('wait'))?.records.size).toBe(0)
  })

  it('keeps one stable transition time across unchanged blocked snapshots', async () => {
    let currentTime = NOW
    const blocked = JSON.stringify([
      record({
        kind: 'background',
        state: 'blocked',
        status: 'waiting',
        waitingFor: 'permission prompt',
      }),
    ])
    const changedReason = JSON.stringify([
      record({
        kind: 'background',
        state: 'blocked',
        status: 'waiting',
        waitingFor: 'input needed',
      }),
    ])
    const execute = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce(blocked)
      .mockResolvedValueOnce(blocked)
      .mockResolvedValueOnce(changedReason)
    const reader = createClaudeAgentSnapshotReader(execute, () => currentTime)

    const first = await reader.read('wait')
    currentTime += APP.claudeAgentsRefreshMs + 1
    const unchanged = await reader.read('wait')
    expect(unchanged?.observedAt).toBe(currentTime)
    expect(unchanged?.records.get(SESSION_ID)?.reportedStateSince).toBe(NOW)
    expect(
      claudeAgentLiveReading(unchanged, SESSION_ID, null, false, currentTime)?.stateSince
    ).toBe(NOW)

    currentTime += APP.claudeAgentsRefreshMs + 1
    const changed = await reader.read('wait')
    expect(changed?.records.get(SESSION_ID)?.reportedStateSince).toBe(currentTime)
    expect(first?.records.get(SESSION_ID)?.reportedStateSince).toBe(NOW)
  })

  it('resets transition identity after a long observation outage', async () => {
    let currentTime = NOW
    const blocked = JSON.stringify([
      record({
        kind: 'background',
        state: 'blocked',
        status: 'waiting',
        waitingFor: 'permission prompt',
      }),
    ])
    const execute = vi.fn<() => Promise<string>>().mockResolvedValue(blocked)
    const reader = createClaudeAgentSnapshotReader(execute, () => currentTime)

    const first = await reader.read('wait')
    currentTime += APP.claudeAgentsSafetyRetentionMs + 1
    const observedAfterOutage = await reader.read('wait')

    expect(first?.records.get(SESSION_ID)?.reportedStateSince).toBe(NOW)
    expect(observedAfterOutage?.records.get(SESSION_ID)?.reportedStateSince).toBe(currentTime)
  })
})

function parse(records: unknown[]) {
  return parseClaudeAgentSnapshot(JSON.stringify(records), NOW)
}

function record(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    cwd: 'C:\\workspace',
    kind: 'interactive',
    name: 'discarded at boundary',
    sessionId: SESSION_ID,
    startedAt: NOW - 1_000,
    ...overrides,
  }
}
