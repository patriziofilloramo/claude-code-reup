// ---------------------------------------------------------------------------
// Configuration and application state
// ---------------------------------------------------------------------------

// ── Tunable constants ────────────────────────────────────────────────────────
// Change these to adjust behaviour without touching the surrounding logic.

/** Debounce delay (ms) before auto-saving CLAUDE.md edits to the server. */
const AUTO_SAVE_DELAY_MS = 1500
/** How long to wait (ms) before attempting to reconnect a dropped SSE stream. */
const SSE_RECONNECT_DELAY_MS = 3000
/** Coalesces bursts of filesystem SSE events into a single full data refresh. */
const SSE_REFRESH_DEBOUNCE_MS = 300
/** How long (ms) a toast notification stays visible before fading out. */
const TOAST_DURATION_MS = 2400
/** How often (ms) to poll /api/usage for updated token-usage figures. Mirrors APP.usagePollMs on the server. */
const USAGE_POLL_INTERVAL_MS = 5000
/** How often (ms) to refresh /api/live-activity when active sessions exist. */
const LIVE_ACTIVITY_POLL_MS = 3000
/** How often (ms) to re-render the live strip so relative ages stay current. */
const LIVE_STRIP_TICK_MS = 1000
/** localStorage key for the "always show confirm dialog before resuming" preference. */
const CONFIRM_RESUME_PREFERENCE = 'reup:confirmResume'
const LEGACY_CONFIRM_RESUME_PREFERENCE = 'swo' + 'op:confirmResume'

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
const RAIL_STORAGE_KEY = 'reup:rail:'
const LEGACY_RAIL_STORAGE_KEY = 'swo' + 'op:rail:'
migrateLegacyLocalStorageKeys()

function migrateLegacyLocalStorageKeys() {
  try {
    migrateLocalStorageKey(LEGACY_CONFIRM_RESUME_PREFERENCE, CONFIRM_RESUME_PREFERENCE)
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index)
      if (!key || !key.startsWith(LEGACY_RAIL_STORAGE_KEY)) continue
      const nextKey = RAIL_STORAGE_KEY + key.slice(LEGACY_RAIL_STORAGE_KEY.length)
      migrateLocalStorageKey(key, nextKey)
    }
  } catch {
    /* Storage can be unavailable in restrictive browser modes. */
  }
}

function migrateLocalStorageKey(previousKey, nextKey) {
  if (localStorage.getItem(nextKey) === null) {
    const previousValue = localStorage.getItem(previousKey)
    if (previousValue !== null) localStorage.setItem(nextKey, previousValue)
  }
  localStorage.removeItem(previousKey)
}

/**
 * Review bucket definitions in priority order.
 * The `test` functions are closures — they capture live state on call, not at definition.
 * Labels are STRINGS keys resolved at render time.
 */
const REVIEW_BUCKETS = [
  {
    id: 'active',
    labelKey: 'inboxBucketActive',
    searchToken: 'is:active',
    icon: '●',
    cssClass: 'bucket--active',
    test: function (session) {
      return activeSessionIds.has(session.id)
    },
  },
  {
    id: 'attention',
    labelKey: 'inboxBucketAttention',
    searchToken: 'is:attention',
    icon: '!',
    cssClass: 'bucket--attention',
    test: function (session) {
      return !!(session.signals.interrupted || session.signals.lastToolFailed)
    },
  },
  {
    id: 'branch-drift',
    labelKey: 'inboxBucketBranchDrift',
    searchToken: 'is:branch-drift',
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
    searchToken: 'is:path-missing',
    icon: '⊗',
    cssClass: 'bucket--missing',
    test: function (session) {
      return !session.signals.pathExists
    },
  },
  {
    id: 'high-context',
    labelKey: 'inboxBucketHighContext',
    searchToken: 'is:high-context',
    icon: '◉',
    cssClass: 'bucket--ctx',
    test: function (session) {
      return (session.context.latestContextTokens || 0) >= CONTEXT_HIGH_THRESHOLD
    },
  },
  {
    id: 'expiring',
    labelKey: 'inboxBucketExpiring',
    searchToken: 'is:expiring',
    icon: '⏱',
    cssClass: 'bucket--expiring',
    test: function (session) {
      return session.signals.expiresInDays !== null && session.signals.expiresInDays <= 7
    },
  },
  {
    id: 'recent',
    labelKey: 'inboxBucketRecent',
    searchToken: 'is:recent',
    icon: '⊙',
    cssClass: 'bucket--recent',
    test: function (session) {
      if (!session.updated) return false
      var cutoff = Date.now() - RECENT_WITHIN_DAYS * 86400000
      return new Date(session.updated).getTime() >= cutoff
    },
  },
]
