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

/** Updates filter pill active state, counts, and tooltips. Hides the bar entirely when no project is selected. */
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
    pill.title = filterTooltip(filter)
    pill.innerHTML =
      filterLabel(filter) + (count > 0 ? '<span class="pill-cnt">' + count + '</span>' : '')
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

/** Fetches fresh Resume Card data while preserving any existing rendered card. */
function refreshSessionPreview(project, session, key, entry) {
  entry.refreshing = true
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
      if (entry.data) {
        entry.refreshError = error.message
        entry.refreshing = false
        entry.stale = false
      } else {
        sessionPreviewCache.set(key, { error: error.message, state: 'error' })
      }
      if (
        selectedProject &&
        selectedProject.id === project.id &&
        selectedSession?.id === session.id
      ) {
        renderInspector(deriveVisibleSessions())
      }
    })
}

/** Starts loading Resume Card data for a session if it is not already cached. */
function ensureSessionPreview(project, session) {
  const key = previewCacheKey(project, session)
  const cached = sessionPreviewCache.get(key)
  if (cached) {
    if (cached.stale && !cached.refreshing) refreshSessionPreview(project, session, key, cached)
    return cached
  }

  const loadingEntry = { state: 'loading' }
  sessionPreviewCache.set(key, loadingEntry)
  refreshSessionPreview(project, session, key, loadingEntry)

  return loadingEntry
}

/** Marks cached previews stale so live refreshes do not blank the inspector while reloading. */
function markSessionPreviewsStale() {
  sessionPreviewCache.forEach(function (entry, key) {
    if (entry.state === 'ready' && entry.data) {
      entry.stale = true
      entry.refreshError = null
      return
    }
    if (entry.state !== 'loading') sessionPreviewCache.delete(key)
  })
}

/** Returns action buttons for the selected session. These mirror the row menu and keyboard shortcuts. */
function buildInspectorActionsHtml(session) {
  const deleteDisabled = activeSessionIds.has(session.id)
  const isArchived = session.signals.archived
  return (
    '<div class="insp-actions">' +
    '<button class="insp-action primary" data-inspector-action="session-resume" title="' +
    escapeHtml(STRINGS.inspBtnResumeTooltip) +
    '">' +
    STRINGS.inspBtnResume +
    '</button>' +
    '<button class="insp-action" data-inspector-action="session-handoff" title="' +
    escapeHtml(STRINGS.inspBtnHandoffTooltip) +
    '">' +
    STRINGS.inspBtnHandoff +
    '</button>' +
    '<button class="insp-action" data-inspector-action="session-rename" title="' +
    escapeHtml(STRINGS.inspBtnRenameTooltip) +
    '">' +
    STRINGS.inspBtnRename +
    '</button>' +
    '<button class="insp-action" data-inspector-action="session-archive" title="' +
    escapeHtml(isArchived ? STRINGS.inspBtnUnarchiveTooltip : STRINGS.inspBtnArchiveTooltip) +
    '">' +
    (isArchived ? STRINGS.inspBtnUnarchive : STRINGS.inspBtnArchive) +
    '</button>' +
    '<button class="insp-action danger" data-inspector-action="session-delete" title="' +
    escapeHtml(
      deleteDisabled ? STRINGS.inspBtnDeleteDisabledTooltip : STRINGS.inspBtnDeleteTooltip
    ) +
    '"' +
    (deleteDisabled ? ' disabled' : '') +
    '>' +
    STRINGS.inspBtnDelete +
    '</button>' +
    '</div>' +
    '<div class="insp-shortcuts">' +
    STRINGS.inspShortcuts +
    '</div>'
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
    (text
      ? escapeHtml(text)
      : '<span class="preview-empty">' + STRINGS.previewNotFound + '</span>') +
    '</div>' +
    '</div>'
  )
}

/** Returns one labelled Resume Card block with a safe, tiny Markdown subset. */
function buildPreviewMarkdownBlockHtml(label, text) {
  return (
    '<div class="preview-block">' +
    '<div class="preview-label">' +
    label +
    '</div>' +
    '<div class="preview-markdown">' +
    (text
      ? renderPreviewMarkdown(text)
      : '<span class="preview-empty">' + STRINGS.previewNotFound + '</span>') +
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
    '<div class="preview-label">' +
    fmt(STRINGS.previewFilesTouched, { count: preview.touchedFiles.length }) +
    '</div>' +
    rows +
    '</div>'
  )
}

