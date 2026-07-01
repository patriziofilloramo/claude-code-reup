// ---------------------------------------------------------------------------
// Left rail: Stacks, Groups + Focus bar
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Focus filter - session scope resolver
// Called by 05-projects.js and 06-sessions.js (hoisted function declaration).
//
// Returns:
//   undefined  - project is NOT in the current focus (exclude from list)
//   null       - project IS in focus, no session-level restriction
//   Session[]  - project IS in focus, show only these sessions
// ---------------------------------------------------------------------------

function getSessionsMatchingFocus(project) {
  if (!focusFilter) return null

  if (focusFilter.kind === 'review') {
    var reviewBucket = getReviewBucket(focusFilter.id)
    if (!reviewBucket) return undefined
    var reviewSessions = project.sessions.filter(function (session) {
      var primaryBucket = primaryReviewBucket(session)
      return primaryBucket && primaryBucket.id === reviewBucket.id
    })
    return reviewSessions.length > 0 ? reviewSessions : undefined
  }

  if (focusFilter.kind === 'stack') {
    if (!orgData) return undefined
    var stack = null
    for (var si = 0; si < orgData.stacks.length; si++) {
      if (orgData.stacks[si].id === focusFilter.id) {
        stack = orgData.stacks[si]
        break
      }
    }
    if (!stack) return undefined
    var projectInStack = stack.items.some(function (item) {
      return item.kind === 'project' && item.projectId === project.id
    })
    if (projectInStack) return null
    var stackSessionIds = new Set()
    for (var ii = 0; ii < stack.items.length; ii++) {
      var item = stack.items[ii]
      if (item.kind === 'session' && item.projectId === project.id && item.sessionId) {
        stackSessionIds.add(item.sessionId)
      }
    }
    if (stackSessionIds.size === 0) return undefined
    return project.sessions.filter(function (s) {
      return stackSessionIds.has(s.id)
    })
  }

  if (focusFilter.kind === 'group') {
    if (!orgData) return undefined
    var assignments = orgData.projectGroupAssignments || {}
    if (assignments[project.id] !== focusFilter.id) return undefined
    return null
  }

  if (focusFilter.kind === 'tag') {
    var tag = focusFilter.tag
    if (project.projectTags && project.projectTags.indexOf(tag) !== -1) return null
    return project.sessions.filter(function (s) {
      return s.tags && s.tags.indexOf(tag) !== -1
    })
  }

  return null
}

// ---------------------------------------------------------------------------
// Rail section collapse state
// ---------------------------------------------------------------------------

function isRailSectionCollapsed(sectionId) {
  return localStorage.getItem(RAIL_STORAGE_KEY + sectionId + ':collapsed') === '1'
}

function toggleRailSectionCollapsed(sectionId) {
  var collapsed = isRailSectionCollapsed(sectionId)
  if (collapsed) localStorage.removeItem(RAIL_STORAGE_KEY + sectionId + ':collapsed')
  else localStorage.setItem(RAIL_STORAGE_KEY + sectionId + ':collapsed', '1')
}

// ---------------------------------------------------------------------------
// Rail counts
// ---------------------------------------------------------------------------

function countStackSessionsForRail(stack) {
  var seenKeys = new Set()
  for (var ii = 0; ii < stack.items.length; ii++) {
    var item = stack.items[ii]
    var proj = null
    for (var pi = 0; pi < projects.length; pi++) {
      if (projects[pi].id === item.projectId) {
        proj = projects[pi]
        break
      }
    }
    if (!proj) continue
    if (item.kind === 'project') {
      for (var si = 0; si < proj.sessions.length; si++) {
        var sess = proj.sessions[si]
        if (!sess.signals.archived) seenKeys.add(proj.id + ':' + sess.id)
      }
    } else if (item.kind === 'session' && item.sessionId) {
      var matchSess = null
      for (var ms = 0; ms < proj.sessions.length; ms++) {
        if (proj.sessions[ms].id === item.sessionId) {
          matchSess = proj.sessions[ms]
          break
        }
      }
      if (matchSess && !matchSess.signals.archived) {
        seenKeys.add(proj.id + ':' + item.sessionId)
      }
    }
  }
  return seenKeys.size
}

