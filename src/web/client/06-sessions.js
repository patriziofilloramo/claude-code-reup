// ---------------------------------------------------------------------------
// Session view model and selection
// ---------------------------------------------------------------------------

/** Returns the sessions in a project that satisfy the given filter tab. */
function sessionsMatchingFilter(project, filter) {
  if (!project) return []
  const sessions = project.sessions

  if (filter === 'attention') {
    return sessions.filter(function (session) {
      const status = session.primaryStatus
      return (
        !session.signals.archived &&
        (status === 'interrupted' || status === 'expiring' || status === 'path-missing')
      )
    })
  }
  if (filter === 'active') {
    return sessions.filter(function (session) {
      return !session.signals.archived && activeSessionIds.has(session.id)
    })
  }
  if (filter === 'archived') {
    return sessions.filter(function (session) {
      return session.signals.archived
    })
  }
  // The default "all" view intentionally excludes locally archived sessions.
  return sessions.filter(function (session) {
    return !session.signals.archived
  })
}

/** Returns true if any string in values contains the already-lowercased query. */
function valuesMatchSearch(values, normalizedQuery) {
  return values.some(function (value) {
    return (value || '').toLowerCase().includes(normalizedQuery)
  })
}

/** Returns true if the project's ID or path matches the search query. */
function projectMatchesSearch(project, normalizedQuery) {
  return valuesMatchSearch([project.id, project.path], normalizedQuery)
}

/** Returns true if any searchable field of the session matches the query. */
function sessionMatchesSearch(session, normalizedQuery) {
  return valuesMatchSearch(
    [
      session.id,
      session.name,
      session.alias,
      session.projectPath,
      session.gitBranch,
      session.currentBranch,
    ].concat(session.context.models || []),
    normalizedQuery
  )
}

/**
 * Returns sessions to display for a project given current filter, search, and deep-search state.
 * In deep-search mode returns only transcript-matched sessions for this project.
 */
function deriveVisibleSessionsForProject(project) {
  if (deepSearchActive) {
    const matchedIds = new Set(
      deepSearchMatches
        .filter(function (m) {
          return m.projectId === project.id
        })
        .map(function (m) {
          return m.sessionId
        })
    )
    return project.sessions.filter(function (s) {
      return matchedIds.has(s.id)
    })
  }

  // Apply focus filter (getSessionsMatchingFocus defined in 17-rail.js; hoisted).
  var focusSessions = getSessionsMatchingFocus(project)
  var sessions

  if (focusSessions === undefined || focusSessions === null) {
    // Project is in focus with no session-level restriction — apply pill filter normally.
    sessions = sessionsMatchingFilter(project, selectedFilter)
  } else if (focusFilter && focusFilter.kind === 'inbox') {
    // Review bucket focus overrides the pill filter — show bucket sessions directly.
    sessions = focusSessions
  } else {
    // Tag / specific-session stack focus — intersect with pill filter.
    var pilledIds = new Set(
      sessionsMatchingFilter(project, selectedFilter).map(function (s) {
        return s.id
      })
    )
    sessions = focusSessions.filter(function (s) {
      return pilledIds.has(s.id)
    })
  }

  const normalizedQuery = searchQuery.trim().toLowerCase()
  if (!normalizedQuery || projectMatchesSearch(project, normalizedQuery)) return sessions

  return sessions.filter(function (session) {
    return sessionMatchesSearch(session, normalizedQuery)
  })
}

/** Returns the visible sessions for the selected project, sorted per the current sort selection. */
function deriveVisibleSessions() {
  const sessions = selectedProject ? deriveVisibleSessionsForProject(selectedProject) : []
  if (selectedSort === 'context') {
    return sessions.slice().sort(function (left, right) {
      const leftTokens = left.context.latestContextTokens ?? -1
      const rightTokens = right.context.latestContextTokens ?? -1
      return rightTokens - leftTokens || right.updated.localeCompare(left.updated)
    })
  }
  if (selectedSort !== 'risk') return sessions

  return sessions.slice().sort(function (left, right) {
    const leftRank = RISK_RANK[left.primaryStatus] != null ? RISK_RANK[left.primaryStatus] : 4
    const rightRank = RISK_RANK[right.primaryStatus] != null ? RISK_RANK[right.primaryStatus] : 4
    if (leftRank !== rightRank) return leftRank - rightRank
    return right.updated.localeCompare(left.updated)
  })
}

/**
 * Ensures selectedProject is still visible after a filter/search/data change.
 * Falls back to the first visible project when the current selection is hidden.
 * This prevents a stale project from staying "active" while showing zero sessions.
 */
function synchronizeSelectedProjectWithView() {
  const visibleProjects = deriveVisibleProjects()
  if (
    selectedProject &&
    visibleProjects.some(function (project) {
      return project.id === selectedProject.id
    })
  ) {
    return
  }

  selectedProject = visibleProjects[0] || null
  selectedSession = null
  renamingSessionId = null
  if (selectedProject) void refreshClaudeInstructionsAvailability(selectedProject)
}

/** Resolves a Session from a clicked .sess-row DOM element using data-session-id lookup. */
function resolveSessionFromRow(row) {
  if (!row || !selectedProject) return null
  const sessionId = row.dataset.sessionId
  return (
    selectedProject.sessions.find(function (session) {
      return session.id === sessionId
    }) || null
  )
}

/**
 * Rebinds the selection to freshly fetched data without forgetting a session
 * merely because search or filters currently hide it.
 */
function synchronizeSelectedSession() {
  if (!selectedSession || !selectedProject) return
  const refreshedSession = selectedProject.sessions.find(function (session) {
    return session.id === selectedSession.id
  })
  selectedSession = refreshedSession || null
  if (!selectedSession) renamingSessionId = null
}

/**
 * Marks a session as selected, updates the URL hash so the session is deep-linkable,
 * and toggles the .sel class on the relevant row without rebuilding the list.
 * Keeping row nodes stable preserves any in-progress rename input.
 */
function refreshExpandedSessionListIfNeeded(visibleSessions) {
  if (!isSessionInspectorExpanded(visibleSessions)) return false
  elements.sessionList.innerHTML = buildSessionRowHtml(selectedSession)
  return true
}

function selectSession(session) {
  selectedSession = session
  // Update URL so this session can be bookmarked or shared
  if (window.history && window.history.replaceState) {
    history.replaceState(null, '', '#' + session.id)
  }

  // Selection must not rebuild the list. Keeping row nodes stable preserves
  // inline rename text and browser double-click detection.
  elements.sessionList.querySelectorAll('.sess-row').forEach(function (row) {
    row.classList.toggle('sel', row.dataset.sessionId === session.id)
    const arrow = row.querySelector('.s-arrow')
    if (arrow) arrow.textContent = row.dataset.sessionId === session.id ? '▶' : ' '
  })
  const visibleSessions = deriveVisibleSessions()
  if (refreshExpandedSessionListIfNeeded(visibleSessions)) {
    renderInspector(visibleSessions)
    return
  }
  renderInspector(visibleSessions)
}
