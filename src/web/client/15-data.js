// ---------------------------------------------------------------------------
// Data refresh and live updates
// ---------------------------------------------------------------------------

/**
 * Fetches /api/usage and updates the header usage bar.
 * Guards against concurrent in-flight requests with the usageRefreshInProgress flag.
 */
async function refreshUsageSummary() {
  if (usageRefreshInProgress) return
  usageRefreshInProgress = true
  try {
    liveUsage = await requestJson('/api/usage')
    renderUsageSummary()
  } catch (error) {
    console.error('[reup] failed to refresh usage:', error)
  } finally {
    usageRefreshInProgress = false
  }
}

/**
 * Fetches projects, active session IDs, and a lightweight diagnostics summary in parallel.
 * Updates global state, shows the diagnostics footer button if issues exist, and re-renders
 * both panels. On first call, auto-selects the session from the URL hash (deep-link support).
 */
async function refreshProjectData() {
  try {
    const [loadedProjects, activeData, diagnosticsData, loadedOrgData] = await Promise.all([
      requestJson('/api/projects'),
      requestJson('/api/active'),
      requestJson('/api/diagnostics').catch(function () {
        return null
      }),
      requestJson('/api/org').catch(function () {
        return null
      }),
    ])
    projects = loadedProjects
    activeSessionIds = new Set(activeData.sessionIds || [])
    if (loadedOrgData) orgData = loadedOrgData

    if (diagnosticsData) {
      const issueCount =
        (diagnosticsData.expiring ? diagnosticsData.expiring.length : 0) +
        (diagnosticsData.pathMissing ? diagnosticsData.pathMissing.length : 0) +
        (diagnosticsData.orphanedTranscripts ? diagnosticsData.orphanedTranscripts.length : 0) +
        (diagnosticsData.brokenIndices ? diagnosticsData.brokenIndices.length : 0) +
        (diagnosticsData.staleLocks ? diagnosticsData.staleLocks.length : 0)
      if (issueCount > 0) {
        elements.diagnosticsButton.textContent =
          issueCount === 1
            ? fmt(STRINGS.statusBarDiagnostics, { n: issueCount })
            : fmt(STRINGS.statusBarDiagnosticsPlural, { n: issueCount })
        elements.diagnosticsButton.style.display = ''
      } else {
        elements.diagnosticsButton.style.display = 'none'
      }
    }

    elements.footerStatus.textContent = fmt(STRINGS.statusBarProjects, { n: projects.length })
    elements.footerStatus.className = 'ftr-status'

    if (selectedProject) {
      selectedProject =
        projects.find(function (project) {
          return project.id === selectedProject.id
        }) || null
      if (!selectedProject) {
        selectedSession = null
        renamingSessionId = null
      }
    }

    reconcileFocusFilterAfterOrgChange()
    synchronizeSelectedProjectWithView()
    renderRail()
    renderProjects()
    renderFocusBar()
    renderSessions()
    hideLoadingOverlay()

    // Deep-link: on first load, auto-select session if URL has a session hash
    if (!deepLinkProcessed) {
      deepLinkProcessed = true
      const sessionHash = location.hash.slice(1)
      if (sessionHash && !selectedSession) {
        for (var dlpi = 0; dlpi < projects.length; dlpi++) {
          var dlSessions = projects[dlpi].sessions
          for (var dlsi = 0; dlsi < dlSessions.length; dlsi++) {
            if (dlSessions[dlsi].id === sessionHash) {
              selectProject(projects[dlpi])
              selectSession(dlSessions[dlsi])
              break
            }
          }
          if (selectedSession) break
        }
      }
    }
  } catch (error) {
    elements.footerStatus.textContent = STRINGS.statusBarLoadError
    elements.footerStatus.className = 'ftr-status err'
    console.error('[reup] failed to refresh project data:', error)
    hideLoadingOverlay()
  }
}

