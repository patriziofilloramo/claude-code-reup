// ---------------------------------------------------------------------------
// Server link state
//
// When `reup web` stops, the page keeps whatever it last knew — including the
// active-session dots — and quietly retries forever. That is the worst failure
// mode this UI has: it keeps asserting sessions are running long after the
// process that knew about them is gone.
//
// This module owns one question: is the server still there? A dropped live
// stream only *suspects* an outage; a failed reachability probe confirms it.
// While offline the page stops claiming anything about liveness and says so.
// ---------------------------------------------------------------------------

var offlineOverlay = null
var offlineRain = null

/** True when the viewer asked the browser to avoid non-essential animation. */
function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

/**
 * Records that the live stream dropped, or that a refresh could not reach the
 * server. Schedules a probe rather than declaring an outage: a server restart
 * drops the stream for a moment and recovers on its own.
 */
function noteServerUnreachable() {
  if (offlineProbeTimer || offlineProbeInFlight) return
  offlineProbeTimer = setTimeout(
    function () {
      offlineProbeTimer = null
      void probeServerReachability()
    },
    serverLinkState === 'offline' ? 0 : OFFLINE_PROBE_DELAY_MS
  )
}

/**
 * Asks the server for the cheapest thing it can answer. A network-level
 * failure means the process is gone; any HTTP response means it is alive.
 */
async function probeServerReachability() {
  if (offlineProbeInFlight) return
  offlineProbeInFlight = true
  try {
    await fetch('/api/active', { cache: 'no-store' })
    markServerOnline()
  } catch {
    markServerOffline()
  } finally {
    offlineProbeInFlight = false
  }
}

/** Confirms an outage: marks the page unconfirmed, then shows and schedules retry. */
function markServerOffline() {
  offlineAttempts += 1
  if (serverLinkState !== 'offline') {
    serverLinkState = 'offline'
    // Deliberately presentation only. Session state stays exactly as the server
    // last reported it: this module observes the link, it does not own live
    // data, and rewriting that data here would make a wrong verdict destroy
    // information the page cannot refetch while the link is down.
    document.body.classList.add('link-lost')
  }

  elements.footerStatus.textContent = STRINGS.offlineStatus
  elements.footerStatus.className = 'ftr-status err'

  var backoff = Math.min(
    OFFLINE_RETRY_BASE_MS * Math.pow(2, offlineAttempts - 1),
    OFFLINE_RETRY_MAX_MS
  )
  offlineNextProbeAt = Date.now() + backoff
  if (offlineProbeTimer) clearTimeout(offlineProbeTimer)
  offlineProbeTimer = setTimeout(function () {
    offlineProbeTimer = null
    void probeServerReachability()
  }, backoff)

  if (!offlineOverlayDismissed) showOfflineOverlay()
  renderOfflineCountdown()
}

/** Clears the outage and asks for one catch-up refresh. */
function markServerOnline() {
  var wasOffline = serverLinkState === 'offline'
  serverLinkState = 'online'
  offlineAttempts = 0
  offlineNextProbeAt = 0
  offlineOverlayDismissed = false
  if (offlineProbeTimer) clearTimeout(offlineProbeTimer)
  offlineProbeTimer = null
  document.body.classList.remove('link-lost')
  hideOfflineOverlay()

  if (!wasOffline) return
  // The stream reconnects on its own unconditional schedule; asking for one
  // refresh here only shortens the catch-up, it is not what restores the feed.
  showToast(STRINGS.offlineRestored)
  void refreshProjectData()
}

/** Skips the remaining backoff when the user asks to reconnect now. */
function retryServerLinkNow() {
  if (offlineProbeTimer) clearTimeout(offlineProbeTimer)
  offlineProbeTimer = null
  offlineNextProbeAt = 0
  renderOfflineCountdown()
  void probeServerReachability()
}

// ---------------------------------------------------------------------------
// Overlay
// ---------------------------------------------------------------------------

function buildOfflineOverlayHtml() {
  var host = escapeHtml(window.location.host)
  return (
    '<div class="ro-panel" role="alertdialog" aria-modal="true" ' +
    'aria-labelledby="ro-title" aria-describedby="ro-body">' +
    '<div class="ro-title" id="ro-title" data-text="' +
    escapeHtml(STRINGS.offlineTitle) +
    '">' +
    escapeHtml(STRINGS.offlineTitle) +
    '</div>' +
    '<div class="ro-term">' +
    '<div class="ro-term-line">' +
    escapeHtml(fmt(STRINGS.offlineProbeCommand, { host: host })) +
    '</div>' +
    '<div class="ro-term-line ro-term-err">' +
    escapeHtml(fmt(STRINGS.offlineProbeError, { host: host })) +
    '<span class="ro-cursor">▋</span>' +
    '</div>' +
    '</div>' +
    '<div class="ro-body" id="ro-body">' +
    '<p class="ro-headline">' +
    escapeHtml(STRINGS.offlineHeadline) +
    '</p>' +
    '<p class="ro-muted">' +
    escapeHtml(STRINGS.offlineLiveness) +
    '</p>' +
    '</div>' +
    '<div class="ro-retry"><span class="ro-bar"></span><span class="ro-retry-text"></span></div>' +
    '<div class="ro-actions">' +
    '<button class="ro-btn ro-btn-primary" data-offline-action="retry">' +
    escapeHtml(STRINGS.offlineRetryButton) +
    '</button>' +
    '<button class="ro-btn" data-offline-action="dismiss">' +
    escapeHtml(STRINGS.offlineDismissButton) +
    '</button>' +
    '</div>' +
    '<div class="ro-hint">' +
    escapeHtml(STRINGS.offlineHint) +
    '</div>' +
    '</div>'
  )
}

