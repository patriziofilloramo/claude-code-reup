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
  if (elements.filterScopeLabel) elements.filterScopeLabel.textContent = STRINGS.filterScopeLabel
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

function buildPreviewLabelHtml(label, icon) {
  return (
    '<div class="preview-label">' +
    (icon ? '<span class="preview-label-icon">' + icon + '</span>' : '') +
    '<span>' +
    label +
    '</span>' +
    '</div>'
  )
}

/** Returns one labelled Resume Card text block. */
function buildPreviewBlockHtml(label, text, blockClass, icon) {
  return (
    '<div class="preview-block' +
    (blockClass ? ' ' + blockClass : '') +
    '">' +
    buildPreviewLabelHtml(label, icon) +
    '<div class="preview-text">' +
    (text
      ? escapeHtml(text)
      : '<span class="preview-empty">' + STRINGS.previewNotFound + '</span>') +
    '</div>' +
    '</div>'
  )
}

/** Returns one labelled Resume Card block with a safe, tiny Markdown subset. */
function buildPreviewMarkdownBlockHtml(label, text, blockClass, icon) {
  return (
    '<div class="preview-block' +
    (blockClass ? ' ' + blockClass : '') +
    '">' +
    buildPreviewLabelHtml(label, icon) +
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
    buildPreviewLabelHtml(
      fmt(STRINGS.previewFilesTouched, { count: preview.touchedFiles.length }),
      '✎'
    ) +
    rows +
    '</div>'
  )
}

/**
 * Maps AutomaticFactSource values to reader-friendly labels.
 * Returns the raw value for any unknown source so new sources surface visibly.
 */
function friendlySource(source) {
  if (source === 'summary-event') return 'compaction'
  if (source === 'assistant-tool' || source === 'tool-result') return 'tool result'
  if (source === 'attachment') return 'attachment'
  if (source === 'transcript-event') return 'transcript'
  return source || ''
}

/** Returns the latest Claude-native plan section when the transcript contains one. */
function buildNativePlanHtml(automaticContext) {
  const plan = automaticContext && automaticContext.plan
  if (!plan) return ''
  const labelParts = [STRINGS.previewNativePlan]
  if (plan.source) labelParts.push(friendlySource(plan.source))
  return buildPreviewMarkdownBlockHtml(
    labelParts.join(' · '),
    plan.text,
    'preview-block--scrollable',
    '▤'
  )
}

/** Returns a compact, read-only view of Claude-native TodoWrite state. */
function buildNativeTodosHtml(automaticContext) {
  const todos = automaticContext && automaticContext.todos
  if (!todos || !Array.isArray(todos.items) || todos.items.length === 0) return ''

  const rows = todos.items
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

  const summaryLabelParts = [
    STRINGS.previewNativeTodos,
    escapeHtml(
      fmt(STRINGS.previewNativeTodosSummary, {
        done: todos.counts?.completed || 0,
        open:
          (todos.counts?.pending || 0) +
          (todos.counts?.in_progress || 0) +
          (todos.counts?.unknown || 0),
      })
    ),
  ]
  if (todos.source) summaryLabelParts.push(escapeHtml(friendlySource(todos.source)))

  return (
    '<div class="preview-block preview-block--scrollable">' +
    buildPreviewLabelHtml(summaryLabelParts.join(' · '), '☑') +
    '<div class="preview-todos-body">' +
    rows +
    '</div>' +
    '</div>'
  )
}