/**
 * Opens a Server-Sent Events connection to /events for live project updates.
 * Reconnects automatically after SSE_RECONNECT_DELAY_MS when the stream drops.
 * Each "change" event triggers a full project + usage refresh.
 */
function connectLiveUpdates() {
  if (liveUpdatesSource) liveUpdatesSource.close()

  function scheduleLiveDataRefresh() {
    markSessionPreviewsStale()
    if (liveUpdatesRefreshTimer) clearTimeout(liveUpdatesRefreshTimer)
    liveUpdatesRefreshTimer = setTimeout(function () {
      liveUpdatesRefreshTimer = null
      // The activity fetch gates on activeSessionIds, which only
      // refreshProjectData updates — it must complete first or a session that
      // just became active is skipped until the next poll.
      void refreshProjectData().then(function () {
        return refreshLiveActivity()
      })
      void refreshUsageSummary()
    }, SSE_REFRESH_DEBOUNCE_MS)
  }

  liveUpdatesSource = new EventSource('/events')
  liveUpdatesSource.addEventListener('change', function () {
    scheduleLiveDataRefresh()
  })
  // Server-computed activity snapshots: liveness flips render without any
  // refetch, and the active badges follow the pushed session-id set.
  liveUpdatesSource.addEventListener('activity', function (event) {
    var snapshot
    try {
      snapshot = JSON.parse(event.data)
    } catch {
      return
    }
    if (!snapshot || !Array.isArray(snapshot.entries)) return
    if (Array.isArray(snapshot.activeSessionIds)) {
      activeSessionIds = new Set(snapshot.activeSessionIds)
      renderProjects()
      renderSessions()
    }
    applyLiveActivity(snapshot.entries)
  })
  liveUpdatesSource.addEventListener('usage', function () {
    void refreshUsageSummary()
  })
  liveUpdatesSource.addEventListener('error', function () {
    if (liveUpdatesSource) liveUpdatesSource.close()
    liveUpdatesSource = null
    setTimeout(connectLiveUpdates, SSE_RECONNECT_DELAY_MS)
  })
}

/** Applies a live-activity entry list and re-renders every consumer of it. */
function applyLiveActivity(entries) {
  raiseDesktopAlerts(entries)
  liveActivity = entries
  renderRail()
  if (selectedSession) renderInspector(deriveVisibleSessions())
}

// ---------------------------------------------------------------------------
// Desktop alerts: "needs input" and "turn finished"
// ---------------------------------------------------------------------------

function desktopAlertsPreferred() {
  try {
    return localStorage.getItem(NOTIFY_PREFERENCE) === '1'
  } catch {
    return false
  }
}

function desktopAlertsEnabled() {
  return desktopAlertsPreferred() && Notification.permission === 'granted'
}

/**
 * Compares the incoming snapshot with the previous one and raises at most one
 * notification per event: a session newly waiting on the user (always), or a
 * running session that finished its turn (only while the tab is hidden —
 * a visible dashboard already shows it).
 */
function raiseDesktopAlerts(entries) {
  var enabled = desktopAlertsEnabled()
  var nextStates = new Map()
  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i]
    if (!entry.sessionId) continue
    nextStates.set(entry.sessionId, entry.activityState || 'idle')
    var name = entry.sessionName || entry.sessionId

    if (entry.attention) {
      var attentionKey = entry.sessionId + ':' + (entry.attention.since || '')
      if (!notifiedAttentionKeys.has(attentionKey)) {
        notifiedAttentionKeys.add(attentionKey)
        if (enabled) {
          raiseNotification(
            fmt(STRINGS.notifyNeedsInputTitle, { name: name }),
            entry.attention.message || '',
            entry
          )
        }
      }
      continue
    }

    var previousState = previousActivityStates.get(entry.sessionId)
    var finishedTurn =
      previousState === 'running' &&
      (entry.activityState === 'waiting' || entry.activityState === 'idle')
    if (finishedTurn && enabled && document.hidden) {
      raiseNotification(fmt(STRINGS.notifyTurnCompleteTitle, { name: name }), '', entry)
    }
  }
  previousActivityStates = nextStates
}