function countGroupProjectsForRail(groupId) {
  var assignments = (orgData && orgData.projectGroupAssignments) || {}
  var count = 0
  var keys = Object.keys(assignments)
  for (var i = 0; i < keys.length; i++) {
    if (assignments[keys[i]] === groupId) count++
  }
  return count
}

function countReviewBucketSessions(bucket) {
  var count = 0
  for (var pi = 0; pi < projects.length; pi++) {
    for (var si = 0; si < projects[pi].sessions.length; si++) {
      var session = projects[pi].sessions[si]
      var primaryBucket = primaryReviewBucket(session)
      if (primaryBucket && primaryBucket.id === bucket.id) count++
    }
  }
  return count
}

function buildProjectOrgChipsHtml(project) {
  // Project-level organization is available in the rail/Inspector. In this
  // dense project list, repeated operational metadata (cloud, last access,
  // session count) gets the fixed columns; decorative chips must not steal path
  // width or shift those columns.
  void project
  return ''
}

function reconcileFocusFilterAfterOrgChange() {
  if (!focusFilter || !orgData) return

  if (focusFilter.kind === 'stack') {
    var stack = null
    for (var si = 0; si < (orgData.stacks || []).length; si++) {
      if (orgData.stacks[si].id === focusFilter.id) {
        stack = orgData.stacks[si]
        break
      }
    }
    if (!stack || countStackSessionsForRail(stack) === 0) focusFilter = null
    return
  }

  if (focusFilter.kind === 'group') {
    var groupExists = false
    for (var gi = 0; gi < (orgData.groups || []).length; gi++) {
      if (orgData.groups[gi].id === focusFilter.id) {
        groupExists = true
        break
      }
    }
    if (!groupExists || countGroupProjectsForRail(focusFilter.id) === 0) focusFilter = null
  }
}

// ---------------------------------------------------------------------------
// Rail HTML builders
// ---------------------------------------------------------------------------

function buildRailInfoHtml(tooltip) {
  if (!tooltip) return ''
  return (
    '<span class="rail-info" tabindex="0" data-tooltip="' +
    escapeHtml(tooltip) +
    '" aria-label="' +
    escapeHtml(tooltip) +
    '">i</span>'
  )
}

function buildRailSectionHtml(sectionId, title, icon, bodyHtml, collapsedCount, tooltip) {
  var collapsed = isRailSectionCollapsed(sectionId)
  var countHtml =
    collapsed && typeof collapsedCount === 'number'
      ? '<span class="rail-section-count">' + collapsedCount + '</span>'
      : ''
  return (
    '<div class="rail-section" data-rail-section="' +
    sectionId +
    '">' +
    '<div class="rail-hdr" data-rail-toggle="' +
    sectionId +
    '">' +
    (icon ? '<span class="rail-icon">' + icon + '</span>' : '') +
    '<span class="rail-title">' +
    escapeHtml(title) +
    '</span>' +
    buildRailInfoHtml(tooltip) +
    countHtml +
    '<span class="rail-toggle">' +
    (collapsed ? '▸' : '▾') +
    '</span>' +
    '</div>' +
    (collapsed ? '' : '<div class="rail-body">' + bodyHtml + '</div>') +
    '</div>'
  )
}

function buildStacksSectionHtml() {
  var stacks = (orgData && orgData.stacks) || []
  var visibleStacks = []

  for (var i = 0; i < stacks.length; i++) {
    var count = countStackSessionsForRail(stacks[i])
    if (count > 0) visibleStacks.push({ count: count, stack: stacks[i] })
  }
  if (visibleStacks.length === 0) return ''

  var rows = ''
  for (var vi = 0; vi < visibleStacks.length; vi++) {
    var stack = visibleStacks[vi].stack
    var isActive = focusFilter && focusFilter.kind === 'stack' && focusFilter.id === stack.id
    rows +=
      '<div class="rail-item' +
      (isActive ? ' active' : '') +
      '" data-rail-action="stack" data-stack-id="' +
      escapeHtml(stack.id) +
      '" data-stack-name="' +
      escapeHtml(stack.name) +
      '">' +
      '<span class="rail-item-label">' +
      escapeHtml(stack.name) +
      '</span>' +
      '<span class="rail-item-cnt">' +
      visibleStacks[vi].count +
      '</span>' +
      '</div>'
  }
  return buildRailSectionHtml(
    'stacks',
    STRINGS.railStacks,
    '⬡',
    rows,
    visibleStacks.length,
    STRINGS.railStacksTooltip
  )
}