/** Returns a compact summary of files read and research actions taken in the session. */
function buildResearchTrailHtml(automaticContext) {
  const readFiles = (automaticContext && automaticContext.readFiles) || []
  const researchActions = (automaticContext && automaticContext.researchActions) || []
  const totalCount = readFiles.length + researchActions.length
  if (totalCount === 0) return ''

  const kindPrefix = { grep: '~', glob: '*', 'web-search': '?', 'web-fetch': '→' }

  const fileRows = readFiles
    .map(function (file) {
      return (
        '<div class="preview-file" title="' +
        escapeHtml(file) +
        '">r ' +
        escapeHtml(file) +
        '</div>'
      )
    })
    .join('')

  const actionRows = researchActions
    .map(function (action) {
      const prefix = (kindPrefix[action.kind] || '?') + ' ' + escapeHtml(action.kind)
      const detail = action.query ? ': ' + escapeHtml(action.query) : ''
      return '<div class="preview-file">' + prefix + detail + '</div>'
    })
    .join('')

  return (
    '<div class="preview-block">' +
    buildPreviewLabelHtml(fmt(STRINGS.previewResearchTrail, { count: totalCount }), '⌕') +
    '<div class="preview-todos-body">' +
    fileRows +
    actionRows +
    '</div>' +
    '</div>'
  )
}

