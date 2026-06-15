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
      (lastActive ? '\nlast active: ' + relativeTime(lastActive) : '') +
      '">' +
      '<span class="p-name">' +
      escapeHtml(compactPath(project.path)) +
      '</span>' +
      (project.isShared
        ? project.cloudOffline
          ? '<span class="p-cloud p-cloud--stale" title="Cloud offline — sessions saved locally, new sessions paused until sync resumes">☁</span>'
          : (project.unlinkedDevices && project.unlinkedDevices.length > 0)
            ? '<span class="p-cloud p-cloud--unlinked" title="Device(s) not linked: ' + escapeHtml(project.unlinkedDevices.join(', ')) + ' — run ccm link on those devices">☁</span>'
            : '<span class="p-cloud p-cloud--ok" title="Shared storage — writes directly to cloud">☁</span>'
        : '') +
      (lastLabel ? '<span class="p-last">' + lastLabel + '</span>' : '') +
      '<span class="p-cnt">' +
      sessionCount +
      '</span>' +
      '<div class="p-actions">' +
      '<button class="p-act-btn p-new-btn" title="New session">+</button>' +
      '<button class="p-act-btn p-menu-btn" title="More actions">⋯</button>' +
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
    return (
      '<div class="s-deep-snippet">' +
      '<span class="s-deep-count">' +
      match.matchCount +
      (match.matchCount === 1 ? ' hit' : ' hits') +
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
      const matchedProjectIds = new Set(deepSearchMatches.map(function (m) { return m.projectId }))
      return projects.filter(function (p) { return matchedProjectIds.has(p.id) })
    }
    const normalizedQuery = searchQuery.trim().toLowerCase()
    const visibleProjects = normalizedQuery
      ? projects.filter(function (project) {
          return (
            projectMatchesSearch(project, normalizedQuery) ||
            deriveVisibleSessionsForProject(project).length > 0
          )
        })
      : projects
    if (selectedProjectSort !== 'name') return visibleProjects

    return visibleProjects.slice().sort(function (left, right) {
      const pathComparison = compactPath(left.path).localeCompare(compactPath(right.path))
      return pathComparison || left.path.localeCompare(right.path)
    })
  }

  /** Re-renders the full project list panel from current state. */
  function renderProjects() {
    const visibleProjects = deriveVisibleProjects()
    elements.projectCountLabel.textContent = 'PROJECTS [' + visibleProjects.length + ']'
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
    const newBtn = event.target.closest('.p-new-btn')
    if (newBtn) {
      event.stopPropagation()
      const project = resolveProjectFromRow(newBtn.closest('.proj-row'))
      if (project) void startNewSession(project)
      return
    }

    const menuBtn = event.target.closest('.p-menu-btn')
    if (menuBtn) {
      event.stopPropagation()
      const project = resolveProjectFromRow(menuBtn.closest('.proj-row'))
      if (!project) return
      ctxProject = project
      ctxSession = null
      openContextMenu(menuBtn, [
        { action: 'project-new-session', label: '+ new session' },
        { action: 'project-copy-path', label: 'copy path' },
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

