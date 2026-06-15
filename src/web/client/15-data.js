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
      console.error('[ccm] failed to refresh usage:', error)
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
      const [loadedProjects, activeData, diagnosticsData] = await Promise.all([
        requestJson('/api/projects'),
        requestJson('/api/active'),
        requestJson('/api/diagnostics').catch(function () {
          return null
        }),
      ])
      projects = loadedProjects
      activeSessionIds = new Set(activeData.sessionIds || [])

      if (diagnosticsData) {
        const issueCount =
          (diagnosticsData.expiring ? diagnosticsData.expiring.length : 0) +
          (diagnosticsData.pathMissing ? diagnosticsData.pathMissing.length : 0) +
          (diagnosticsData.orphanedTranscripts ? diagnosticsData.orphanedTranscripts.length : 0) +
          (diagnosticsData.brokenIndices ? diagnosticsData.brokenIndices.length : 0) +
          (diagnosticsData.staleLocks ? diagnosticsData.staleLocks.length : 0)
        if (issueCount > 0) {
          elements.diagnosticsButton.textContent =
            '⚠ ' + issueCount + ' issue' + (issueCount === 1 ? '' : 's')
          elements.diagnosticsButton.style.display = ''
        } else {
          elements.diagnosticsButton.style.display = 'none'
        }
      }

      elements.footerStatus.textContent = projects.length + ' projects'
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

      synchronizeSelectedProjectWithView()
      renderProjects()
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
      elements.footerStatus.textContent = 'Error loading projects'
      elements.footerStatus.className = 'ftr-status err'
      console.error('[ccm] failed to refresh project data:', error)
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
      void refreshProjectData()
      void refreshUsageSummary()
    })
    liveUpdatesSource.addEventListener('error', function () {
      if (liveUpdatesSource) liveUpdatesSource.close()
      liveUpdatesSource = null
      setTimeout(connectLiveUpdates, SSE_RECONNECT_DELAY_MS)
    })
  }

  void refreshUsageSummary()
  void refreshProjectData()
  setInterval(function () {
    void refreshUsageSummary()
  }, USAGE_POLL_INTERVAL_MS)
  connectLiveUpdates()