/** Returns a compact summary of tool failures and interruptions, or empty string when clean. */
function buildToolHealthHtml(automaticContext) {
  const health = automaticContext && automaticContext.toolHealth
  if (!health) return ''

  const failed = health.failed || []
  const interrupted = health.interrupted || []
  if (failed.length === 0 && interrupted.length === 0) return ''

  const summaryParts = []
  if (failed.length > 0) summaryParts.push(fmt(STRINGS.previewToolFailed, { count: failed.length }))
  if (interrupted.length > 0)
    summaryParts.push(fmt(STRINGS.previewToolInterrupted, { count: interrupted.length }))

  const failedRows = failed
    .map(function (t) {
      return '<div class="preview-file">✗ ' + escapeHtml(t.name) + '</div>'
    })
    .join('')

  const interruptedRows = interrupted
    .map(function (t) {
      return '<div class="preview-file">⚡ ' + escapeHtml(t.name) + '</div>'
    })
    .join('')

  return (
    '<div class="preview-block">' +
    buildPreviewLabelHtml(STRINGS.previewToolHealth + ' · ' + summaryParts.join(', '), '⚠') +
    failedRows +
    interruptedRows +
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
    buildPreviewBlockHtml(STRINGS.previewGoal, preview.goal, null, '?') +
    buildPreviewMarkdownBlockHtml(
      STRINGS.previewLastResponse,
      preview.lastResponse,
      'preview-block--scrollable',
      '↳'
    ) +
    buildNativePlanHtml(preview.automaticContext) +
    buildNativeTodosHtml(preview.automaticContext) +
    buildResearchTrailHtml(preview.automaticContext) +
    buildToolHealthHtml(preview.automaticContext) +
    (preview.pendingToolName
      ? '<div class="preview-warning">' +
        escapeHtml(fmt(STRINGS.previewPendingTool, { name: preview.pendingToolName })) +
        '</div>'
      : '') +
    buildTouchedFilesHtml(preview, session) +
    '</div>'
  )
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

function isSessionInspectorExpanded(visibleSessions) {
  return (
    sessionInspectorExpanded &&
    selectedSession &&
    !window.matchMedia('(max-width: 639px)').matches &&
    visibleSessions.some(function (session) {
      return session.id === selectedSession.id
    })
  )
}

/**
 * Builds the compact Org section for the inspector: tags, group, stack memberships.
 * Returns "" when no org data is loaded and the session has no tags.
 */
function buildOrgInspectorHtml(session, project) {
  var tags = session.tags || []
  var assignments = (orgData && orgData.projectGroupAssignments) || {}
  var groups = (orgData && orgData.groups) || []
  var stacks = (orgData && orgData.stacks) || []

  // Find group name
  var groupId = assignments[project ? project.id : '']
  var groupName = null
  for (var gi = 0; gi < groups.length; gi++) {
    if (groups[gi].id === groupId) {
      groupName = groups[gi].name
      break
    }
  }

  // Find stacks containing this session or project
  var sessionStackNames = []
  for (var si = 0; si < stacks.length; si++) {
    var stack = stacks[si]
    var inStack = stack.items.some(function (item) {
      if (item.kind === 'project' && project && item.projectId === project.id) return true
      if (item.kind === 'session' && item.sessionId === session.id) return true
      return false
    })
    if (inStack) sessionStackNames.push(stack.name)
  }

  if (tags.length === 0 && !groupName && sessionStackNames.length === 0 && !orgData) return ''

  var html = '<div class="insp-org-section">'

  // Tags row
  html += '<div class="insp-org-row">'
  html += '<span class="insp-org-label">' + escapeHtml(STRINGS.inspOrgTags) + '</span>'
  html += '<span class="insp-org-value">'
  for (var ti = 0; ti < tags.length; ti++) {
    html +=
      '<span class="s-tag insp-tag" data-tag="' +
      escapeHtml(tags[ti]) +
      '">#' +
      escapeHtml(tags[ti]) +
      '</span>'
  }
  html +=
    '<button class="insp-org-add" data-inspector-action="session-tag">' +
    escapeHtml(STRINGS.inspOrgAddTag) +
    '</button>'
  html += '</span></div>'

  // Group row
  if (groupName || orgData) {
    html += '<div class="insp-org-row">'
    html += '<span class="insp-org-label">' + escapeHtml(STRINGS.inspOrgGroup) + '</span>'
    html +=
      '<span class="insp-org-value">' +
      (groupName
        ? '<span class="insp-org-pill">' + escapeHtml(groupName) + '</span>'
        : '<span class="insp-org-muted">' + escapeHtml(STRINGS.inspOrgNoGroup) + '</span>') +
      '</span>'
    html += '</div>'
  }

  // Stacks row
  if (sessionStackNames.length > 0 || orgData) {
    html += '<div class="insp-org-row">'
    html += '<span class="insp-org-label">' + escapeHtml(STRINGS.inspOrgStacks) + '</span>'
    html += '<span class="insp-org-value">'
    if (sessionStackNames.length > 0) {
      for (var sni = 0; sni < sessionStackNames.length; sni++) {
        html += '<span class="insp-org-pill">' + escapeHtml(sessionStackNames[sni]) + '</span>'
      }
    } else {
      html += '<span class="insp-org-muted">' + escapeHtml(STRINGS.inspOrgNoGroup) + '</span>'
    }
    html += '</span></div>'
  }

  html += '</div>'
  return html
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
    '<button class="insp-expand-btn" data-inspector-action="inspector-toggle-expanded" title="' +
    escapeHtml(
      sessionInspectorExpanded
        ? STRINGS.inspCollapseDetailsTooltip
        : STRINGS.inspExpandDetailsTooltip
    ) +
    '" aria-label="' +
    escapeHtml(
      sessionInspectorExpanded
        ? STRINGS.inspCollapseDetailsTooltip
        : STRINGS.inspExpandDetailsTooltip
    ) +
    '">' +
    '<span class="insp-expand-icon">' +
    (isSessionInspectorExpanded(visibleSessions) ? '▾' : '▴') +
    '</span>' +
    '<span class="insp-expand-label">' +
    (isSessionInspectorExpanded(visibleSessions)
      ? STRINGS.inspCollapseDetailsLabel
      : STRINGS.inspExpandDetailsLabel) +
    '</span>' +
    '</button>' +
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
  html += buildOrgInspectorHtml(session, selectedProject)

  elements.sessionInspector.innerHTML = html
  elements.sessionInspector.style.display = 'block'
}

elements.sessionInspector.addEventListener('click', function (event) {
  // Tag chip in org section — set tag focus filter
  const inspTag = event.target.closest('.insp-tag')
  if (inspTag) {
    var tag = inspTag.dataset.tag
    if (tag) {
      focusFilter =
        focusFilter && focusFilter.kind === 'tag' && focusFilter.tag === tag
          ? null
          : { kind: 'tag', tag: tag }
      renderRail()
      renderFocusBar()
      renderProjects()
      renderSessions()
    }
    return
  }

  const actionButton = event.target.closest('[data-inspector-action]')
  if (actionButton && selectedSession) {
    if (actionButton.dataset.inspectorAction === 'inspector-toggle-expanded') {
      sessionInspectorExpanded = !sessionInspectorExpanded
      renderSessions()
      return
    }
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
