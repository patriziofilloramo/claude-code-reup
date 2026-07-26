// ---------------------------------------------------------------------------
// Session list rendering and metadata actions
// ---------------------------------------------------------------------------

const TAG_CHIPS_MAX = 2

/**
 * Renders up to TAG_CHIPS_MAX tag chips for a session, with a "+N" overflow badge.
 * Returns "" when there are no tags.
 */
function buildTagChipsHtml(tags) {
  if (!tags || tags.length === 0) return ''
  var shown = tags.slice(0, TAG_CHIPS_MAX)
  var overflow = tags.length - shown.length
  var html = '<span class="s-tags">'
  for (var i = 0; i < shown.length; i++) {
    html +=
      '<span class="s-tag" data-tag="' +
      escapeHtml(shown[i]) +
      '">#' +
      escapeHtml(shown[i]) +
      '</span>'
  }
  if (overflow > 0) {
    html +=
      '<span class="s-tag-overflow">' + fmt(STRINGS.tagChipOverflow, { n: overflow }) + '</span>'
  }
  html += '</span>'
  return html
}

/**
 * Resolves the working/waiting/idle/attention state for a live session row,
 * matching the rail's and inspector's activityDot treatment. Falls back to
 * "idle" when the session is live but has no live-activity entry yet (a
 * brief gap right after activeSessionIds updates, before the next snapshot).
 */
function liveSessionRowState(sessionId) {
  const entry = findLiveActivity(sessionId)
  const state =
    entry && entry.attention ? 'attention' : entry ? entry.activityState || 'idle' : 'idle'
  const label =
    entry && entry.attention
      ? STRINGS.activityNeedsInput
      : state === 'running'
        ? STRINGS.activityRunning
        : state === 'waiting'
          ? STRINGS.activityWaiting
          : STRINGS.activityIdle
  return { label, state }
}

/** Renders a single session row (two lines + optional deep-search snippet) as an HTML string. */
function buildSessionRowHtml(session) {
  const isSelected = selectedSession && session.id === selectedSession.id
  const branch = session.gitBranch || null
  const displayName = session.alias || session.name
  const isLive = activeSessionIds.has(session.id)
  const liveState = isLive ? liveSessionRowState(session.id) : null

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
    '<span class="s-live"' +
    (liveState ? ' title="' + escapeHtml(liveState.label) + '"' : '') +
    '>' +
    (liveState ? '<span class="activity-dot ' + escapeHtml(liveState.state) + '"></span>' : '') +
    '</span>' +
    (renamingSessionId === session.id
      ? '<input class="s-rename-input" value="' + escapeHtml(displayName) + '" maxlength="160">'
      : '<span class="s-name">' + escapeHtml(displayName) + '</span>') +
    '<span class="s-time" title="' +
    escapeHtml(
      fmt(STRINGS.sessionTimeTooltip, { date: new Date(session.updated).toLocaleString() })
    ) +
    '">' +
    relativeTime(session.updated) +
    '</span>' +
    '<button class="s-menu-btn" title="' +
    escapeHtml(STRINGS.sessionMoreActions) +
    '">⋯</button>' +
    '</div>' +
    '<div class="s-line2">' +
    (branch
      ? '<span class="branch-n" style="color:' +
        colorForGitBranch(branch) +
        '" title="' +
        escapeHtml(fmt(STRINGS.sessionBranchTooltip, { branch: branch })) +
        '">⎇ ' +
        escapeHtml(branch) +
        '</span>' +
        buildBranchDriftHtml(session) +
        '<span class="s-sep">·</span>'
      : '') +
    '<span class="s-msgs">' +
    session.messageCount +
    ' msgs</span>' +
    (session.context.latestModel
      ? '<span class="s-model" title="' +
        escapeHtml(fmt(STRINGS.sessionModelTooltip, { model: session.context.latestModel })) +
        '">' +
        escapeHtml(session.context.latestModel) +
        '</span>'
      : '') +
    (session.context.latestContextTokens != null
      ? '<span class="s-context" title="' +
        escapeHtml(
          fmt(STRINGS.sessionContextTooltip, {
            tokens: formatTokenCount(session.context.latestContextTokens),
          })
        ) +
        '">' +
        formatTokenCount(session.context.latestContextTokens) +
        ' ctx</span>'
      : '') +
    buildStatusBadgeHtml(session) +
    buildTagChipsHtml(session.tags) +
    '</div>' +
    (deepSearchActive ? buildDeepSnippetHtml(getDeepMatchForSession(session.id)) : '') +
    '</div>'
  )
}

