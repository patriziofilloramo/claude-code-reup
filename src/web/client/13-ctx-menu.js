// ---------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------

/**
 * Positions and opens the shared context menu below anchorEl.
 * Used by the explicit row menu buttons.
 */
function openContextMenu(anchorEl, items) {
  const rect = anchorEl.getBoundingClientRect()
  openContextMenuAt(rect.left, rect.bottom + 4, items)
}

/** Opens the shared context menu at a viewport coordinate, clamped to screen edges. */
function openContextMenuAt(x, y, items) {
  const menu = elements.contextMenu
  menu.innerHTML = items
    .map(function (item) {
      return (
        '<div class="ctx-item" data-action="' +
        escapeHtml(item.action) +
        '">' +
        escapeHtml(item.label) +
        '</div>'
      )
    })
    .join('')

  const menuWidth = 180
  const left = Math.max(8, Math.min(x, window.innerWidth - menuWidth - 8))
  menu.style.top = y + 'px'
  menu.style.left = left + 'px'
  menu.classList.add('open')
}

function closeContextMenu() {
  elements.contextMenu.classList.remove('open')
  ctxProject = null
  ctxSession = null
}

/** Opens the session action menu from either a row, empty session-panel space, or the inspector. */
function openSessionContextMenu(event, session) {
  event.preventDefault()
  selectSession(session)
  ctxSession = session
  ctxProject = null
  openContextMenuAt(event.clientX, event.clientY, sessionActionItems(session))
}

/** Opens the project action menu from either a project row or selected project-panel space. */
function openProjectContextMenu(event, project) {
  event.preventDefault()
  ctxProject = project
  ctxSession = null
  openContextMenuAt(event.clientX, event.clientY, [
    { action: 'project-new-session', label: '+ new session' },
    { action: 'project-copy-path', label: 'copy path' },
  ])
}

elements.contextMenu.addEventListener('click', function (event) {
  const item = event.target.closest('.ctx-item')
  if (!item) return

  const action = item.dataset.action
  const project = ctxProject
  const session = ctxSession
  closeContextMenu()

  if (action === 'project-new-session' && project) {
    void startNewSession(project)
  } else if (action === 'project-copy-path' && project) {
    copyTextToClipboard(project.path, 'Path copied')
  } else if (session) {
    executeSessionAction(action, session)
  }
})

elements.sessionList.addEventListener('contextmenu', function (event) {
  const row = event.target.closest('.sess-row')
  if (event.target.closest('.s-rename-input')) return

  const session = row ? resolveSessionFromRow(row) : selectedSession
  if (!session) return

  openSessionContextMenu(event, session)
})

elements.projectList.addEventListener('contextmenu', function (event) {
  const row = event.target.closest('.proj-row')
  const project = row ? resolveProjectFromRow(row) : selectedProject
  if (!project) return

  openProjectContextMenu(event, project)
})

elements.sessionInspector.addEventListener('contextmenu', function (event) {
  if (!selectedSession || event.target.closest('button')) return
  openSessionContextMenu(event, selectedSession)
})

document.addEventListener('click', function (event) {
  if (
    elements.contextMenu.classList.contains('open') &&
    !elements.contextMenu.contains(event.target)
  ) {
    closeContextMenu()
  }
})
