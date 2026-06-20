// ---------------------------------------------------------------------------
// Project list
// ---------------------------------------------------------------------------

/**
 * Resolves the Project object from a clicked .proj-row DOM element.
 * Uses data-project-id to look up the in-memory project list rather than
 * trusting any other DOM state, so event delegation stays safe.
 */
function resolveProjectFromRow(row) {
  if (!row) return null
  const projectId = row.dataset.projectId
  return (
    projects.find(function (project) {
      return project.id === projectId
    }) || null
  )
}

/** Renders a single project row as an HTML string for innerHTML assignment. */
function buildProjectRowHtml(project) {
  const isSelected = selectedProject && project.id === selectedProject.id
  const sessionCount = searchQuery.trim()
    ? deriveVisibleSessionsForProject(project).length
    : project.sessions.length
  const lastActive = project.sessions.reduce(function (max, s) {
    return s.updated > max ? s.updated : max
  }, '')
  const lastLabel = lastActive ? compactRelativeTime(lastActive) : ''
  return (
    '<div class="proj-row' +
    (isSelected ? ' sel' : '') +
    '" data-project-id="' +
    escapeHtml(project.id) +
    '" title="' +
    escapeHtml(project.path) +
    (lastActive ? '\n' + fmt(STRINGS.projectLastActive, { time: relativeTime(lastActive) }) : '') +
    '">' +
    '<span class="p-name">' +
    escapeHtml(compactPath(project.path)) +
    '</span>' +
    (project.syncStatus && project.syncStatus !== 'none'
      ? project.syncStatus === 'grey'
        ? '<span class="p-cloud p-cloud--stale" title="' +
          escapeHtml(STRINGS.projectCloudOffline) +
          '">☁</span>'
        : project.syncStatus === 'orange'
          ? '<span class="p-cloud p-cloud--unlinked" title="' +
            escapeHtml(
              fmt(STRINGS.projectCloudUnlinked, { devices: project.unlinkedDevices.join(', ') })
            ) +
            '">☁</span>'
          : '<span class="p-cloud p-cloud--ok" title="' +
            escapeHtml(STRINGS.projectCloudOk) +
            '">☁</span>'
      : '') +
    '<span class="p-last">' +
    lastLabel +
    '</span>' +
    '<span class="p-cnt">' +
    sessionCount +
    '</span>' +
    '<div class="p-actions">' +
    '<button class="p-act-btn p-menu-btn" title="' +
    escapeHtml(STRINGS.projectMoreActions) +
    '">⋯</button>' +
    '</div>' +
    '</div>'
  )
}

/** Looks up the deep-search match record for a given session ID, or null if not found. */
function getDeepMatchForSession(sessionId) {
  for (var i = 0; i < deepSearchMatches.length; i++) {
    if (deepSearchMatches[i].sessionId === sessionId) return deepSearchMatches[i]
  }
  return null
}

/** Returns an HTML snippet row showing the match count and text excerpt. Empty string when match is null. */
function buildDeepSnippetHtml(match) {
  if (!match) return ''
  const hitLabel =
    match.matchCount === 1
      ? fmt(STRINGS.sessionDeepHit, { n: match.matchCount })
      : fmt(STRINGS.sessionDeepHits, { n: match.matchCount })
  return (
    '<div class="s-deep-snippet">' +
    '<span class="s-deep-count">' +
    hitLabel +
    '</span>' +
    '<span class="s-deep-text">' +
    escapeHtml(match.snippet) +
    '</span>' +
    '</div>'
  )
}

/**
 * Returns the subset of projects that should appear in the left panel given
 * the current search query, active filters, and deep-search state.
 * In deep-search mode only projects that contain at least one transcript match are shown.
 */
function deriveVisibleProjects() {
  if (deepSearchActive) {
    if (deepSearchLoading) return []
    const matchedProjectIds = new Set(
      deepSearchMatches.map(function (m) {
        return m.projectId
      })
    )
    return projects.filter(function (p) {
      return matchedProjectIds.has(p.id)
    })
  }

  // Apply focus filter (defined in 17-rail.js; hoisted function declaration).
  var baseProjects = projects
  if (focusFilter) {
    baseProjects = projects.filter(function (project) {
      var focusSessions = getSessionsMatchingFocus(project)
      if (focusSessions === undefined) return false
      if (focusSessions === null) return true
      return focusSessions.length > 0
    })
  }

  const searchSpec = parseSearchQuery(searchQuery)
  const visibleProjects = searchSpecHasFilters(searchSpec)
    ? baseProjects.filter(function (project) {
        const projectTextMatches = projectMatchesSearch(project, searchSpec)
        if (projectTextMatches && searchSpec.reviewBucketIds.length === 0) return true
        return deriveVisibleSessionsForProject(project).length > 0
      })
    : baseProjects
  if (selectedProjectSort !== 'name') return visibleProjects

  return visibleProjects.slice().sort(function (left, right) {
    const pathComparison = compactPath(left.path).localeCompare(compactPath(right.path))
    return pathComparison || left.path.localeCompare(right.path)
  })
}

/** Re-renders the full project list panel from current state. */
function renderProjects() {
  const visibleProjects = deriveVisibleProjects()
  elements.projectCountLabel.textContent = fmt(STRINGS.projectsLabel, { n: visibleProjects.length })
  elements.projectList.innerHTML = visibleProjects.map(buildProjectRowHtml).join('')
}

/** Selects a project, clears the session selection, and re-renders both panels. */
function selectProject(project) {
  selectedProject = project
  selectedSession = null
  if (!searchQuery.trim()) selectedFilter = 'all'
  renderProjects()
  renderSessions()
  void refreshClaudeInstructionsAvailability(project)
  if (window.matchMedia('(max-width: 639px)').matches) {
    document.body.classList.add('narrow-sessions')
  }
}

elements.projectList.addEventListener('click', function (event) {
  const menuBtn = event.target.closest('.p-menu-btn')
  if (menuBtn) {
    event.stopPropagation()
    const project = resolveProjectFromRow(menuBtn.closest('.proj-row'))
    if (!project) return
    ctxProject = project
    ctxSession = null
    openContextMenu(menuBtn, [
      { action: 'project-new-session', label: STRINGS.projectCtxNewSession },
      { action: 'project-copy-path', label: STRINGS.projectCtxCopyPath },
    ])
    return
  }

  const project = resolveProjectFromRow(event.target.closest('.proj-row'))
  if (project) selectProject(project)
})

elements.projectSortSelect.addEventListener('change', function () {
  selectedProjectSort = elements.projectSortSelect.value
  renderProjects()
})
