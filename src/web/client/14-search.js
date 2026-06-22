// ---------------------------------------------------------------------------
// Search and global keyboard shortcuts
// ---------------------------------------------------------------------------

/** Shows the search bar, hides the header hints, and focuses the input. */
function openSearch() {
  elements.headerHints.style.display = 'none'
  elements.searchWrapper.style.display = 'flex'
  elements.searchInput.value = ''
  searchQuery = ''
  renderFocusBar()
  elements.searchInput.focus()
}

/**
 * Switches the search bar into deep-search mode and queries /api/search/deep.
 * While loading, the project and session lists show empty state. Results appear
 * as transcript-matched sessions with hit counts and text snippets.
 * Exit with exitInlineDeepSearch() or Escape.
 */
async function runInlineDeepSearch(query) {
  deepSearchActive = true
  deepSearchLoading = true
  deepSearchQueryTerm = query
  deepSearchMatches = []
  elements.searchDeepBtn.classList.add('active')
  elements.searchWrapper.classList.add('deep-mode')
  elements.searchModeLabel.style.display = 'flex'
  synchronizeSelectedProjectWithView()
  renderProjects()
  renderFocusBar()
  renderSessions()
  try {
    const data = await requestJson('/api/search/deep?q=' + encodeURIComponent(query))
    deepSearchMatches = data.matches || []
  } catch (error) {
    showToast('Deep search failed: ' + error.message, 'err')
    deepSearchMatches = []
  } finally {
    deepSearchLoading = false
    synchronizeSelectedProjectWithView()
    renderProjects()
    renderFocusBar()
    renderSessions()
  }
}

/** Clears deep-search state and restores normal project/session listing. */
function exitInlineDeepSearch() {
  deepSearchActive = false
  deepSearchMatches = []
  deepSearchLoading = false
  deepSearchQueryTerm = ''
  elements.searchDeepBtn.classList.remove('active')
  elements.searchWrapper.classList.remove('deep-mode')
  elements.searchModeLabel.style.display = 'none'
  synchronizeSelectedProjectWithView()
  renderProjects()
  renderSessions()
}

/** Hides the search bar, restores header hints, clears query, and exits deep-search if active. */
function closeSearch() {
  elements.searchWrapper.style.display = 'none'
  elements.headerHints.style.display = 'flex'
  searchQuery = ''
  exitInlineDeepSearch()
  renderFocusBar()
}

elements.searchInput.addEventListener('input', function () {
  searchQuery = elements.searchInput.value
  if (deepSearchActive) exitInlineDeepSearch()
  else {
    synchronizeSelectedProjectWithView()
    renderProjects()
    renderFocusBar()
    renderSessions()
  }
})

elements.searchInput.addEventListener('keydown', function (event) {
  if (event.key === 'Tab') {
    event.preventDefault()
    if (searchQuery.trim().length >= 2) void runInlineDeepSearch(searchQuery.trim())
    return
  }
  if (event.key === 'Escape') {
    if (deepSearchActive) exitInlineDeepSearch()
    else {
      if (focusFilter) clearFocusFilter()
      closeSearch()
    }
  }
})

elements.searchDeepBtn.addEventListener('click', function () {
  if (searchQuery.trim().length >= 2) void runInlineDeepSearch(searchQuery.trim())
})
elements.searchClearButton.addEventListener('click', closeSearch)

