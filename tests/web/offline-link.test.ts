import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The offline link state machine, exercised directly.
 *
 * The bug this guards: stopping `reup web` left the page showing its last
 * known active sessions forever, while a silent reconnect loop retried in the
 * background. Nothing told the viewer that every live signal on screen had
 * stopped being true.
 *
 * The browser client has no module system and no DOM test runner here, so the
 * segment is loaded into a scope of explicit stubs. Everything it touches has
 * to be declared, which keeps its collaborators honest.
 */
const CONNECTION_SEGMENT = readFileSync(
  join(process.cwd(), 'src', 'web', 'client', '15-connection.js'),
  'utf8'
)

interface FakeElement {
  className: string
  dataset: Record<string, string>
  textContent: string
  innerHTML: string
  parentNode: FakeElement | null
  children: FakeElement[]
  appendChild(child: FakeElement): FakeElement
  removeChild(child: FakeElement): void
  insertAdjacentHTML(position: string, html: string): void
  addEventListener(type: string, listener: () => void): void
  removeEventListener(type: string, listener: () => void): void
  querySelector(selector: string): FakeElement | null
  focus(): void
}

interface ConnectionModule {
  noteServerUnreachable(): void
  retryServerLinkNow(): void
  dismissOfflineOverlay(): void
  buildOfflineOverlayHtml(): string
  read(): {
    activeSessionIds: Set<string>
    offlineAttempts: number
    offlineOverlay: FakeElement | null
    serverLinkState: string
  }
}

interface Harness {
  module: ConnectionModule
  advance(ms: number): Promise<void>
  bodyClasses: Set<string>
  calls: string[]
  footerStatus: FakeElement
  setServerReachable(reachable: boolean): void
}

function createElement(): FakeElement {
  const stubs = new Map<string, FakeElement>()
  const element: FakeElement = {
    className: '',
    dataset: {},
    textContent: '',
    innerHTML: '',
    parentNode: null,
    children: [],
    appendChild(child) {
      child.parentNode = element
      element.children.push(child)
      return child
    },
    removeChild(child) {
      element.children = element.children.filter((candidate) => candidate !== child)
      child.parentNode = null
    },
    insertAdjacentHTML(_position, html) {
      element.innerHTML += html
    },
    addEventListener() {},
    removeEventListener() {},
    querySelector(selector) {
      if (selector === '.ro-canvas') {
        return element.children.find((child) => child.className === 'ro-canvas') ?? null
      }
      let stub = stubs.get(selector)
      if (!stub) {
        stub = createElement()
        stubs.set(selector, stub)
      }
      return stub
    },
    focus() {},
  }
  return element
}

