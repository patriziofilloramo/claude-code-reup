  // ---------------------------------------------------------------------------
  // Session list rendering and metadata actions
  // ---------------------------------------------------------------------------

  /** Renders a single session row (two lines + optional deep-search snippet) as an HTML string. */
  function buildSessionRowHtml(session) {
    const isSelected = selectedSession && session.id === selectedSession.id
    const branch = session.gitBranch || null
    const displayName = session.alias || session.name

    return (
      '<div class="sess-row' +
      (isSelected ? ' sel' : '') +
      (session.signals.archived ? ' archived' : '') +
      '" data-session-id="' +
      escapeHtml(session.id) +
      '">' +
      '<div class="s-line1">' +
      '<span class="s-arrow">' +
      (isSelected ? '▶' : ' ') +
      '</span>' +
      (activeSessionIds.has(session.id) ? '<span class="s-live">●</span>' : '') +
      (renamingSessionId === session.id
        ? '<input class="s-rename-input" value="' + escapeHtml(displayName) + '" maxlength="160">'
        : '<span class="s-name">' + escapeHtml(displayName) + '</span>') +
      '<span class="s-time">' +
      relativeTime(session.updated) +
      '</span>' +
      '<button class="s-menu-btn" title="More actions">⋯</button>' +
      '</div>' +
      '<div class="s-line2">' +
      (branch
        ? '<span class="pip" style="background:' +
          colorForGitBranch(branch) +
          '"></span><span class="branch-n">⎷ ' +
          escapeHtml(branch) +
          '</span>' +
          buildBranchDriftHtml(session) +
          '<span style="color:var(--dim)">·</span>'
        : '') +
      '<span class="s-msgs">' +
      session.messageCount +
      ' msgs</span>' +
      (session.context.latestModel
        ? '<span class="s-model">' + escapeHtml(session.context.latestModel) + '</span>'
        : '') +
      (session.context.latestContextTokens != null
        ? '<span class="s-context">' +
          formatTokenCount(session.context.latestContextTokens) +
          ' ctx</span>'
        : '') +
      buildStatusBadgeHtml(session) +
      '</div>' +
      (deepSearchActive ? buildDeepSnippetHtml(getDeepMatchForSession(session.id)) : '') +
      '</div>'
    )
  }

  /** Returns an empty-state HTML message when there are no sessions to show, or "" when there are. */
  function buildEmptySessionListHtml(visibleSessions) {
    if (!selectedProject) {
      return searchQuery
        ? '<div class="empty">No projects or sessions match.</div>'
        : '<div class="empty">Select a project from the left panel.</div>'
    }
    if (visibleSessions.length > 0) return ''

    const archivedCount = sessionsMatchingFilter(selectedProject, 'archived').length
    const message = searchQuery
      ? 'No sessions match.'
      : selectedFilter === 'all'
        ? 'No sessions.'
        : 'No sessions in this filter.'
    const archiveHint =
      selectedFilter === 'all' && archivedCount > 0
        ? ' <span class="empty-hint">' + archivedCount + ' archived.</span>'
        : ''
    return '<div class="empty">' + message + archiveHint + '</div>'
  }

  /** Re-renders the session list, panel header, filter bar, and inspector from current state. */
  function renderSessions() {
    const visibleSessions = deriveVisibleSessions()
    synchronizeSelectedSession()

    if (deepSearchActive) {
      elements.sessionPanelTitle.textContent = deepSearchLoading
        ? 'searching transcripts…'
        : '⌕ ' + deepSearchQueryTerm
      elements.sessionCount.textContent = deepSearchLoading
        ? ''
        : deepSearchMatches.length + ' sessions found'
    } else {
      elements.sessionPanelTitle.textContent = selectedProject
        ? compactPath(selectedProject.path)
        : 'Select a project'
      elements.sessionCount.textContent = selectedProject ? visibleSessions.length + ' sessions' : ''
    }
    renderFilterBar()
    renderInspector(visibleSessions)

    const emptyHtml = buildEmptySessionListHtml(visibleSessions)
    elements.sessionList.innerHTML = emptyHtml || visibleSessions.map(buildSessionRowHtml).join('')

    if (renamingSessionId) {
      const input = elements.sessionList.querySelector('.s-rename-input')
      if (input) {
        input.focus()
        input.select()
      }
    }
  }

  /** Persists a session alias to the server, then refreshes and shows a toast. Clears alias when empty. */
  async function saveSessionAlias(session, aliasInput) {
    renamingSessionId = null
    const alias = aliasInput.trim().slice(0, 160)

    try {
      await requestJson('/api/sessions/' + selectedProject.id + '/' + session.id + '/alias', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alias: alias || null }),
      })
      await refreshProjectData()
      showToast(alias ? 'Renamed to "' + alias + '"' : 'Alias cleared')
    } catch (error) {
      await refreshProjectData()
      showToast('Rename failed: ' + error.message, 'err')
    }
  }

  /** Toggles the local archive flag on a session and refreshes. Note: Claude may still delete the transcript. */
  async function toggleSessionArchivedState(session) {
    const shouldArchive = !session.signals.archived
    try {
      await requestJson('/api/sessions/' + selectedProject.id + '/' + session.id + '/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: shouldArchive }),
      })
      await refreshProjectData()
      if (shouldArchive) showToast('Archived locally. Claude may still delete the transcript.')
    } catch (error) {
      showToast('Archive failed: ' + error.message, 'err')
    }
  }

  // Event delegation keeps handlers valid when renderSessions replaces rows.
  elements.sessionList.addEventListener('click', function (event) {
    const menuBtn = event.target.closest('.s-menu-btn')
    if (menuBtn) {
      event.stopPropagation()
      const session = resolveSessionFromRow(menuBtn.closest('.sess-row'))
      if (!session) return
      ctxSession = session
      ctxProject = null
      openContextMenu(menuBtn, [
        { action: 'session-resume', label: 'resume' },
        { action: 'session-rename', label: 'rename' },
        { action: 'session-archive', label: session.signals.archived ? 'unarchive' : 'archive locally' },
        { action: 'session-copy-id', label: 'copy session ID' },
      ])
      return
    }

    const row = event.target.closest('.sess-row')
    if (!row || event.target.closest('.s-rename-input')) return

    // Clicking the row being renamed must leave its input node and typed value
    // untouched. Clicking elsewhere exits rename mode before normal selection.
    if (renamingSessionId) {
      if (row.dataset.sessionId === renamingSessionId) return
      renamingSessionId = null
      renderSessions()
      return
    }

    const session = resolveSessionFromRow(row)
    if (!session || (selectedSession && selectedSession.id === session.id)) return
    selectSession(session)
  })

  elements.sessionList.addEventListener('keydown', function (event) {
    if (!event.target.classList.contains('s-rename-input')) return
    const session = resolveSessionFromRow(event.target.closest('.sess-row'))
    if (!session) return

    if (event.key === 'Enter') {
      event.preventDefault()
      void saveSessionAlias(session, event.target.value)
    } else if (event.key === 'Escape') {
      renamingSessionId = null
      renderSessions()
    }
  })

  elements.sessionList.addEventListener(
    'blur',
    function (event) {
      if (!event.target.classList.contains('s-rename-input')) return
      // Blur fires before a related click. Let the click handler cancel or move
      // rename mode before committing the input value.
      setTimeout(function () {
        if (!renamingSessionId) return
        const session = resolveSessionFromRow(event.target.closest('.sess-row'))
        if (session) void saveSessionAlias(session, event.target.value)
      }, 150)
    },
    true
  )

  elements.sessionList.addEventListener('dblclick', function (event) {
    if (event.target.closest('.s-rename-input')) return
    const session = resolveSessionFromRow(event.target.closest('.sess-row'))
    if (!session) return

    if (shouldConfirmResume()) openResumeDialog(session)
    else {
      selectSession(session)
      void resumeSelectedSession()
    }
  })

