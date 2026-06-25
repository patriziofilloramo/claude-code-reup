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
    console.error('[swoop] failed to refresh usage:', error)
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
    console.error('[swoop] failed to refresh project data:', error)
  }
}

/**
 * Opens a Server-Sent Events connection to /events for live project updates.
 * Reconnects automatically after SSE_RECONNECT_DELAY_MS when the stream drops.
 * Each "change" event triggers a full project + usage refresh.
 */
function connectLiveUpdates() {
  if (liveUpdatesSource) liveUpdatesSource.close()

  liveUpdatesSource = new EventSource('/events')
  liveUpdatesSource.addEventListener('change', function () {
    markSessionPreviewsStale()
    void refreshProjectData()
    void refreshUsageSummary()
  })
  liveUpdatesSource.addEventListener('error', function () {
    if (liveUpdatesSource) liveUpdatesSource.close()
    liveUpdatesSource = null
    setTimeout(connectLiveUpdates, SSE_RECONNECT_DELAY_MS)
  })
}

/**
 * Refreshes the live activity strip from /api/live-activity.
 * No-op (and clears the strip) when no sessions are currently active.
 */
async function refreshLiveActivity() {
  if (activeSessionIds.size === 0) {
    if (liveActivity.length > 0) {
      liveActivity = []
      renderRail()
    }
    return
  }
  try {
    var data = await requestJson('/api/live-activity')
    if (!Array.isArray(data)) return
    liveActivity = data
    renderRail()
  } catch {
    // non-fatal: the strip keeps its last known data until the next poll
  }
}

void refreshUsageSummary()
void refreshProjectData()
void refreshLiveActivity()
setInterval(function () {
  void refreshUsageSummary()
}, USAGE_POLL_INTERVAL_MS)
setInterval(function () {
  void refreshLiveActivity()
}, LIVE_ACTIVITY_POLL_MS)
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
