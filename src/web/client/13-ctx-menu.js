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
      if (item.type === 'separator') return '<div class="ctx-item-sep"></div>'
      if (item.type === 'header') {
        return '<div class="ctx-hdr">' + escapeHtml(item.label) + '</div>'
      }
      return (
        '<div class="ctx-item' +
        (item.danger ? ' ctx-item-danger' : '') +
        '" data-action="' +
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
  ctxRailItem = null
}

/** Opens the session action menu for a concrete session row. */
function openSessionContextMenu(event, session) {
  event.preventDefault()
  selectSession(session)
  ctxSession = session
  ctxProject = null
  openContextMenuAt(event.clientX, event.clientY, sessionActionItems(session))
}

/** Opens the project action menu for a concrete project row. */
function openProjectContextMenu(event, project) {
  event.preventDefault()
  ctxProject = project
  ctxSession = null
  var items = [
    { action: 'project-new-session', label: '+ new session' },
    { action: 'project-copy-path', label: 'copy path' },
    { type: 'separator' },
    { action: 'project-tag', label: STRINGS.sessionActionTag },
    { action: 'project-move-group', label: STRINGS.projectCtxMoveToGroup },
    { action: 'project-add-stack', label: STRINGS.projectCtxAddToStack },
  ]
  openContextMenuAt(event.clientX, event.clientY, items)
}

elements.contextMenu.addEventListener('click', function (event) {
  const item = event.target.closest('.ctx-item')
  if (!item) return

  const action = item.dataset.action
  const project = ctxProject
  const session = ctxSession
  const railItem = ctxRailItem
  closeContextMenu()

  if (action === 'project-new-session' && project) {
    void startNewSession(project)
  } else if (action === 'project-copy-path' && project) {
    copyTextToClipboard(project.path, STRINGS.projectPathCopied)
  } else if (action === 'project-tag' && project) {
    openProjectTagPicker(project)
  } else if (action === 'project-move-group' && project) {
    openGroupPicker(project)
  } else if (action === 'project-add-stack' && project) {
    openStackPicker(project, null)
  } else if (action === 'session-add-stack' && session) {
    openStackPicker(project || selectedProject, session)
  } else if (action === 'rail-stack-delete' && railItem && railItem.kind === 'stack') {
    deleteRailStack(railItem.id, railItem.name)
  } else if (action === 'rail-group-delete' && railItem && railItem.kind === 'group') {
    deleteRailGroup(railItem.id, railItem.name)
  } else if (action === 'rail-stack-manage' && railItem && railItem.kind === 'stack') {
    openOrgManager('stack', railItem.id, railItem.name)
  } else if (action === 'rail-group-manage' && railItem && railItem.kind === 'group') {
    openOrgManager('group', railItem.id, railItem.name)
  } else if (session) {
    executeSessionAction(action, session)
  }
})

function deleteRailStack(stackId, stackName) {
  if (!confirm(fmt(STRINGS.railDeleteStackConfirm, { name: stackName }))) return
  requestJson('/api/org/stacks/' + stackId, { method: 'DELETE' })
    .then(function () {
      if (focusFilter && focusFilter.kind === 'stack' && focusFilter.id === stackId) {
        focusFilter = null
        renderFocusBar()
      }
      return refreshProjectData()
    })
    .catch(function (error) {
      showToast('Failed to delete stack: ' + (error.message || String(error)), 'err')
    })
}

function deleteRailGroup(groupId, groupName) {
  if (!confirm(fmt(STRINGS.railDeleteGroupConfirm, { name: groupName }))) return
  requestJson('/api/org/groups/' + groupId, { method: 'DELETE' })
    .then(function () {
      if (focusFilter && focusFilter.kind === 'group' && focusFilter.id === groupId) {
        focusFilter = null
        renderFocusBar()
      }
      return refreshProjectData()
    })
    .catch(function (error) {
      showToast('Failed to delete group: ' + (error.message || String(error)), 'err')
    })
}

elements.sessionList.addEventListener('contextmenu', function (event) {
  const row = event.target.closest('.sess-row')
  if (!row || event.target.closest('.s-rename-input')) return

  const session = resolveSessionFromRow(row)
  if (!session) return

  openSessionContextMenu(event, session)
})

elements.projectList.addEventListener('contextmenu', function (event) {
  const row = event.target.closest('.proj-row')
  if (!row) return

  const project = resolveProjectFromRow(row)
  if (!project) return

  openProjectContextMenu(event, project)
})

document.addEventListener('click', function (event) {
  if (
    elements.contextMenu.classList.contains('open') &&
    !elements.contextMenu.contains(event.target)
  ) {
    closeContextMenu()
  }
})
