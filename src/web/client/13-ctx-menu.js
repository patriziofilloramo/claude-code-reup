  // ---------------------------------------------------------------------------
  // Context menu
  // ---------------------------------------------------------------------------

  /**
   * Positions and opens the shared context menu below anchorEl.
   * The menu is positioned left-clamped so it never overflows the viewport edge.
   */
  function openContextMenu(anchorEl, items) {
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
    const rect = anchorEl.getBoundingClientRect()
    const menuWidth = 160
    const left = Math.min(rect.left, window.innerWidth - menuWidth - 8)
    menu.style.top = rect.bottom + 4 + 'px'
    menu.style.left = left + 'px'
    menu.classList.add('open')
  }

  function closeContextMenu() {
    elements.contextMenu.classList.remove('open')
    ctxProject = null
    ctxSession = null
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
      navigator.clipboard.writeText(project.path).then(function () {
        showToast('Path copied')
      })
    } else if (action === 'session-resume' && session) {
      selectSession(session)
      if (shouldConfirmResume()) openResumeDialog(session)
      else void resumeSelectedSession()
    } else if (action === 'session-rename' && session) {
      renamingSessionId = session.id
      renderSessions()
    } else if (action === 'session-archive' && session) {
      void toggleSessionArchivedState(session)
    } else if (action === 'session-copy-id' && session) {
      navigator.clipboard.writeText(session.id).then(function () {
        showToast('ID copied: ' + session.id.slice(0, 8) + '…')
      })
    }
  })

  document.addEventListener('click', function (event) {
    if (
      elements.contextMenu.classList.contains('open') &&
      !elements.contextMenu.contains(event.target)
    ) {
      closeContextMenu()
    }
  })