function buildInboxSectionHtml() {
  var rows = ''
  var visibleBuckets = 0
  for (var i = 0; i < REVIEW_BUCKETS.length; i++) {
    var bucket = REVIEW_BUCKETS[i]
    var count = countReviewBucketSessions(bucket)
    if (count === 0) continue
    visibleBuckets++
    var label = STRINGS[bucket.labelKey] || bucket.id
    var isActive = focusFilter && focusFilter.kind === 'review' && focusFilter.id === bucket.id
    rows +=
      '<div class="rail-item ' +
      bucket.cssClass +
      (isActive ? ' active' : '') +
      '" data-rail-action="review" data-review-id="' +
      escapeHtml(bucket.id) +
      '" data-review-name="' +
      escapeHtml(label) +
      '">' +
      '<span class="rail-item-icon">' +
      bucket.icon +
      '</span>' +
      '<span class="rail-item-label">' +
      escapeHtml(label) +
      '</span>' +
      '<span class="rail-item-cnt">' +
      count +
      '</span></div>'
  }
  if (!rows) return ''
  return buildRailSectionHtml(
    'inbox',
    STRINGS.railInbox,
    '◇',
    rows,
    visibleBuckets,
    STRINGS.railInboxTooltip
  )
}

function buildGroupsSectionHtml() {
  var groups = (orgData && orgData.groups) || []
  var visibleGroups = []

  for (var i = 0; i < groups.length; i++) {
    var count = countGroupProjectsForRail(groups[i].id)
    if (count > 0) visibleGroups.push({ count: count, group: groups[i] })
  }
  if (visibleGroups.length === 0) return ''

  var rows = ''
  for (var vi = 0; vi < visibleGroups.length; vi++) {
    var group = visibleGroups[vi].group
    var isActive = focusFilter && focusFilter.kind === 'group' && focusFilter.id === group.id
    rows +=
      '<div class="rail-item' +
      (isActive ? ' active' : '') +
      '" data-rail-action="group" data-group-id="' +
      escapeHtml(group.id) +
      '" data-group-name="' +
      escapeHtml(group.name) +
      '">' +
      '<span class="rail-item-label">' +
      escapeHtml(group.name) +
      '</span>' +
      '<span class="rail-item-cnt">' +
      visibleGroups[vi].count +
      '</span>' +
      '</div>'
  }
  return buildRailSectionHtml(
    'groups',
    STRINGS.railGroups,
    '⊞',
    rows,
    visibleGroups.length,
    STRINGS.railGroupsTooltip
  )
}

/** Formats a short, compact age for live activity timestamps (e.g. "3s", "2m ago"). */
function shortRelativeTime(isoTimestamp) {
  if (!isoTimestamp) return ''
  var elapsedMs = Date.now() - new Date(isoTimestamp).getTime()
  if (elapsedMs < 5000) return 'now'
  if (elapsedMs < 60000) return Math.floor(elapsedMs / 1000) + 's'
  return relativeTime(isoTimestamp)
}