/** Returns an empty-state HTML message when there are no sessions to show, or "" when there are. */
function buildEmptySessionListHtml(visibleSessions) {
  if (!selectedProject) {
    return searchQuery
      ? '<div class="empty">' + STRINGS.emptyNoMatch + '</div>'
      : '<div class="empty">' + STRINGS.emptySelectProject + '</div>'
  }
  if (visibleSessions.length > 0) return ''

  const archivedCount = sessionsMatchingFilter(selectedProject, 'archived').length
  const message = searchQuery
    ? STRINGS.emptyNoSessionsSearch
    : selectedFilter === 'all'
      ? STRINGS.emptyNoSessions
      : STRINGS.emptyNoSessionsFilter
  const archiveHint =
    selectedFilter === 'all' && archivedCount > 0
      ? ' <span class="empty-hint">' +
        fmt(STRINGS.emptyArchivedHint, { n: archivedCount }) +
        '</span>'
      : ''
  return '<div class="empty">' + message + archiveHint + '</div>'
}

function countReviewBucketSessionsForProject(project, bucket) {
  if (!project) return 0
  var count = 0
  for (var i = 0; i < project.sessions.length; i++) {
    var session = project.sessions[i]
    if (!session.signals.archived && bucket.test(session)) count++
  }
  return count
}

function applyReviewSearchToken(token) {
  if (deepSearchActive) exitInlineDeepSearch()
  openSearch()
  searchQuery = token
  selectedFilter = 'all'
  elements.searchInput.value = token
  elements.searchInput.focus()
  synchronizeSelectedProjectWithView()
  renderProjects()
  renderSessions()
}

function renderReviewSignals() {
  if (!elements.reviewSignals) return
  if (!selectedProject || deepSearchActive) {
    elements.reviewSignals.style.display = 'none'
    elements.reviewSignals.innerHTML = ''
    return
  }

  var html = ''
  for (var i = 0; i < REVIEW_BUCKETS.length; i++) {
    var bucket = REVIEW_BUCKETS[i]
    var count = countReviewBucketSessionsForProject(selectedProject, bucket)
    if (count === 0) continue

    var label = STRINGS[bucket.labelKey] || bucket.id
    var countLabel = count === 1 ? '1 session' : count + ' sessions'
    var tooltip = fmt(STRINGS.reviewSignalTooltip, {
      count: countLabel,
      label: label,
      token: bucket.searchToken,
    })
    html +=
      '<button class="review-signal ' +
      bucket.cssClass +
      '" data-review-token="' +
      escapeHtml(bucket.searchToken) +
      '" data-tooltip="' +
      escapeHtml(tooltip) +
      '" aria-label="' +
      escapeHtml(tooltip) +
      '">' +
      bucket.icon +
      '</button>'
  }

  elements.reviewSignals.innerHTML = html
  elements.reviewSignals.style.display = html ? 'flex' : 'none'
}

/** Re-renders the session list, panel header, filter bar, and inspector from current state. */
function renderSessions() {
  const visibleSessions = deriveVisibleSessions()
  synchronizeSelectedSession()
  const inspectorIsExpanded = isSessionInspectorExpanded(visibleSessions)
  const listedSessions = inspectorIsExpanded ? [selectedSession] : visibleSessions
  document.body.classList.toggle('session-details-expanded', inspectorIsExpanded)

  if (deepSearchActive) {
    elements.sessionPanelTitle.textContent = deepSearchLoading
      ? STRINGS.sessionSearching
      : '⌕ ' + deepSearchQueryTerm
    elements.sessionCount.textContent = deepSearchLoading
      ? ''
      : fmt(STRINGS.sessionDeepFound, { n: deepSearchMatches.length })
  } else {
    elements.sessionPanelTitle.textContent = selectedProject
      ? compactPath(selectedProject.path)
      : STRINGS.sessionPanelPlaceholder
    elements.sessionCount.textContent = selectedProject
      ? fmt(STRINGS.sessionCountLabel, { n: visibleSessions.length })
      : ''
  }
  renderReviewSignals()
  renderFilterBar()
  renderInspector(visibleSessions)

  if (deepSearchActive && deepSearchLoading) {
    elements.sessionList.innerHTML = matrixSoftLoaderHtml(STRINGS.sessionSearching)
  } else {
    const emptyHtml = buildEmptySessionListHtml(visibleSessions)
    elements.sessionList.innerHTML = emptyHtml || listedSessions.map(buildSessionRowHtml).join('')
  }

  if (renamingSessionId) {
    const input = elements.sessionList.querySelector('.s-rename-input')
    if (input) {
      input.focus()
      input.select()
    }
  }
}