/** Returns the latest Claude-native plan section when the transcript contains one. */
function buildNativePlanHtml(automaticContext) {
  const plan = automaticContext && automaticContext.plan
  return plan ? buildPreviewMarkdownBlockHtml(STRINGS.previewNativePlan, plan.text) : ''
}

/** Returns a compact, read-only view of Claude-native TodoWrite state. */
function buildNativeTodosHtml(automaticContext) {
  const todos = automaticContext && automaticContext.todos
  if (!todos || !Array.isArray(todos.items) || todos.items.length === 0) return ''

  const visibleTodos = selectVisibleTodos(todos.items)
  const rows = visibleTodos
    .map(function (todo) {
      const status = todo.status || 'unknown'
      return (
        '<div class="preview-todo preview-todo--' +
        escapeHtml(status) +
        '" title="' +
        escapeHtml(status) +
        '">' +
        '<span class="preview-todo-marker">' +
        todoMarker(todo) +
        '</span>' +
        escapeHtml(todo.content) +
        '</div>'
      )
    })
    .join('')
  const remainingCount = todos.items.length - visibleTodos.length
  const remaining =
    remainingCount > 0
      ? '<div class="preview-more">' +
        escapeHtml(fmt(STRINGS.previewTodoMore, { n: remainingCount })) +
        '</div>'
      : ''

  return (
    '<div class="preview-block">' +
    '<div class="preview-label">' +
    STRINGS.previewNativeTodos +
    ' · ' +
    escapeHtml(
      fmt(STRINGS.previewNativeTodosSummary, {
        done: todos.counts?.completed || 0,
        open:
          (todos.counts?.pending || 0) +
          (todos.counts?.in_progress || 0) +
          (todos.counts?.unknown || 0),
      })
    ) +
    '</div>' +
    rows +
    remaining +
    '</div>'
  )
}

/** Returns the selected session's on-demand Resume Card preview HTML. */
function buildSessionPreviewHtml(project, session) {
  const entry = ensureSessionPreview(project, session)

  if (entry.state === 'loading') {
    return (
      '<div class="preview-card"><div class="preview-loading">' +
      STRINGS.previewLoading +
      '</div></div>'
    )
  }
  if (entry.state === 'error') {
    return (
      '<div class="preview-card"><div class="preview-error">' +
      escapeHtml(fmt(STRINGS.previewError, { error: entry.error || 'unknown error' })) +
      '</div></div>'
    )
  }

  const preview = entry.data || {}
  return (
    '<div class="preview-card">' +
    '<div class="preview-title">' +
    STRINGS.previewTitle +
    '</div>' +
    buildPreviewBlockHtml(STRINGS.previewGoal, preview.goal) +
    buildPreviewBlockHtml(STRINGS.previewLastResponse, preview.lastResponse) +
    buildNativePlanHtml(preview.automaticContext) +
    buildNativeTodosHtml(preview.automaticContext) +
    (preview.pendingToolName
      ? '<div class="preview-warning">' +
        escapeHtml(fmt(STRINGS.previewPendingTool, { name: preview.pendingToolName })) +
        '</div>'
      : '') +
    buildTouchedFilesHtml(preview, session) +
    '</div>'
  )
}

const MAX_VISIBLE_NATIVE_TODOS = 5

function selectVisibleTodos(items) {
  const unfinished = items.filter(function (todo) {
    return todo.status !== 'completed'
  })
  return (unfinished.length > 0 ? unfinished : items).slice(0, MAX_VISIBLE_NATIVE_TODOS)
}

function todoMarker(todo) {
  if (todo.status === 'completed') return '[x]'
  if (todo.status === 'in_progress') return '[~]'
  if (todo.status === 'pending') return '[ ]'
  return '[?]'
}

