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

/** Returns the stable cache key for a session preview. */
function previewCacheKey(project, session) {
  return project.id + ':' + session.id
}

/** Starts loading Resume Card data for a session if it is not already cached. */
function ensureSessionPreview(project, session) {
  const key = previewCacheKey(project, session)
  const cached = sessionPreviewCache.get(key)
  if (cached) return cached

  const loadingEntry = { state: 'loading' }
  sessionPreviewCache.set(key, loadingEntry)

  requestJson('/api/sessions/' + project.id + '/' + session.id + '/preview')
    .then(function (preview) {
      sessionPreviewCache.set(key, { data: preview, state: 'ready' })
      if (
        selectedProject &&
        selectedProject.id === project.id &&
        selectedSession?.id === session.id
      ) {
        renderInspector(deriveVisibleSessions())
      }
    })
    .catch(function (error) {
      sessionPreviewCache.set(key, { error: error.message, state: 'error' })
      if (
        selectedProject &&
        selectedProject.id === project.id &&
        selectedSession?.id === session.id
      ) {
        renderInspector(deriveVisibleSessions())
      }
    })

  return loadingEntry
}

/** Returns action buttons for the selected session. These mirror the row menu and keyboard shortcuts. */
function buildInspectorActionsHtml(session) {
  const deleteDisabled = activeSessionIds.has(session.id)
  return (
    '<div class="insp-actions">' +
    '<button class="insp-action primary" data-inspector-action="session-resume">Resume</button>' +
    '<button class="insp-action" data-inspector-action="session-handoff">Handoff</button>' +
    '<button class="insp-action" data-inspector-action="session-rename">Rename</button>' +
    '<button class="insp-action" data-inspector-action="session-archive">' +
    (session.signals.archived ? 'Unarchive' : 'Archive') +
    '</button>' +
    '<button class="insp-action danger" data-inspector-action="session-delete"' +
    (deleteDisabled ? ' disabled title="Active sessions cannot be deleted"' : '') +
    '>Delete</button>' +
    '</div>' +
    '<div class="insp-shortcuts">enter resume · H handoff · r rename · a archive · D delete</div>'
  )
}

/** Returns one labelled Resume Card text block. */
function buildPreviewBlockHtml(label, text) {
  return (
    '<div class="preview-block">' +
    '<div class="preview-label">' +
    label +
    '</div>' +
    '<div class="preview-text">' +
    (text ? escapeHtml(text) : '<span class="preview-empty">Not found in transcript.</span>') +
    '</div>' +
    '</div>'
  )
}

/** Returns the "files touched" preview section. */
function buildTouchedFilesHtml(preview, session) {
  if (!preview.touchedFiles || preview.touchedFiles.length === 0) return ''
  const rows = preview.touchedFiles
    .map(function (file) {
      return (
        '<div class="preview-file" title="' +
        escapeHtml(file) +
        '">' +
        escapeHtml(projectRelativePath(file, session.projectPath)) +
        '</div>'
      )
    })
    .join('')
  return (
    '<div class="preview-block">' +
    '<div class="preview-label">files touched · ' +
    preview.touchedFiles.length +
    '</div>' +
    rows +
    '</div>'
  )
}

/** Returns the selected session's on-demand Resume Card preview HTML. */
function buildSessionPreviewHtml(project, session) {
  const entry = ensureSessionPreview(project, session)

  if (entry.state === 'loading') {
    return '<div class="preview-card"><div class="preview-loading">Loading session preview...</div></div>'
  }
  if (entry.state === 'error') {
    return (
      '<div class="preview-card"><div class="preview-error">Preview unavailable: ' +
      escapeHtml(entry.error || 'unknown error') +
      '</div></div>'
    )
  }

  const preview = entry.data || {}
  return (
    '<div class="preview-card">' +
    '<div class="preview-title">Resume Card</div>' +
    buildPreviewBlockHtml('what you asked for', preview.goal) +
    buildPreviewBlockHtml('where Claude left off', preview.lastResponse) +
    (preview.pendingToolName
      ? '<div class="preview-warning">Pending tool: ' +
        escapeHtml(preview.pendingToolName) +
        '</div>'
      : '') +
    buildTouchedFilesHtml(preview, session) +
    '</div>'
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
    interrupted: 'Claude had pending tool calls with no result - resume to continue.',
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

  let html =
    '<div class="insp-title-row">' +
    '<div class="insp-title">Session Details</div>' +
    '<button class="insp-icon-btn" data-inspector-action="session-copy-id" title="Copy full session ID">ID</button>' +
    '</div>'
  html += buildInspectorActionsHtml(session)
  html += buildSessionPreviewHtml(selectedProject, session)
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
    session.id.slice(0, 8) + '...',
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
  const actionButton = event.target.closest('[data-inspector-action]')
  if (actionButton && selectedSession) {
    executeSessionAction(actionButton.dataset.inspectorAction, selectedSession)
    return
  }

  const copyTarget = event.target.closest('.insp-copy')
  const text = copyTarget && copyTarget.dataset.copy
  if (!text) return

  copyTextToClipboard(text, 'Copied: ' + text.slice(0, 20) + '...')
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
