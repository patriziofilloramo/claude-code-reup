// ---------------------------------------------------------------------------
// Configuration and application state
// ---------------------------------------------------------------------------

// ── Tunable constants ────────────────────────────────────────────────────────
// Change these to adjust behaviour without touching the surrounding logic.

/** Debounce delay (ms) before auto-saving CLAUDE.md edits to the server. */
const AUTO_SAVE_DELAY_MS = 1500
/** How long to wait (ms) before attempting to reconnect a dropped SSE stream. */
const SSE_RECONNECT_DELAY_MS = 3000
/** How long (ms) a toast notification stays visible before fading out. */
const TOAST_DURATION_MS = 2400
/** How often (ms) to poll /api/usage for updated token-usage figures. Mirrors APP.usagePollMs on the server. */
const USAGE_POLL_INTERVAL_MS = 5000
/** localStorage key for the "always show confirm dialog before resuming" preference. */
const CONFIRM_RESUME_PREFERENCE = 'swoop:confirmResume'

const RISK_RANK = {
  interrupted: 0,
  expiring: 1,
  'path-missing': 2,
  'heavily-compacted': 3,
  ok: 4,
}