function raiseNotification(title, body, entry) {
  try {
    var notification = new Notification(title, {
      body: body,
      tag: 'reup:' + entry.sessionId,
    })
    notification.onclick = function () {
      window.focus()
      var project = projects.find(function (candidate) {
        return candidate.id === entry.projectId
      })
      if (!project) return
      var session = project.sessions.find(function (candidate) {
        return candidate.id === entry.sessionId
      })
      selectProject(project)
      if (session) selectSession(session)
    }
  } catch {
    // Notifications are best-effort; never let them break data refresh.
  }
}

function renderNotifyButton() {
  if (!elements.notifyButton) return
  var on = desktopAlertsPreferred()
  elements.notifyButton.textContent = on ? '🔔 ' + STRINGS.footerNotifyBtn : STRINGS.footerNotifyBtn
  elements.notifyButton.classList.toggle('active', on)
}

async function toggleDesktopAlerts() {
  if (desktopAlertsPreferred()) {
    localStorage.removeItem(NOTIFY_PREFERENCE)
    renderNotifyButton()
    showToast(STRINGS.notifyDisabled)
    return
  }
  var permission = Notification.permission
  if (permission !== 'granted') permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    showToast(STRINGS.notifyDenied, 'err')
    return
  }
  localStorage.setItem(NOTIFY_PREFERENCE, '1')
  renderNotifyButton()
  showToast(STRINGS.notifyEnabled)
}

/**
 * Refreshes the live activity strip from /api/live-activity.
 * SSE `activity` pushes carry the same model in near real time; this poll is
 * the reconciliation fallback (missed pushes, waiting→idle age-outs).
 * No-op (and clears the strip) when no sessions are currently active.
 */
async function refreshLiveActivity() {
  if (activeSessionIds.size === 0) {
    if (liveActivity.length > 0) applyLiveActivity([])
    return
  }
  try {
    var data = await requestJson('/api/live-activity')
    if (!Array.isArray(data)) return
    applyLiveActivity(data)
  } catch {
    // non-fatal: the strip keeps its last known data until the next poll
  }
}

void refreshUsageSummary()
// Same ordering constraint as scheduleLiveDataRefresh: the activity fetch
// gates on activeSessionIds, which only refreshProjectData populates.
void refreshProjectData().then(function () {
  return refreshLiveActivity()
})
setInterval(function () {
  void refreshUsageSummary()
}, USAGE_POLL_INTERVAL_MS)
setInterval(function () {
  void refreshLiveActivity()
}, LIVE_ACTIVITY_POLL_MS)
// Keeps the strip's relative ages ("3s", "now") honest between data updates.
setInterval(function () {
  if (liveActivity.length > 0) renderRail()
}, LIVE_STRIP_TICK_MS)
connectLiveUpdates()

// Narrow-mode back button: return to the project panel without clearing selection.
var backBtn = document.getElementById('back-btn')
if (backBtn) {
  backBtn.addEventListener('click', function () {
    document.body.classList.remove('narrow-sessions')
  })
}

// Clear narrow-sessions when the viewport widens past the single-panel breakpoint.
window.matchMedia('(max-width: 639px)').addEventListener('change', function (e) {
  if (!e.matches) document.body.classList.remove('narrow-sessions')
  renderSessions()
})

// Theme toggle button in footer.
var themeBtn = document.getElementById('ftr-theme-btn')
if (themeBtn) themeBtn.addEventListener('click', cycleTheme)

// Desktop-alerts toggle button in footer.
if (elements.notifyButton) {
  elements.notifyButton.addEventListener('click', function () {
    void toggleDesktopAlerts()
  })
  renderNotifyButton()
}
