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

/** Token count above which a session is shown in the "high context" inbox bucket. */
const CONTEXT_HIGH_THRESHOLD = 150_000
/** Sessions updated within this many days appear in "recently touched". */
const RECENT_WITHIN_DAYS = 7
/** localStorage key prefix for rail collapse state. */
const RAIL_STORAGE_KEY = 'swoop:rail:'

/**
 * Review bucket definitions in priority order.
 * The `test` functions are closures — they capture live state on call, not at definition.
 * Labels are STRINGS keys resolved at render time.
 */
const REVIEW_BUCKETS = [
  {
    id: 'active',
    labelKey: 'inboxBucketActive',
    icon: '●',
    cssClass: 'bucket--active',
    test: function (session) {
      return activeSessionIds.has(session.id)
    },
  },
  {
    id: 'attention',
    labelKey: 'inboxBucketAttention',
    icon: '!',
    cssClass: 'bucket--attention',
    test: function (session) {
      return !!(session.signals.interrupted || session.signals.lastToolFailed)
    },
  },
  {
    id: 'branch-drift',
    labelKey: 'inboxBucketBranchDrift',
    icon: '⎇',
    cssClass: 'bucket--drift',
    test: function (session) {
      return !!(
        session.gitBranch &&
        session.currentBranch &&
        session.gitBranch !== session.currentBranch
      )
    },
  },
  {
    id: 'path-missing',
    labelKey: 'inboxBucketPathMissing',
    icon: '⊗',
    cssClass: 'bucket--missing',
    test: function (session) {
      return !session.signals.pathExists
    },
  },
  {
    id: 'high-context',
    labelKey: 'inboxBucketHighContext',
    icon: '◉',
    cssClass: 'bucket--ctx',
    test: function (session) {
      return (session.context.latestContextTokens || 0) >= CONTEXT_HIGH_THRESHOLD
    },
  },
  {
    id: 'expiring',
    labelKey: 'inboxBucketExpiring',
    icon: '⏱',
    cssClass: 'bucket--expiring',
    test: function (session) {
      return session.signals.expiresInDays !== null && session.signals.expiresInDays <= 7
    },
  },
  {
    id: 'recent',
    labelKey: 'inboxBucketRecent',
    icon: '⊙',
    cssClass: 'bucket--recent',
    test: function (session) {
      if (!session.updated) return false
      var cutoff = Date.now() - RECENT_WITHIN_DAYS * 86400000
      return new Date(session.updated).getTime() >= cutoff
    },
  },
]
