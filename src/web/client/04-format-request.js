// ---------------------------------------------------------------------------
// Shared presentation and request helpers
// ---------------------------------------------------------------------------

/** Escapes a value for safe insertion into HTML attribute or text content. Prevents XSS. */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Returns a human-readable relative time string, e.g. "just now", "3h ago", "2d ago".
 * Used in session row timestamps and inspector panels where full precision is less useful.
 */
function relativeTime(isoTimestamp) {
  const elapsedMs = Date.now() - new Date(isoTimestamp).getTime()
  if (elapsedMs < 60000) return 'just now'

  const minutes = Math.floor(elapsedMs / 60000)
  if (minutes < 60) return minutes + 'm ago'

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return hours + 'h ago'

  const days = Math.floor(hours / 24)
  if (days < 30) return days + 'd ago'

  const months = Math.floor(days / 30)
  return months < 12 ? months + 'mo ago' : Math.floor(months / 12) + 'y ago'
}

/** Formats a token count with k/m suffixes, e.g. 1500 → "1.5k", 2100000 → "2.1m". */
function formatTokenCount(tokenCount) {
  if (tokenCount < 1000) return String(tokenCount)
  if (tokenCount < 1000000) {
    return (tokenCount / 1000).toFixed(tokenCount < 10000 ? 1 : 0) + 'k'
  }
  return (tokenCount / 1000000).toFixed(1) + 'm'
}

/** Returns a short countdown string until the given ISO date, e.g. "2h 15m", "1d 3h". */
function formatResetCountdown(resetAt) {
  if (!resetAt) return ''
  const remainingMinutes = Math.ceil((new Date(resetAt).getTime() - Date.now()) / 60000)
  if (remainingMinutes <= 0) return 'now'
  const days = Math.floor(remainingMinutes / 1440)
  const hours = Math.floor((remainingMinutes % 1440) / 60)
  const minutes = remainingMinutes % 60
  if (days > 0) return days + 'd' + (hours > 0 ? ' ' + hours + 'h' : '')
  if (hours > 0) return hours + 'h' + (minutes > 0 ? ' ' + minutes + 'm' : '')
  return minutes + 'm'
}

/**
 * Shorter variant of relativeTime for tight spaces: "now", "3m", "4h", "2d".
 * Returns an empty string when the timestamp is absent.
 */
function compactRelativeTime(isoTimestamp) {
  if (!isoTimestamp) return ''
  const elapsedMs = Date.now() - new Date(isoTimestamp).getTime()
  if (elapsedMs < 60000) return 'now'
  const minutes = Math.floor(elapsedMs / 60000)
  if (minutes < 60) return minutes + 'm'
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return hours + 'h'
  const days = Math.floor(hours / 24)
  if (days < 30) return days + 'd'
  const months = Math.floor(days / 30)
  return months < 12 ? months + 'mo' : Math.floor(months / 12) + 'y'
}

/**
 * Returns a CSS class modifier for a usage bar: "stale" when data is old,
 * then "danger" (≥100%), "caution" (≥90%), "warn" (≥80%), or "fresh".
 */
function usageLevel(percentage, isStale) {
  if (isStale) return 'stale'
  if (percentage >= 100) return 'danger'
  if (percentage >= 90) return 'caution'
  if (percentage >= 80) return 'warn'
  return 'fresh'
}

/** Appends a usage-limit chip (label + bar + percentage + countdown) to container. No-ops if limit is absent. */
function appendUsageLimit(container, label, limit) {
  if (!limit) return

  const item = document.createElement('span')
  item.className = 'usage-limit ' + usageLevel(limit.usedPercentage, false)

  const labelElement = document.createElement('span')
  labelElement.className = 'usage-limit-label'
  labelElement.textContent = label

  const bar = document.createElement('span')
  bar.className = 'usage-limit-bar'
  const fill = document.createElement('span')
  fill.className = 'usage-limit-fill'
  fill.style.width = Math.max(0, Math.min(100, limit.usedPercentage)) + '%'
  bar.appendChild(fill)

  const value = document.createElement('span')
  value.className = 'usage-limit-value'
  value.textContent = Math.round(limit.usedPercentage) + '%'

  const reset = document.createElement('span')
  reset.className = 'usage-limit-reset'
  reset.textContent = formatResetCountdown(limit.resetsAt)

  item.append(labelElement, bar, value, reset)
  container.appendChild(item)
}

/** Appends a "credits on" badge when the account is on a credits plan. No-ops otherwise. */
function appendUsageCreditsBadge(container) {
  if (!liveUsage || liveUsage.usageCreditsEnabled !== true) return
  const badge = document.createElement('span')
  badge.className = 'usage-credits'
  badge.textContent = 'credits on'
  container.appendChild(badge)
}

