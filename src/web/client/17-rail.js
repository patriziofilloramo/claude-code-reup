// ---------------------------------------------------------------------------
// Left rail: Review, Stacks, Groups + Focus bar
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Focus filter — session scope resolver
// Called by 05-projects.js and 06-sessions.js (hoisted function declaration).
//
// Returns:
//   undefined  — project is NOT in the current focus (exclude from list)
//   null       — project IS in focus, no session-level restriction
//   Session[]  — project IS in focus, show only these sessions
// ---------------------------------------------------------------------------

function getSessionsMatchingFocus(project) {
  if (!focusFilter) return null

  if (focusFilter.kind === 'inbox') {
    var bucket = null
    for (var bi = 0; bi < REVIEW_BUCKETS.length; bi++) {
      if (REVIEW_BUCKETS[bi].id === focusFilter.bucket) {
        bucket = REVIEW_BUCKETS[bi]
        break
      }
    }
    if (!bucket) return undefined
    return project.sessions.filter(function (s) {
      return !s.signals.archived && bucket.test(s)
    })
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
// Review bucket count (non-archived sessions matching a bucket)
// ---------------------------------------------------------------------------

function countBucketSessions(bucket) {
  var count = 0
  for (var pi = 0; pi < projects.length; pi++) {
    var proj = projects[pi]
    for (var si = 0; si < proj.sessions.length; si++) {
      var sess = proj.sessions[si]
      if (!sess.signals.archived && bucket.test(sess)) count++
    }
  }
  return count
}

// ---------------------------------------------------------------------------
// Stack session count (unique non-archived sessions referenced by stack items)
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

// ---------------------------------------------------------------------------
// Rail HTML builders
// ---------------------------------------------------------------------------

function buildRailInfoHtml(tooltip) {
  if (!tooltip) return ''
  return (
    '<span class="rail-info" data-tooltip="' +
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

function buildReviewSectionHtml() {
  var rows = ''
  for (var bi = 0; bi < REVIEW_BUCKETS.length; bi++) {
    var bucket = REVIEW_BUCKETS[bi]
    var count = countBucketSessions(bucket)
    if (count === 0) continue
    var isActive = focusFilter && focusFilter.kind === 'inbox' && focusFilter.bucket === bucket.id
    rows +=
      '<div class="rail-item ' +
      bucket.cssClass +
      (isActive ? ' active' : '') +
      '" data-rail-action="inbox-bucket" data-bucket="' +
      bucket.id +
      '">' +
      '<span class="rail-item-icon">' +
      bucket.icon +
      '</span>' +
      '<span class="rail-item-label">' +
      escapeHtml(STRINGS[bucket.labelKey] || bucket.labelKey) +
      '</span>' +
      '<span class="rail-item-cnt">' +
      count +
      '</span>' +
      '</div>'
  }
  var body = rows || '<div class="rail-empty">' + STRINGS.railReviewEmpty + '</div>'
  return buildRailSectionHtml(
    'inbox',
    STRINGS.railReview,
    '',
    body,
    null,
    STRINGS.railReviewTooltip
  )
}

function buildStacksSectionHtml() {
  var stacks = (orgData && orgData.stacks) || []
  if (stacks.length === 0) return ''

  var rows = ''
  for (var i = 0; i < stacks.length; i++) {
    var stack = stacks[i]
    var isActive = focusFilter && focusFilter.kind === 'stack' && focusFilter.id === stack.id
    var count = countStackSessionsForRail(stack)
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
      count +
      '</span>' +
      '</div>'
  }
  return buildRailSectionHtml(
    'stacks',
    STRINGS.railStacks,
    '⬡',
    rows,
    stacks.length,
    STRINGS.railStacksTooltip
  )
}

function buildGroupsSectionHtml() {
  var groups = (orgData && orgData.groups) || []
  if (groups.length === 0) return ''

  var assignments = (orgData && orgData.projectGroupAssignments) || {}
  var rows = ''
  for (var i = 0; i < groups.length; i++) {
    var group = groups[i]
    var isActive = focusFilter && focusFilter.kind === 'group' && focusFilter.id === group.id
    var count = 0
    var keys = Object.keys(assignments)
    for (var k = 0; k < keys.length; k++) {
      if (assignments[keys[k]] === group.id) count++
    }
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
      count +
      '</span>' +
      '</div>'
  }
  return buildRailSectionHtml(
    'groups',
    STRINGS.railGroups,
    '⊞',
    rows,
    groups.length,
    STRINGS.railGroupsTooltip
  )
}

/** Re-renders the org rail. Safe to call at any time. */
function renderRail() {
  if (!elements.rail) return
  elements.rail.innerHTML =
    buildReviewSectionHtml() + buildStacksSectionHtml() + buildGroupsSectionHtml()
}

// ---------------------------------------------------------------------------
// Focus bar
// ---------------------------------------------------------------------------

/** Re-renders the focus bar above the project list. Hides it when no focus is active. */
function renderFocusBar() {
  if (!focusFilter) {
    elements.focusBar.style.display = 'none'
    return
  }
  var name = ''
  if (focusFilter.kind === 'inbox') {
    for (var bi = 0; bi < REVIEW_BUCKETS.length; bi++) {
      if (REVIEW_BUCKETS[bi].id === focusFilter.bucket) {
        name = STRINGS[REVIEW_BUCKETS[bi].labelKey] || focusFilter.bucket
        break
      }
    }
  } else if (focusFilter.kind === 'stack' || focusFilter.kind === 'group') {
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

// ---------------------------------------------------------------------------
// Rail event handlers
// ---------------------------------------------------------------------------

if (elements.rail) {
  elements.rail.addEventListener('click', function (event) {
    // Section collapse toggle
    var toggleTarget = event.target.closest('[data-rail-toggle]')
    if (toggleTarget) {
      if (event.target.closest('.rail-info')) return
      toggleRailSectionCollapsed(toggleTarget.dataset.railToggle)
      renderRail()
      return
    }

    // Rail item — set or clear focus filter
    var item = event.target.closest('.rail-item')
    if (item) {
      var action = item.dataset.railAction

      if (action === 'inbox-bucket') {
        var bucket = item.dataset.bucket
        var wasActive = focusFilter && focusFilter.kind === 'inbox' && focusFilter.bucket === bucket
        focusFilter = wasActive ? null : { kind: 'inbox', bucket: bucket }
      } else if (action === 'stack') {
        var stackId = item.dataset.stackId
        var stackName = item.dataset.stackName
        var wasActiveStack =
          focusFilter && focusFilter.kind === 'stack' && focusFilter.id === stackId
        focusFilter = wasActiveStack ? null : { kind: 'stack', id: stackId, name: stackName }
      } else if (action === 'group') {
        var groupId = item.dataset.groupId
        var groupName = item.dataset.groupName
        var wasActiveGroup =
          focusFilter && focusFilter.kind === 'group' && focusFilter.id === groupId
        focusFilter = wasActiveGroup ? null : { kind: 'group', id: groupId, name: groupName }
      }

      renderRail()
      renderFocusBar()
      renderProjects()
      renderSessions()
      return
    }
  })

  // Right-click on stack or group items — open delete / manage menu
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
