  // ---------------------------------------------------------------------------
  // Session filters and inspector
  // ---------------------------------------------------------------------------

  /** Returns session counts per filter tab for the selected project. */
  function calculateFilterCounts() {
    if (!selectedProject) return {}
    return {
      active: sessionsMatchingFilter(selectedProject, 'active').length,
      all: sessionsMatchingFilter(selectedProject, 'all').length,
      archived: sessionsMatchingFilter(selectedProject, 'archived').length,
      attention: sessionsMatchingFilter(selectedProject, 'attention').length,
    }
  }

  /** Updates filter pill active state and counts. Hides the bar entirely when no project is selected. */
  function renderFilterBar() {
    if (!selectedProject) {
      elements.filterBar.style.display = 'none'
      return
    }

    elements.filterBar.style.display = 'flex'
    const counts = calculateFilterCounts()
    elements.filterBar.querySelectorAll('.filter-pill').forEach(function (pill) {
      const filter = pill.dataset.filter
      const count = counts[filter] || 0
      pill.classList.toggle('active', filter === selectedFilter)
      pill.innerHTML =
        (FILTER_LABELS[filter] || filter) +
        (count > 0 ? '<span class="pill-cnt">' + count + '</span>' : '')
    })
  }

  /** Returns an HTML row string for the session inspector panel (label + value pair). */
  function buildInspectorRowHtml(label, value, valueClass, valueAttributes) {
    return (
      '<div class="insp-row"><span class="insp-key">' +
      label +
      '</span><span class="insp-val' +
      (valueClass ? ' ' + valueClass : '') +
      '"' +
      (valueAttributes ? ' ' + valueAttributes : '') +
      '>' +
      value +
      '</span></div>'
    )
  }

  /** Re-renders the session inspector panel for the selected session. Hides it when no selection is visible. */
  function renderInspector(visibleSessions) {
    const selectionIsVisible =
      selectedSession &&
      visibleSessions.some(function (session) {
        return session.id === selectedSession.id
      })
    if (!selectionIsVisible) {
      elements.sessionInspector.style.display = 'none'
      return
    }

    const session = selectedSession
    const signals = session.signals || {}
    const descriptions = {
      interrupted: 'Claude had pending tool calls with no result — resume to continue.',
      expiring:
        'Transcript expires in ' + signals.expiresInDays + ' days (Claude auto-deletes after 30).',
      'path-missing': 'Project directory no longer exists on disk.',
      'heavily-compacted': 'Context was compacted ' + signals.compactionCount + ' times.',
    }
    const statusDescription = descriptions[session.primaryStatus]
    const status = buildStatusBadgeHtml(session) || '<span style="color:var(--muted2)">ok</span>'
    const statusValue =
      status +
      (statusDescription
        ? '<span class="insp-note">' + escapeHtml(statusDescription) + '</span>'
        : '')

    let html = '<div class="insp-title">Session Details</div>'
    html += buildInspectorRowHtml('Status', statusValue)
    html += buildInspectorRowHtml(
      'Last active',
      '<em>' + escapeHtml(relativeTime(session.updated)) + '</em>'
    )
    html += buildInspectorRowHtml('Messages', session.messageCount)
    if (signals.analysisComplete && signals.compactionCount > 0) {
      html += buildInspectorRowHtml('Compactions', signals.compactionCount)
    }
    if (signals.expiresInDays != null) {
      html += buildInspectorRowHtml('Expires in', signals.expiresInDays + ' days')
    }
    if (session.context.latestModel) {
      html += buildInspectorRowHtml('Latest model', escapeHtml(session.context.latestModel))
    }
    if (session.context.latestContextTokens != null) {
      html += buildInspectorRowHtml(
        'Last context',
        formatTokenCount(session.context.latestContextTokens) + ' tokens'
      )
    }
    if (session.context.latestOutputTokens != null) {
      html += buildInspectorRowHtml(
        'Last output',
        formatTokenCount(session.context.latestOutputTokens) + ' tokens'
      )
    }
    if (session.context.models && session.context.models.length > 1) {
      html += buildInspectorRowHtml('Models used', escapeHtml(session.context.models.join(', ')))
    }
    html += buildInspectorRowHtml(
      'Session ID',
      session.id.slice(0, 8) + '…',
      'insp-copy',
      'title="Click to copy" data-copy="' + escapeHtml(session.id) + '"'
    )
    html += buildInspectorRowHtml(
      'Path',
      escapeHtml(session.projectPath),
      'insp-path',
      'title="' + escapeHtml(session.projectPath) + '"'
    )

    elements.sessionInspector.innerHTML = html
    elements.sessionInspector.style.display = 'block'
  }

  elements.sessionInspector.addEventListener('click', function (event) {
    const copyTarget = event.target.closest('.insp-copy')
    const text = copyTarget && copyTarget.dataset.copy
    if (!text) return

    navigator.clipboard.writeText(text).then(function () {
      showToast('Copied: ' + text.slice(0, 20) + '…')
    })
  })

  elements.filterBar.addEventListener('click', function (event) {
    const pill = event.target.closest('.filter-pill')
    if (!pill) return
    selectedFilter = pill.dataset.filter || 'all'
    synchronizeSelectedProjectWithView()
    renderProjects()
    renderSessions()
  })

  elements.sortSelect.addEventListener('change', function () {
    selectedSort = elements.sortSelect.value
    renderSessions()
  })