/** Re-renders the header usage bar from the current liveUsage snapshot. Safe to call repeatedly. */
function renderUsageSummary() {
  if (!liveUsage) {
    elements.usageSummary.textContent = 'usage loading'
    elements.usageSummary.className = 'usage-summary'
    return
  }

  const fiveHour = liveUsage.rateLimits && liveUsage.rateLimits.fiveHour
  const sevenDay = liveUsage.rateLimits && liveUsage.rateLimits.sevenDay

  elements.usageSummary.replaceChildren()
  elements.usageSummary.className = 'usage-summary'
  const heading = document.createElement('span')
  heading.className = 'usage-heading'
  heading.textContent = 'limits'
  elements.usageSummary.appendChild(heading)
  const state = document.createElement('span')
  state.className = 'usage-state ' + liveUsage.limitsStatus
  state.textContent = usageFeedStatus()
  elements.usageSummary.appendChild(state)
  appendUsageCreditsBadge(elements.usageSummary)
  appendUsageLimit(elements.usageSummary, '5h', fiveHour)
  appendUsageLimit(elements.usageSummary, '7d', sevenDay)
  elements.usageSummary.title =
    liveUsage.limitsSource === 'account-api'
      ? 'Account limits refreshed directly from Claude.'
      : 'Account limits from the latest available Claude status-line observation.'
}

/** Returns a short status string for the usage feed freshness indicator. */
function usageFeedStatus() {
  if (liveUsage.limitsStatus === 'fresh' || liveUsage.limitsStatus === 'stale') {
    if (!liveUsage.limitsUpdatedAt) return 'updated'
    return liveUsage.limitsSource === 'account-api'
      ? 'updated ' + relativeTime(liveUsage.limitsUpdatedAt)
      : 'cached, updated ' + relativeTime(liveUsage.limitsUpdatedAt)
  }
  return 'limits unavailable'
}

/** Returns the last two path segments, normalised to forward slashes: "user/myproject". */
function compactPath(path) {
  return path.replace(/\\/g, '/').split('/').filter(Boolean).slice(-2).join('/')
}

/** Maps a git branch name to a CSS colour variable based on common naming conventions. */
function colorForGitBranch(branch) {
  if (!branch || branch === 'main' || branch === 'master') return 'var(--muted2)'
  if (branch.startsWith('feat/') || branch.startsWith('feature/')) return 'var(--accent)'
  if (branch.startsWith('fix/') || branch.startsWith('hotfix/')) return 'var(--amber)'
  if (branch.startsWith('develop') || branch === 'dev') return 'var(--green)'
  return 'var(--muted2)'
}

/**
 * Returns an HTML badge showing the current branch when it differs from the
 * branch recorded in the session transcript. Empty string when there is no drift.
 */
function buildBranchDriftHtml(session) {
  if (!session.currentBranch || session.currentBranch === session.gitBranch) return ''
  return (
    '<span class="s-drift" title="Project is now on ' +
    escapeHtml(session.currentBranch) +
    '">⇢ ' +
    escapeHtml(session.currentBranch) +
    '</span>'
  )
}

/** Returns an HTML badge for warning/error session states. Empty string for the "ok" state. */
function buildStatusBadgeHtml(session) {
  const status = session.primaryStatus
  if (status === 'interrupted') {
    return '<span class="s-badge s-badge-warn">✗ interrupted</span>'
  }
  if (status === 'expiring') {
    const days =
      session.signals && session.signals.expiresInDays != null ? session.signals.expiresInDays : '?'
    return '<span class="s-badge s-badge-err">⚠ ' + days + 'd left</span>'
  }
  if (status === 'path-missing') {
    return '<span class="s-badge s-badge-err">⚠ path gone</span>'
  }
  if (status === 'heavily-compacted') {
    return '<span class="s-badge s-badge-dim">⤡ heavy ctx</span>'
  }
  return ''
}

/**
 * Fetches a JSON endpoint and returns the parsed body.
 * Throws an Error with a human-readable message on any non-2xx response,
 * using the server-provided `error` or `message` field when present.
 */
async function requestJson(url, options) {
  const response = await fetch(url, options)
  let payload = null
  try {
    payload = await response.json()
  } catch {
    // Preserve the HTTP status when an unexpected non-JSON response is returned.
  }
  if (!response.ok) {
    throw new Error(
      (payload && (payload.error || payload.message)) || 'server returned ' + response.status
    )
  }
  return payload
}

/** Displays a toast notification for TOAST_DURATION_MS. Optional variant: "copied" | "err". */
function showToast(message, variant) {
  elements.toast.textContent = message
  elements.toast.className = 'toast' + (variant ? ' ' + variant : '')
  void elements.toast.offsetWidth
  elements.toast.classList.add('show')
  setTimeout(function () {
    elements.toast.classList.remove('show')
  }, TOAST_DURATION_MS)
}

/** Returns true unless the user has explicitly opted out of the resume-confirmation dialog. */
function shouldConfirmResume() {
  return localStorage.getItem(CONFIRM_RESUME_PREFERENCE) !== 'false'
}