function createHarness(): Harness {
  const calls: string[] = []
  let currentTime = 1_000_000
  let reachable = false
  let nextTimerId = 1
  const timers = new Map<number, { at: number; fn: () => void; repeat: number | null }>()

  const footerStatus = createElement()
  const body = createElement()
  const bodyClasses = new Set<string>()
  const bodyWithClassList = Object.assign(body, {
    classList: {
      add: (name: string) => bodyClasses.add(name),
      remove: (name: string) => bodyClasses.delete(name),
    },
  })

  const scope: Record<string, unknown> = {
    document: {
      body: bodyWithClassList,
      hidden: false,
      createElement: () => createElement(),
      addEventListener: () => {},
    },
    window: {
      location: { host: 'localhost:3333' },
      matchMedia: () => ({ matches: false }),
    },
    setTimeout: (fn: () => void, ms?: number) => {
      const id = nextTimerId++
      timers.set(id, { at: currentTime + (ms ?? 0), fn, repeat: null })
      return id
    },
    setInterval: (fn: () => void, ms: number) => {
      const id = nextTimerId++
      timers.set(id, { at: currentTime + ms, fn, repeat: ms })
      return id
    },
    clearTimeout: (id: number) => timers.delete(id),
    clearInterval: (id: number) => timers.delete(id),
    Date: { now: () => currentTime },
    fetch: async () => {
      if (!reachable) throw new TypeError('Failed to fetch')
      return { ok: true }
    },

    OFFLINE_PROBE_DELAY_MS: 1200,
    OFFLINE_RETRY_BASE_MS: 2000,
    OFFLINE_RETRY_MAX_MS: 15000,
    OFFLINE_COUNTDOWN_TICK_MS: 250,
    OFFLINE_BAR_WIDTH: 16,

    serverLinkState: 'online',
    offlineProbeTimer: null,
    offlineCountdownTimer: null,
    offlineProbeInFlight: false,
    offlineAttempts: 0,
    offlineNextProbeAt: 0,
    offlineOverlayDismissed: false,
    activeSessionIds: new Set(['session-a', 'session-b']),

    STRINGS: {
      offlineTitle: 'LINK LOST',
      offlineProbeCommand: '$ curl -sS http://{host}/api/active',
      offlineProbeError: 'curl: (7) failed to connect to {host}: connection refused',
      offlineHeadline: 'The reup server stopped responding.',
      offlineLiveness: 'Live session state is unknown.',
      offlineRetryCountdown: 'retrying in {seconds}s · attempt {n}',
      offlineRetryNow: 'reconnecting…',
      offlineRetryButton: 'Retry now',
      offlineDismissButton: 'Dismiss',
      offlineHint: 'Start it again with `reup web`.',
      offlineStatus: 'server offline',
      offlineRestored: 'Link restored.',
    },
    elements: { footerStatus },
    escapeHtml: (value: unknown) =>
      String(value).replace(
        /[&<>"']/g,
        (character) =>
          ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ??
          character
      ),
    fmt: (template: string, vars: Record<string, unknown>) =>
      template.replace(/\{(\w+)\}/g, (_match, key: string) =>
        vars[key] === undefined ? `{${key}}` : String(vars[key])
      ),
    matrixToken: (_name: string, fallback: string) => fallback,
    createMatrixRain: () => ({ stop: () => calls.push('rain:stop') }),
    applyLiveActivity: (entries: unknown[]) => calls.push(`applyLiveActivity:${entries.length}`),
    renderProjects: () => calls.push('renderProjects'),
    showToast: (message: string) => calls.push(`toast:${message}`),
    connectLiveUpdates: () => calls.push('connectLiveUpdates'),
    refreshProjectData: async () => calls.push('refreshProjectData'),
    refreshLiveActivity: async () => calls.push('refreshLiveActivity'),
    refreshUsageSummary: async () => calls.push('refreshUsageSummary'),
  }

  const names = Object.keys(scope)
  const factory = new Function(
    ...names,
    `${CONNECTION_SEGMENT}
     return {
       noteServerUnreachable, retryServerLinkNow, dismissOfflineOverlay,
       buildOfflineOverlayHtml,
       read: () => ({ serverLinkState, offlineAttempts, activeSessionIds, offlineOverlay }),
     }`
  ) as (...args: unknown[]) => ConnectionModule

  const module = factory(...names.map((name) => scope[name]))

  async function advance(ms: number): Promise<void> {
    const target = currentTime + ms
    for (;;) {
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((left, right) => left[1].at - right[1].at)
      if (due.length === 0) break
      const [id, timer] = due[0]
      currentTime = timer.at
      if (timer.repeat === null) timers.delete(id)
      else timer.at = currentTime + timer.repeat
      timer.fn()
      // Let the probe's promise chain settle before the next due timer.
      await Promise.resolve()
      await Promise.resolve()
    }
    currentTime = target
    await Promise.resolve()
  }

  return {
    module,
    advance,
    bodyClasses,
    calls,
    footerStatus,
    setServerReachable: (value: boolean) => {
      reachable = value
    },
  }
}

describe('server link state', () => {
  let harness: Harness

  beforeEach(() => {
    harness = createHarness()
  })

  describe('a dropped stream is only a suspicion', () => {
    it('does not declare an outage inside the grace period', async () => {
      harness.module.noteServerUnreachable()
      await harness.advance(500)

      expect(harness.module.read().serverLinkState).toBe('online')
      expect(harness.module.read().offlineOverlay).toBeNull()
    })

    it('leaves live session state alone until a probe fails', async () => {
      harness.module.noteServerUnreachable()
      await harness.advance(500)

      expect(harness.module.read().activeSessionIds.size).toBe(2)
    })

    it('recovers silently when the server answers the probe', async () => {
      harness.setServerReachable(true)
      harness.module.noteServerUnreachable()
      await harness.advance(1500)

      expect(harness.module.read().serverLinkState).toBe('online')
      expect(harness.module.read().offlineOverlay).toBeNull()
      expect(harness.calls).not.toContain('applyLiveActivity:0')
    })
  })

  describe('a confirmed outage never rewrites live session data', () => {
    beforeEach(async () => {
      harness.module.noteServerUnreachable()
      await harness.advance(1500)
    })

    /**
     * This module observes the link; it does not own live data. An earlier
     * version cleared the active set here, which meant one wrong verdict
     * destroyed state the page cannot refetch while the link is down — and
     * left the feed reading idle after recovery.
     */
    it('leaves the session state the server last reported intact', () => {
      expect(harness.module.read().serverLinkState).toBe('offline')
      expect(harness.module.read().activeSessionIds.size).toBe(2)
      expect(harness.calls).not.toContain('applyLiveActivity:0')
      expect(harness.calls).not.toContain('renderProjects')
    })

    it('marks the page unconfirmed through presentation only', () => {
      expect(harness.bodyClasses).toContain('link-lost')
    })

    it('says so in the footer, which survives dismissing the overlay', () => {
      expect(harness.footerStatus.textContent).toBe('server offline')

      harness.module.dismissOfflineOverlay()

      expect(harness.module.read().offlineOverlay).toBeNull()
      expect(harness.module.read().serverLinkState).toBe('offline')
      expect(harness.footerStatus.textContent).toBe('server offline')
    })

    it('keeps probing on a growing backoff', async () => {
      const attemptsAfterFirstFailure = harness.module.read().offlineAttempts
      await harness.advance(2100)

      expect(harness.module.read().offlineAttempts).toBeGreaterThan(attemptsAfterFirstFailure)
    })
  })

  describe('the overlay', () => {
    beforeEach(async () => {
      harness.module.noteServerUnreachable()
      await harness.advance(1500)
    })

    it('reports the address the page actually failed to reach', () => {
      expect(harness.module.buildOfflineOverlayHtml()).toContain('localhost:3333')
    })

    it('announces itself to assistive technology', () => {
      const html = harness.module.buildOfflineOverlayHtml()

      expect(html).toContain('role="alertdialog"')
      expect(html).toContain('aria-labelledby="ro-title"')
      expect(html).toContain('aria-describedby="ro-body"')
    })

    it('escapes the values it interpolates', () => {
      const html = harness.module.buildOfflineOverlayHtml()

      expect(html).not.toMatch(/<(script|img)/i)
    })
  })

  describe('recovery', () => {
    beforeEach(async () => {
      harness.module.noteServerUnreachable()
      await harness.advance(1500)
      harness.setServerReachable(true)
      harness.module.retryServerLinkNow()
      await harness.advance(10)
    })

    it('returns to the online state and removes the overlay', () => {
      expect(harness.module.read().serverLinkState).toBe('online')
      expect(harness.module.read().offlineOverlay).toBeNull()
    })

    it('asks for one catch-up refresh without touching reconnection policy', () => {
      // The stream comes back on the data layer's own unconditional schedule.
      // Reconnecting from here too would make the feed depend on this verdict.
      expect(harness.calls).toContain('refreshProjectData')
      expect(harness.calls).not.toContain('connectLiveUpdates')
    })

    it('lets the live indicators read as live again', () => {
      expect(harness.bodyClasses).not.toContain('link-lost')
    })

    it('tells the viewer the page is trustworthy again', () => {
      expect(harness.calls).toContain('toast:Link restored.')
    })

    it('stops the countdown timer it started', () => {
      expect(harness.calls).toContain('rain:stop')
    })

    it('shows the overlay again if the server drops a second time', async () => {
      harness.setServerReachable(false)
      harness.module.noteServerUnreachable()
      await harness.advance(1500)

      expect(harness.module.read().offlineOverlay).not.toBeNull()
    })
  })
})