document.addEventListener('keydown', function (event) {
  if (event.key === 'Escape' && elements.contextMenu.classList.contains('open')) {
    closeContextMenu()
    return
  }

  if (elements.resumeOverlay.classList.contains('open')) {
    if (event.key === 'Escape') closeResumeDialog()
    if (event.key === 'Enter') void resumeSelectedSession()
    return
  }
  if (elements.instructionsDrawer.classList.contains('open')) {
    if (event.key === 'Escape') closeClaudeInstructionsDrawer()
    return
  }
  if (elements.diagnosticsDrawer.classList.contains('open')) {
    if (event.key === 'Escape') closeDiagnosticsDrawer()
    return
  }
  if (elements.searchWrapper.style.display !== 'none') {
    if (event.key === 'Escape') closeSearch()
    return
  }
  if (elements.tagPickerOverlay.classList.contains('open')) {
    // Tag picker handles its own keydown — nothing to do here
    return
  }
  if (elements.orgPickerOverlay.classList.contains('open')) {
    // Org picker handles its own Escape — nothing to do here
    return
  }
  if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') return

  if (event.key === '/' && !event.ctrlKey && !event.metaKey) {
    event.preventDefault()
    openSearch()
  }
  if (event.key === 'Enter' && selectedSession && selectedProject) {
    if (shouldConfirmResume()) openResumeDialog(selectedSession)
    else void resumeSelectedSession()
  }

  if (selectedProject) {
    if (event.key === 'g') {
      event.preventDefault()
      if (selectedSession) openStackPicker(selectedProject, selectedSession)
      else openGroupPicker(selectedProject)
      return
    }
    if (event.key === 't' && !selectedSession) {
      event.preventDefault()
      openProjectTagPicker(selectedProject)
      return
    }
  }
  if (selectedSession && selectedProject) {
    if (event.key === 't') {
      event.preventDefault()
      openTagPicker(selectedSession, selectedProject)
      return
    }
    if (event.key === 'r') {
      event.preventDefault()
      executeSessionAction('session-rename', selectedSession)
      return
    }
    if (event.key === 'H') {
      event.preventDefault()
      executeSessionAction('session-handoff', selectedSession)
      return
    }
    if (event.key === 'c') {
      event.preventDefault()
      executeSessionAction('session-copy-id', selectedSession)
      return
    }
    if (event.key === 'D') {
      event.preventDefault()
      executeSessionAction('session-delete', selectedSession)
      return
    }
  }

  // j / k - navigate sessions up/down
  if (event.key === 'j' || (event.key === 'ArrowDown' && !event.altKey)) {
    event.preventDefault()
    const visibleSessions = deriveVisibleSessions()
    if (visibleSessions.length === 0) return
    const currentIndex = selectedSession
      ? visibleSessions.findIndex(function (s) {
          return s.id === selectedSession.id
        })
      : -1
    const next = visibleSessions[Math.min(visibleSessions.length - 1, currentIndex + 1)]
    if (next) selectSession(next)
    return
  }
  if (event.key === 'k' || (event.key === 'ArrowUp' && !event.altKey)) {
    event.preventDefault()
    const visibleSessions = deriveVisibleSessions()
    if (visibleSessions.length === 0) return
    const currentIndex = selectedSession
      ? visibleSessions.findIndex(function (s) {
          return s.id === selectedSession.id
        })
      : 1
    const prev = visibleSessions[Math.max(0, currentIndex - 1)]
    if (prev) selectSession(prev)
    return
  }

  // [ / ] or h / l - navigate projects
  if (event.key === '[' || event.key === 'h') {
    const visibleProjects = deriveVisibleProjects()
    const currentIndex = selectedProject
      ? visibleProjects.findIndex(function (p) {
          return p.id === selectedProject.id
        })
      : 0
    const prev = visibleProjects[Math.max(0, currentIndex - 1)]
    if (prev && prev.id !== (selectedProject && selectedProject.id)) selectProject(prev)
    return
  }
  if (event.key === ']' || event.key === 'l') {
    const visibleProjects = deriveVisibleProjects()
    const currentIndex = selectedProject
      ? visibleProjects.findIndex(function (p) {
          return p.id === selectedProject.id
        })
      : -1
    const next = visibleProjects[Math.min(visibleProjects.length - 1, currentIndex + 1)]
    if (next && next.id !== (selectedProject && selectedProject.id)) selectProject(next)
    return
  }

  // a - archive / unarchive selected session
  if (event.key === 'a' && selectedSession && selectedProject) {
    void toggleSessionArchivedState(selectedSession)
    return
  }
})