function showOfflineOverlay() {
  if (offlineOverlay || !document.body) return

  var overlay = document.createElement('div')
  overlay.id = 'reup-offline'

  if (!prefersReducedMotion()) {
    var canvas = document.createElement('canvas')
    canvas.className = 'ro-canvas'
    overlay.appendChild(canvas)
  }

  overlay.insertAdjacentHTML('beforeend', buildOfflineOverlayHtml())
  overlay.addEventListener('click', handleOfflineOverlayClick)
  document.body.appendChild(overlay)
  offlineOverlay = overlay

  var canvasElement = overlay.querySelector('.ro-canvas')
  if (canvasElement) {
    // A dying signal, not a healthy one: the failure palette and a slower fall
    // read as the same system losing power rather than booting up.
    offlineRain = createMatrixRain(canvasElement, {
      bright: matrixToken('--offline-rain-bright', '#ff8f8f'),
      primary: matrixToken('--offline-rain-primary', '#c04545'),
      speed: 0.45,
      trail: matrixToken('--offline-rain-trail', 'rgba(8,4,4,0.14)'),
    })
  }

  offlineCountdownTimer = setInterval(renderOfflineCountdown, OFFLINE_COUNTDOWN_TICK_MS)
  renderOfflineCountdown()
  var retryButton = overlay.querySelector('[data-offline-action="retry"]')
  if (retryButton) retryButton.focus()
}

function hideOfflineOverlay() {
  if (offlineCountdownTimer) clearInterval(offlineCountdownTimer)
  offlineCountdownTimer = null
  if (offlineRain) offlineRain.stop()
  offlineRain = null
  if (!offlineOverlay) return

  offlineOverlay.removeEventListener('click', handleOfflineOverlayClick)
  if (offlineOverlay.parentNode) offlineOverlay.parentNode.removeChild(offlineOverlay)
  offlineOverlay = null
}

/** Hides the overlay for this outage; the footer keeps saying the link is down. */
function dismissOfflineOverlay() {
  offlineOverlayDismissed = true
  hideOfflineOverlay()
}

function handleOfflineOverlayClick(event) {
  var action = event.target.closest('[data-offline-action]')
  if (!action) return
  if (action.dataset.offlineAction === 'retry') retryServerLinkNow()
  else dismissOfflineOverlay()
}

/** Redraws the countdown bar and its label from the pending retry deadline. */
function renderOfflineCountdown() {
  if (!offlineOverlay) return
  var bar = offlineOverlay.querySelector('.ro-bar')
  var text = offlineOverlay.querySelector('.ro-retry-text')
  if (!bar || !text) return

  var remainingMs = Math.max(0, offlineNextProbeAt - Date.now())
  if (remainingMs === 0 || offlineProbeInFlight) {
    bar.textContent = '[' + '█'.repeat(OFFLINE_BAR_WIDTH) + ']'
    text.textContent = STRINGS.offlineRetryNow
    return
  }

  var totalMs = Math.max(1, offlineNextProbeAt - offlineProbeStartedAt())
  var filled = Math.round(OFFLINE_BAR_WIDTH * (1 - remainingMs / totalMs))
  var blocks = ''
  for (var i = 0; i < OFFLINE_BAR_WIDTH; i++) blocks += i < filled ? '█' : '▒'
  bar.textContent = '[' + blocks + ']'
  text.textContent = fmt(STRINGS.offlineRetryCountdown, {
    n: offlineAttempts,
    seconds: Math.ceil(remainingMs / 1000),
  })
}

/** Start of the current backoff window, derived from its own ceiling-capped length. */
function offlineProbeStartedAt() {
  var backoff = Math.min(
    OFFLINE_RETRY_BASE_MS * Math.pow(2, Math.max(0, offlineAttempts - 1)),
    OFFLINE_RETRY_MAX_MS
  )
  return offlineNextProbeAt - backoff
}

document.addEventListener('keydown', function (event) {
  if (event.key === 'Escape' && offlineOverlay) {
    event.preventDefault()
    dismissOfflineOverlay()
  }
})

// Browsers throttle timers in a hidden tab and freeze it outright after a few
// minutes, so nothing here runs while the user is away — not the poll, not
// even an SSE event already on the wire. Whatever the page was showing when it
// froze is therefore stale the moment it wakes, and waiting out the next poll
// tick leaves a session pulsing "working" seconds after it plainly is not.
//
// Reported from real use: away for a long stretch, the dot stayed a blinking
// green until the window was brought back to the front.
document.addEventListener('visibilitychange', function () {
  if (document.hidden) return
  if (serverLinkState === 'offline') {
    // A backoff that grew while nobody was looking gets an immediate answer.
    retryServerLinkNow()
    return
  }
  // Both halves, in the order the rest of the client uses: session rows carry
  // status badges from the project payload, which is never polled -- it moves
  // only on SSE pushes, and a frozen tab receives none. Refreshing activity
  // alone realigned the live dot while leaving the badge beside it stale.
  // Reported from real use: the server served `interrupted` for half a minute
  // and the row never showed it.
  //
  // Additive only: this asks for fresh state, and never clears what is there.
  void refreshProjectData().then(function () {
    return refreshLiveActivity()
  })
})