/** Builds the live activity strip rows from the current liveActivity snapshot. */
function buildActivitySectionHtml() {
  if (liveActivity.length === 0) return ''
  // Sessions waiting on the user always render, first and in red — that is
  // the strip's whole reason to exist.
  var ordered = liveActivity.slice().sort(function (a, b) {
    return (b.attention ? 1 : 0) - (a.attention ? 1 : 0)
  })
  var rows = ''
  var count = 0
  for (var i = 0; i < ordered.length; i++) {
    var entry = ordered[i]
    if (!entry.projectId || !entry.sessionId) continue
    var state = entry.activityState || 'idle'
    var needsInput = !!entry.attention
    if (state === 'idle' && !needsInput) continue
    var stateClass = needsInput ? 'attention' : state
    var stateLabel = needsInput
      ? STRINGS.activityNeedsInput
      : state === 'running'
        ? STRINGS.activityRunning
        : state === 'waiting'
          ? STRINGS.activityWaiting
          : STRINGS.activityIdle
    var tool = entry.lastToolName
      ? '<span class="activity-tool">' + escapeHtml(entry.lastToolName) + '</span>'
      : ''
    var time = entry.lastEventAt
      ? '<span class="activity-time">' +
        escapeHtml(shortRelativeTime(entry.lastEventAt)) +
        '</span>'
      : ''
    var message =
      needsInput && entry.attention.message
        ? '<span class="activity-msg">' + escapeHtml(entry.attention.message) + '</span>'
        : ''
    rows +=
      '<div class="rail-item rail-live-item' +
      (needsInput ? ' attention' : '') +
      '" data-rail-action="select-session" data-project-id="' +
      escapeHtml(entry.projectId) +
      '" data-session-id="' +
      escapeHtml(entry.sessionId) +
      '">' +
      '<span class="activity-dot ' +
      escapeHtml(stateClass) +
      '"></span>' +
      '<span class="activity-copy">' +
      '<span class="activity-title">' +
      escapeHtml(entry.sessionName || entry.sessionId) +
      '</span>' +
      '<span class="activity-meta">' +
      '<span class="activity-state ' +
      escapeHtml(stateClass) +
      '">' +
      escapeHtml(stateLabel) +
      '</span>' +
      '<span class="activity-project">' +
      escapeHtml(entry.projectName || entry.projectId) +
      '</span>' +
      tool +
      time +
      '</span>' +
      message +
      '</span>' +
      '</div>'
    count++
  }
  if (count === 0) return ''
  return buildRailSectionHtml(
    'activity',
    STRINGS.railActivity,
    '●',
    rows,
    count,
    STRINGS.railActivityTooltip
  )
}

/** Re-renders the org rail. Safe to call at any time. */
function renderRail() {
  if (!elements.rail) return
  var html =
    buildActivitySectionHtml() +
    buildInboxSectionHtml() +
    buildStacksSectionHtml() +
    buildGroupsSectionHtml()
  elements.rail.innerHTML = html
  elements.rail.style.display = html ? '' : 'none'
}

// ---------------------------------------------------------------------------
// Focus bar
// ---------------------------------------------------------------------------

/** Re-renders the focus bar above the project list. Hides it when no focus is active. */
function renderFocusBar() {
  var hasSearch = !!searchQuery.trim()
  if (!focusFilter && !hasSearch) {
    elements.focusBar.style.display = 'none'
    return
  }
  var name = ''
  if (!focusFilter) {
    name = '"' + searchQuery.trim() + '"'
  } else if (
    focusFilter.kind === 'stack' ||
    focusFilter.kind === 'group' ||
    focusFilter.kind === 'review'
  ) {
    name = focusFilter.name
  } else if (focusFilter.kind === 'tag') {
    name = '#' + focusFilter.tag
  }
  var visibleCount = deriveVisibleProjects().length
  var totalCount = projects.length
  elements.focusBarLabel.textContent = fmt(STRINGS.focusBar, { name: name })
  elements.focusBarCount.textContent = fmt(STRINGS.focusBarCount, {
    n: visibleCount,
    total: totalCount,
  })
  elements.focusSaveBtn.textContent = STRINGS.focusSaveAsStack
  elements.focusClearBtn.style.display = focusFilter ? '' : 'none'
  elements.focusBar.style.display = 'flex'
}

function clearFocusFilter() {
  focusFilter = null
  renderRail()
  renderFocusBar()
  renderProjects()
  renderSessions()
}

if (elements.focusClearBtn) {
  elements.focusClearBtn.addEventListener('click', clearFocusFilter)
}

async function saveVisibleSessionsAsStack() {
  var visible = []
  var visibleProjects = deriveVisibleProjects()
  for (var pi = 0; pi < visibleProjects.length; pi++) {
    var project = visibleProjects[pi]
    var sessions = deriveVisibleSessionsForProject(project)
    for (var si = 0; si < sessions.length; si++) {
      visible.push({ projectId: project.id, sessionId: sessions[si].id })
    }
  }
  if (visible.length === 0) {
    showToast(STRINGS.focusSaveEmpty, 'err')
    return
  }
  var suggestedName = focusFilter
    ? focusFilter.kind === 'tag'
      ? focusFilter.tag
      : focusFilter.name
    : searchQuery.trim()
  var name = window.prompt(STRINGS.focusSavePrompt, suggestedName || '')
  if (!name || !name.trim()) return
  try {
    var created = await requestJson('/api/org/stacks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() }),
    })
    var stack = created.stack
    await Promise.all(
      visible.map(function (item) {
        return requestJson('/api/org/stacks/' + encodeURIComponent(stack.id) + '/items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind: 'session',
            projectId: item.projectId,
            sessionId: item.sessionId,
          }),
        })
      })
    )
    await refreshProjectData()
    focusFilter = { kind: 'stack', id: stack.id, name: stack.name }
    synchronizeSelectedProjectWithView()
    renderRail()
    renderFocusBar()
    renderProjects()
    renderSessions()
    showToast(fmt(STRINGS.focusSaveSuccess, { n: visible.length, name: stack.name }))
  } catch (error) {
    showToast(fmt(STRINGS.focusSaveFailed, { error: error.message || String(error) }), 'err')
  }
}

