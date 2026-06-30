// ---------------------------------------------------------------------------
// Touched-file cross-session overlap
//
// The session inspector already lists the files a session edited. Here we make
// each file that *other* sessions also edited clickable: it expands inline to
// show those sessions, each a shortcut to jump there. The per-file session
// counts come from one cached /api/touched/files scan (reused across inspector
// opens); the expansion itself loads on demand. This stays separate from the
// metadata search and deep-search paths.
// ---------------------------------------------------------------------------

// path-identity → number of sessions that edited it. null until first load.
let touchedFileCounts = null
let touchedCountsLoading = false

// The file currently expanded inline: { projectId, sessionId, pathKey, state, sessions }.
let touchedExpand = null

function touchedIdentityKey(path) {
  return String(path)
    .replace(/[\\/]+/g, '/')
    .toLowerCase()
}

/** Lazily loads the path→session-count map, then re-renders the open inspector. */
function ensureTouchedFileCounts() {
  if (touchedFileCounts || touchedCountsLoading) return
  touchedCountsLoading = true
  requestJson('/api/touched/files')
    .then(function (data) {
      const map = {}
      const files = (data && data.files) || []
      for (let i = 0; i < files.length; i++) {
        map[touchedIdentityKey(files[i].path)] = files[i].sessionCount
      }
      touchedFileCounts = map
    })
    .catch(function () {
      touchedFileCounts = {}
    })
    .finally(function () {
      touchedCountsLoading = false
      if (selectedProject && selectedSession) renderInspector(deriveVisibleSessions())
    })
}

/** Number of sessions that edited the file (0 when unknown / not yet loaded). */
function touchedSessionCountFor(path) {
  if (!touchedFileCounts) return 0
  return touchedFileCounts[touchedIdentityKey(path)] || 0
}

/** Returns the "files touched" preview section, decorating shared files. */
function buildTouchedFilesHtml(preview, session) {
  if (!preview.touchedFiles || preview.touchedFiles.length === 0) return ''
  ensureTouchedFileCounts()

  const rows = preview.touchedFiles.map(function (file) {
    return buildTouchedFileRowHtml(file, session)
  })
  return (
    '<div class="preview-block">' +
    buildPreviewLabelHtml(
      fmt(STRINGS.previewFilesTouched, { count: preview.touchedFiles.length }),
      '✎'
    ) +
    rows.join('') +
    '</div>'
  )
}

function buildTouchedFileRowHtml(file, session) {
  const relative = escapeHtml(projectRelativePath(file, session.projectPath))
  const count = touchedSessionCountFor(file)
  // A file only "links" when *other* sessions edited it too. Files touched by
  // this session alone keep an empty caret slot so every path aligns.
  const shared = count > 1
  const pathKey = touchedIdentityKey(file)
  // Session ids are globally unique UUIDs, so id + path identifies the row
  // (web Session objects carry projectPath, not projectId).
  const expanded =
    shared &&
    touchedExpand &&
    touchedExpand.sessionId === session.id &&
    touchedExpand.pathKey === pathKey

  let cls = 'preview-file touched-row'
  let extra = ''
  let badge = ''
  if (shared) {
    const others = count - 1
    const label =
      others === 1 ? STRINGS.touchedOthersOne : fmt(STRINGS.touchedOthersMany, { n: others })
    cls += ' touched-linked'
    extra =
      ' data-touched-path="' +
      escapeHtml(file) +
      '" data-touched-key="' +
      escapeHtml(pathKey) +
      '" role="button" tabindex="0"'
    badge = '<span class="touched-count">⧉ ' + escapeHtml(label) + '</span>'
  }

  const row =
    '<div class="' +
    cls +
    '" title="' +
    escapeHtml(file) +
    '"' +
    extra +
    '>' +
    '<span class="touched-caret' +
    (shared ? '' : ' touched-caret-empty') +
    '">' +
    (expanded ? '▾' : '▸') +
    '</span>' +
    '<span class="touched-path">' +
    relative +
    '</span>' +
    badge +
    '</div>'
  return expanded ? row + buildTouchedExpandHtml(session) : row
}

function buildTouchedExpandHtml(session) {
  if (!touchedExpand) return ''
  if (touchedExpand.state === 'loading') {
    return (
      '<div class="touched-expand">' +
      matrixSoftLoaderHtml(STRINGS.touchedExpandLoading, true) +
      '</div>'
    )
  }
  if (touchedExpand.state === 'error') {
    return (
      '<div class="touched-expand"><div class="touched-expand-note">' +
      STRINGS.touchedExpandFailed +
      '</div></div>'
    )
  }

  // Hide the session you're already looking at — show only the others.
  const others = (touchedExpand.sessions || []).filter(function (match) {
    return match.sessionId !== session.id
  })
  if (others.length === 0) {
    return (
      '<div class="touched-expand"><div class="touched-expand-note">' +
      STRINGS.touchedExpandEmpty +
      '</div></div>'
    )
  }
  return '<div class="touched-expand">' + others.map(buildTouchedOtherHtml).join('') + '</div>'
}

function buildTouchedOtherHtml(match) {
  const dot = match.active ? '<span class="touched-other-active">●</span> ' : ''
  const meta = [match.projectName, match.gitBranch || '', relativeTime(match.lastTouchedAt)]
    .filter(Boolean)
    .join(' · ')
  return (
    '<div class="touched-other" data-project-id="' +
    escapeHtml(match.projectId) +
    '" data-session-id="' +
    escapeHtml(match.sessionId) +
    '" role="button" tabindex="0">' +
    dot +
    escapeHtml(match.sessionName) +
    ' · ' +
    escapeHtml(meta) +
    '</div>'
  )
}

/** Toggles the inline expansion for a touched file, loading its sessions once. */
function toggleTouchedExpansion(path, pathKey) {
  if (!selectedProject || !selectedSession) return
  const alreadyOpen =
    touchedExpand &&
    touchedExpand.sessionId === selectedSession.id &&
    touchedExpand.pathKey === pathKey
  if (alreadyOpen) {
    touchedExpand = null
    renderInspector(deriveVisibleSessions())
    return
  }

  const request = {
    projectId: selectedProject.id,
    sessionId: selectedSession.id,
    pathKey: pathKey,
    state: 'loading',
    sessions: [],
  }
  touchedExpand = request
  renderInspector(deriveVisibleSessions())

  requestJson('/api/touched/sessions?path=' + encodeURIComponent(path))
    .then(function (data) {
      if (touchedExpand !== request) return // a newer interaction superseded this one
      touchedExpand = Object.assign({}, request, {
        state: 'ready',
        sessions: (data && data.matches) || [],
      })
      renderInspector(deriveVisibleSessions())
    })
    .catch(function () {
      if (touchedExpand !== request) return
      touchedExpand = Object.assign({}, request, { state: 'error' })
      renderInspector(deriveVisibleSessions())
    })
}

function jumpToTouchedSession(projectId, sessionId) {
  const project = projects.find(function (candidate) {
    return candidate.id === projectId
  })
  const session =
    project &&
    project.sessions.find(function (candidate) {
      return candidate.id === sessionId
    })
  if (!project || !session) return
  selectProject(project)
  selectSession(session)
}

elements.sessionInspector.addEventListener('click', function (event) {
  const other = event.target.closest('.touched-other')
  if (other) {
    jumpToTouchedSession(other.dataset.projectId, other.dataset.sessionId)
    return
  }
  const file = event.target.closest('.touched-linked')
  if (file) {
    toggleTouchedExpansion(file.dataset.touchedPath, file.dataset.touchedKey)
  }
})