if (elements.reviewSignals) {
  elements.reviewSignals.addEventListener('click', function (event) {
    var button = event.target.closest('.review-signal')
    if (!button) return
    var token = button.dataset.reviewToken
    if (token) applyReviewSearchToken(token)
  })
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
    showToast(alias ? fmt(STRINGS.sessionRenamed, { alias: alias }) : STRINGS.sessionAliasCleared)
  } catch (error) {
    await refreshProjectData()
    showToast(fmt(STRINGS.sessionRenameFailed, { error: error.message }), 'err')
  }
}

async function deleteSessionPermanently(session) {
  if (activeSessionIds.has(session.id)) {
    showToast(STRINGS.sessionCannotDeleteActive, 'err')
    return
  }
  const confirmed = window.confirm(
    fmt(STRINGS.sessionDeleteConfirm, { name: session.alias || session.name })
  )
  if (!confirmed) return
  try {
    await requestJson('/api/sessions/' + selectedProject.id + '/' + session.id, {
      method: 'DELETE',
    })
    await refreshProjectData()
    showToast(STRINGS.sessionDeleted)
  } catch (error) {
    showToast(fmt(STRINGS.sessionDeleteFailed, { error: error.message }), 'err')
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
    if (shouldArchive) showToast(STRINGS.sessionArchivedNote)
  } catch (error) {
    showToast(fmt(STRINGS.sessionArchiveFailed, { error: error.message }), 'err')
  }
}

/** Starts inline rename mode for a session row. */
function beginSessionRename(session) {
  renamingSessionId = session.id
  renderSessions()
}

/** Copies the full session ID to the clipboard. */
function copySessionId(session) {
  copyTextToClipboard(session.id, fmt(STRINGS.sessionCopiedId, { prefix: session.id.slice(0, 8) }))
}

/** Builds a Markdown handoff packet on the server and copies it to the clipboard. */
async function copySessionHandoff(session) {
  if (!selectedProject) return
  try {
    showToast(STRINGS.sessionHandoffBuilding)
    const result = await requestJson(
      '/api/sessions/' + selectedProject.id + '/' + session.id + '/handoff'
    )
    copyTextToClipboard(result.markdown, STRINGS.sessionHandoffCopied)
  } catch (error) {
    showToast(fmt(STRINGS.sessionHandoffFailed, { error: error.message }), 'err')
  }
}

/** Executes a named session action from buttons, menus, or keyboard shortcuts. */
function executeSessionAction(action, session) {
  if (!session) return
  if (action === 'session-resume') {
    selectSession(session)
    if (shouldConfirmResume()) openResumeDialog(session)
    else void resumeSelectedSession()
  } else if (action === 'session-rename') {
    beginSessionRename(session)
  } else if (action === 'session-archive') {
    void toggleSessionArchivedState(session)
  } else if (action === 'session-delete') {
    void deleteSessionPermanently(session)
  } else if (action === 'session-copy-id') {
    copySessionId(session)
  } else if (action === 'session-handoff') {
    void copySessionHandoff(session)
  } else if (action === 'session-tag') {
    openTagPicker(session, selectedProject)
  } else if (action === 'session-add-stack') {
    openStackPicker(selectedProject, session)
  }
}

/** Returns the menu/action labels for a session in a single canonical order. */
function sessionActionItems(session) {
  return [
    {
      action: 'session-resume',
      disabled: !session.signals.pathExists,
      label: STRINGS.sessionActionResume,
    },
    { action: 'session-handoff', label: STRINGS.sessionActionHandoff },
    { type: 'separator' },
    { action: 'session-rename', label: STRINGS.sessionActionRename },
    { action: 'session-tag', label: STRINGS.sessionActionTag },
    { action: 'session-add-stack', label: STRINGS.sessionActionAddToStack },
    {
      action: 'session-archive',
      label: session.signals.archived
        ? STRINGS.sessionActionUnarchive
        : STRINGS.sessionActionArchive,
    },
    { type: 'separator' },
    { action: 'session-copy-id', label: STRINGS.sessionActionCopyId },
    { action: 'session-delete', label: STRINGS.sessionActionDelete, danger: true },
  ]
}

// Event delegation keeps handlers valid when renderSessions replaces rows.
elements.sessionList.addEventListener('click', function (event) {
  // Tag chip click — set tag focus filter
  const tagChip = event.target.closest('.s-tag')
  if (tagChip) {
    event.stopPropagation()
    var tag = tagChip.dataset.tag
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

  const menuBtn = event.target.closest('.s-menu-btn')
  if (menuBtn) {
    event.stopPropagation()
    const session = resolveSessionFromRow(menuBtn.closest('.sess-row'))
    if (!session) return
    ctxSession = session
    ctxProject = null
    openContextMenu(menuBtn, sessionActionItems(session))
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