if (elements.focusSaveBtn) {
  elements.focusSaveBtn.addEventListener('click', function () {
    void saveVisibleSessionsAsStack()
  })
}

// ---------------------------------------------------------------------------
// Rail event handlers
// ---------------------------------------------------------------------------

if (elements.rail) {
  elements.rail.addEventListener('click', function (event) {
    var toggleTarget = event.target.closest('[data-rail-toggle]')
    if (toggleTarget) {
      if (event.target.closest('.rail-info')) return
      toggleRailSectionCollapsed(toggleTarget.dataset.railToggle)
      renderRail()
      return
    }

    var item = event.target.closest('.rail-item')
    if (!item) return

    var action = item.dataset.railAction
    if (action === 'select-session') {
      var targetProjectId = item.dataset.projectId
      var targetSessionId = item.dataset.sessionId
      var targetProject = projects.find(function (project) {
        return project.id === targetProjectId
      })
      if (!targetProject) return
      var targetSession = targetProject.sessions.find(function (session) {
        return session.id === targetSessionId
      })
      if (!targetSession) return
      selectProject(targetProject)
      selectSession(targetSession)
      return
    }
    if (action === 'review') {
      var reviewId = item.dataset.reviewId
      var reviewName = item.dataset.reviewName
      var wasActiveReview =
        focusFilter && focusFilter.kind === 'review' && focusFilter.id === reviewId
      focusFilter = wasActiveReview ? null : { kind: 'review', id: reviewId, name: reviewName }
    } else if (action === 'stack') {
      var stackId = item.dataset.stackId
      var stackName = item.dataset.stackName
      var wasActiveStack = focusFilter && focusFilter.kind === 'stack' && focusFilter.id === stackId
      focusFilter = wasActiveStack ? null : { kind: 'stack', id: stackId, name: stackName }
    } else if (action === 'group') {
      var groupId = item.dataset.groupId
      var groupName = item.dataset.groupName
      var wasActiveGroup = focusFilter && focusFilter.kind === 'group' && focusFilter.id === groupId
      focusFilter = wasActiveGroup ? null : { kind: 'group', id: groupId, name: groupName }
    }

    renderRail()
    renderFocusBar()
    renderProjects()
    renderSessions()
  })

  elements.rail.addEventListener('contextmenu', function (event) {
    event.preventDefault()
    var item = event.target.closest('.rail-item')
    if (!item) return

    var action = item.dataset.railAction
    if (action === 'stack') {
      var stackId = item.dataset.stackId
      var stackName = item.dataset.stackName
      if (!stackId) return
      ctxRailItem = { kind: 'stack', id: stackId, name: stackName }
      openContextMenuAt(event.clientX, event.clientY, [
        { type: 'header', label: stackName },
        { action: 'rail-stack-manage', label: STRINGS.railManageStack },
        { type: 'separator' },
        { action: 'rail-stack-delete', label: STRINGS.railDeleteStack, danger: true },
      ])
    } else if (action === 'group') {
      var groupId = item.dataset.groupId
      var groupName = item.dataset.groupName
      if (!groupId) return
      ctxRailItem = { kind: 'group', id: groupId, name: groupName }
      openContextMenuAt(event.clientX, event.clientY, [
        { type: 'header', label: groupName },
        { action: 'rail-group-manage', label: STRINGS.railManageGroup },
        { type: 'separator' },
        { action: 'rail-group-delete', label: STRINGS.railDeleteGroup, danger: true },
      ])
    }
  })
}