function renderPreviewMarkdown(markdown) {
  const lines = String(markdown).replace(/\r\n?/g, '\n').split('\n')
  let html = ''
  let inList = false

  function closeList() {
    if (!inList) return
    html += '</ul>'
    inList = false
  }

  lines.forEach(function (rawLine) {
    const line = rawLine.trim()
    if (!line) {
      closeList()
      return
    }

    const heading = line.match(/^#{1,4}\s+(.+)$/)
    if (heading) {
      closeList()
      html += '<div class="preview-md-heading">' + renderMarkdownInline(heading[1]) + '</div>'
      return
    }

    const bullet = line.match(/^(?:[-*]|\d+\.)\s+(.+)$/)
    if (bullet) {
      if (!inList) {
        html += '<ul class="preview-md-list">'
        inList = true
      }
      html += '<li>' + renderMarkdownInline(bullet[1]) + '</li>'
      return
    }

    closeList()
    html += '<p>' + renderMarkdownInline(line) + '</p>'
  })

  closeList()
  return html || '<span class="preview-empty">' + STRINGS.previewNotFound + '</span>'
}

function renderMarkdownInline(text) {
  return String(text)
    .split(/(`[^`]+`)/g)
    .map(function (part) {
      if (part.startsWith('`') && part.endsWith('`')) {
        return '<code>' + escapeHtml(part.slice(1, -1)) + '</code>'
      }
      return escapeHtml(part).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    })
    .join('')
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
    interrupted: STRINGS.statusInterruptedDesc,
    expiring: fmt(STRINGS.statusExpiringDesc, { days: signals.expiresInDays }),
    'path-missing': STRINGS.statusPathMissingDesc,
    'heavily-compacted': fmt(STRINGS.statusHeavilyCompactedDesc, {
      count: signals.compactionCount,
    }),
  }
  const statusDescription = descriptions[session.primaryStatus]
  const status =
    buildStatusBadgeHtml(session) ||
    '<span style="color:var(--muted2)">' + STRINGS.inspStatusOk + '</span>'
  const statusValue =
    status +
    (statusDescription
      ? '<span class="insp-note">' + escapeHtml(statusDescription) + '</span>'
      : '')

  let html =
    '<div class="insp-title-row">' +
    '<div class="insp-title">' +
    STRINGS.inspectorTitle +
    '</div>' +
    '<button class="insp-icon-btn" data-inspector-action="session-copy-id" title="' +
    escapeHtml(STRINGS.inspectorCopyId) +
    '">ID</button>' +
    '</div>'
  html += buildInspectorActionsHtml(session)
  html += buildSessionPreviewHtml(selectedProject, session)
  html += buildInspectorRowHtml(STRINGS.inspRowStatus, statusValue)
  html += buildInspectorRowHtml(
    STRINGS.inspRowLastActive,
    '<em>' + escapeHtml(relativeTime(session.updated)) + '</em>'
  )
  html += buildInspectorRowHtml(STRINGS.inspRowMessages, session.messageCount)
  if (signals.analysisComplete && signals.compactionCount > 0) {
    html += buildInspectorRowHtml(
      STRINGS.inspRowCompactions,
      signals.compactionCount,
      null,
      'title="' + escapeHtml(STRINGS.inspRowCompactionsTooltip) + '"'
    )
  }
  if (signals.expiresInDays != null) {
    html += buildInspectorRowHtml(
      STRINGS.inspRowExpiresIn,
      fmt(STRINGS.inspRowExpiresInValue, { days: signals.expiresInDays }),
      null,
      'title="' + escapeHtml(STRINGS.inspRowExpiresInTooltip) + '"'
    )
  }
  if (session.context.latestModel) {
    html += buildInspectorRowHtml(
      STRINGS.inspRowLatestModel,
      escapeHtml(session.context.latestModel)
    )
  }
  if (session.context.latestContextTokens != null) {
    html += buildInspectorRowHtml(
      STRINGS.inspRowLastContext,
      fmt(STRINGS.inspRowTokenValue, {
        count: formatTokenCount(session.context.latestContextTokens),
      }),
      null,
      'title="' + escapeHtml(STRINGS.inspRowLastContextTooltip) + '"'
    )
  }
  if (session.context.latestOutputTokens != null) {
    html += buildInspectorRowHtml(
      STRINGS.inspRowLastOutput,
      fmt(STRINGS.inspRowTokenValue, {
        count: formatTokenCount(session.context.latestOutputTokens),
      }),
      null,
      'title="' + escapeHtml(STRINGS.inspRowLastOutputTooltip) + '"'
    )
  }
  if (session.context.models && session.context.models.length > 1) {
    html += buildInspectorRowHtml(
      STRINGS.inspRowModelsUsed,
      escapeHtml(session.context.models.join(', ')),
      null,
      'title="' + escapeHtml(STRINGS.inspRowModelsUsedTooltip) + '"'
    )
  }
  html += buildInspectorRowHtml(
    STRINGS.inspRowSessionId,
    session.id.slice(0, 8) + '...',
    'insp-copy',
    'title="' +
      escapeHtml(STRINGS.inspRowSessionIdTooltip) +
      '" data-copy="' +
      escapeHtml(session.id) +
      '"'
  )
  html += buildInspectorRowHtml(
    STRINGS.inspRowPath,
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

  copyTextToClipboard(text, fmt(STRINGS.inspCopied, { prefix: text.slice(0, 20) }))
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
