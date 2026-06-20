// ---------------------------------------------------------------------------
// Cross-device session storage drawer
// ---------------------------------------------------------------------------

function openSyncDrawer() {
  elements.syncDrawer.classList.add('open')
  elements.syncBody.innerHTML = '<div class="lf-loading">' + STRINGS.syncLoading + '</div>'
  void renderSyncPanel()
}

function closeSyncDrawer() {
  elements.syncDrawer.classList.remove('open')
}

async function renderSyncPanel() {
  try {
    syncOverview = await requestJson('/api/sync')
  } catch {
    elements.syncBody.innerHTML = '<div class="lf-loading">' + STRINGS.syncLoadFailed + '</div>'
    return
  }

  elements.syncSubtitle.textContent = syncOverview.enabled
    ? STRINGS.syncEnabled
    : STRINGS.syncDisabled

  elements.syncBody.innerHTML =
    '<div class="sync-warning">' +
    escapeHtml(STRINGS.syncWarning) +
    '</div>' +
    '<div class="sync-actions">' +
    syncButtonHtml(
      'sync-toggle',
      syncOverview.enabled ? STRINGS.syncDisable : STRINGS.syncEnable,
      false
    ) +
    syncButtonHtml('sync-link-all-cloud', STRINGS.syncLinkAllCloud, !syncOverview.enabled) +
    syncButtonHtml('sync-unlink-all', STRINGS.syncUnlinkAll, !syncOverview.enabled) +
    '</div>' +
    '<div class="sync-summary">' +
    '<span>' +
    syncOverview.linkedProjects.length +
    ' linked</span><span>' +
    syncOverview.cloudProjectCandidates.length +
    ' cloud candidates</span><span>' +
    syncOverview.skippedActiveProjects.length +
    ' active disabled</span></div>' +
    renderAdvancedDiscoveryPanel(syncOverview) +
    renderSyncProjectList(syncOverview.projects, syncOverview.enabled)
}

function renderAdvancedDiscoveryPanel(overview) {
  const isOn = overview.advancedDiscovery
  const pathsValue = (overview.projectSearchPaths ?? []).join('\n')
  return (
    '<div class="sync-advanced-discovery">' +
    '<div class="sync-advanced-discovery-header">' +
    '<span class="sync-advanced-discovery-label">' +
    escapeHtml(STRINGS.syncAdvancedDiscoveryLabel) +
    '</span>' +
    '<button class="btn btn-secondary sync-action" data-sync-action="sync-advanced-discovery-toggle">' +
    escapeHtml(isOn ? STRINGS.syncAdvancedDiscoveryOn : STRINGS.syncAdvancedDiscoveryOff) +
    '</button>' +
    '</div>' +
    '<p class="sync-advanced-discovery-desc">' +
    escapeHtml(STRINGS.syncAdvancedDiscoveryDesc) +
    '</p>' +
    (isOn
      ? '<div class="sync-search-paths">' +
        '<label class="sync-search-paths-label">' +
        escapeHtml(STRINGS.syncSearchPathsLabel) +
        '</label>' +
        '<textarea id="sync-search-paths-input" class="sync-search-paths-input" rows="4" placeholder="' +
        escapeHtml(STRINGS.syncSearchPathsPlaceholder) +
        '">' +
        escapeHtml(pathsValue) +
        '</textarea>' +
        '<button class="btn btn-secondary" id="sync-search-paths-save">' +
        escapeHtml(STRINGS.syncSearchPathsSave) +
        '</button>' +
        '</div>'
      : '') +
    '</div>'
  )
}

function syncButtonHtml(action, label, disabled) {
  return (
    '<button class="btn btn-secondary sync-action" data-sync-action="' +
    escapeHtml(action) +
    '"' +
    (disabled ? ' disabled' : '') +
    '>' +
    escapeHtml(label) +
    '</button>'
  )
}

function renderSyncProjectList(items, syncEnabled) {
  if (!items || items.length === 0) {
    return '<div class="lf-empty">' + STRINGS.syncNoProjects + '</div>'
  }

  const sections = [
    { key: 'linked', label: 'Linked', projects: items.filter(function (p) { return p.isShared }) },
    { key: 'local', label: 'Local (unlinked)', projects: items.filter(function (p) { return !p.isShared && !p.isRemoteProject }) },
    { key: 'remote', label: 'Remote (other device)', projects: items.filter(function (p) { return p.isRemoteProject }) },
  ]

  return sections
    .filter(function (s) { return s.projects.length > 0 })
    .map(function (section) {
      return (
        '<div class="sync-section">' +
        '<div class="sync-section-title">' +
        escapeHtml(section.label) +
        ' (' +
        section.projects.length +
        ')</div>' +
        section.projects
          .map(function (project) {
            const isForgettable =
              syncEnabled &&
              !project.isShared &&
              !project.isRemoteProject &&
              project.cloudPath &&
              !project.isActive
            const canLink = syncEnabled && !project.isShared && !project.isActive
            const canUnlink = syncEnabled && project.isShared && !project.isActive

            return (
              '<div class="sync-project' + (project.isActive ? ' sync-project--active' : '') + '">' +
              '<span class="sync-project-path" title="' + escapeHtml(project.path) + '">' +
              escapeHtml(project.path) +
              '</span>' +
              (project.isActive
                ? '<span class="sync-project-badge sync-project-badge--active">active</span>'
                : '') +
              '<span class="sync-project-actions">' +
              (canLink
                ? '<button class="btn btn-secondary sync-row-action" data-sync-row-action="link" data-sync-row-path="' +
                  escapeHtml(project.path) +
                  '">' +
                  escapeHtml(STRINGS.syncLink) +
                  '</button>'
                : '') +
              (canUnlink
                ? '<button class="btn btn-secondary sync-row-action" data-sync-row-action="unlink" data-sync-row-path="' +
                  escapeHtml(project.path) +
                  '">' +
                  escapeHtml(STRINGS.syncUnlink) +
                  '</button>'
                : '') +
              (isForgettable
                ? '<button class="btn btn-secondary sync-row-action sync-row-action--danger" data-sync-row-action="forget" data-sync-row-path="' +
                  escapeHtml(project.path) +
                  '">' +
                  escapeHtml(STRINGS.syncForget) +
                  '</button>'
                : '') +
              '</span>' +
              '</div>'
            )
          })
          .join('') +
        '</div>'
      )
    })
    .join('')
}

async function runSyncDrawerAction(action) {
  try {
    if (action === 'sync-toggle') {
      await requestJson('/api/sync/feature', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !syncOverview.enabled }),
      })
    } else if (action === 'sync-link-all-cloud') {
      if (!window.confirm(STRINGS.syncConfirmBulk)) return
      const result = await requestJson('/api/sync/link-all-cloud', { method: 'POST' })
      showToast(result.message || STRINGS.syncOperationDone)
    } else if (action === 'sync-unlink-all') {
      if (!window.confirm(STRINGS.syncConfirmBulk)) return
      const result = await requestJson('/api/sync/unlink-all', { method: 'POST' })
      showToast(result.message || STRINGS.syncOperationDone)
    } else if (action === 'sync-advanced-discovery-toggle') {
      await requestJson('/api/sync/advanced-discovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !syncOverview.advancedDiscovery }),
      })
      await renderSyncPanel()
      return
    }

    await renderSyncPanel()
    await refreshProjectData()
    showToast(STRINGS.syncOperationDone)
  } catch (error) {
    showToast(fmt(STRINGS.syncOperationFailed, { error: error.message }), 'err')
  }
}

async function runSyncRowAction(action, path) {
  try {
    if (action === 'link') {
      if (!window.confirm(STRINGS.syncConfirmManaged)) return
      await requestJson('/api/sync/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      })
    } else if (action === 'unlink') {
      await requestJson('/api/sync/unlink', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      })
    } else if (action === 'forget') {
      if (!window.confirm(STRINGS.syncForgetConfirm)) return
      await requestJson('/api/sync/forget', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      })
    }
    await renderSyncPanel()
    await refreshProjectData()
    showToast(STRINGS.syncOperationDone)
  } catch (error) {
    showToast(fmt(STRINGS.syncOperationFailed, { error: error.message }), 'err')
  }
}

elements.syncButton.addEventListener('click', openSyncDrawer)
elements.syncCloseButton.addEventListener('click', closeSyncDrawer)
elements.syncDrawer.addEventListener('click', function (event) {
  if (event.target === elements.syncDrawer) closeSyncDrawer()
})
elements.syncBody.addEventListener('click', function (event) {
  const button = event.target.closest('[data-sync-action]')
  if (button && !button.disabled) {
    void runSyncDrawerAction(button.dataset.syncAction)
    return
  }

  const rowButton = event.target.closest('[data-sync-row-action]')
  if (rowButton && !rowButton.disabled) {
    const rowAction = rowButton.dataset.syncRowAction
    const rowPath = rowButton.dataset.syncRowPath
    void runSyncRowAction(rowAction, rowPath)
    return
  }

  if (event.target.id === 'sync-search-paths-save') {
    const textarea = document.getElementById('sync-search-paths-input')
    if (!textarea) return
    const paths = textarea.value
      .split('\n')
      .map((p) => p.trim())
      .filter(Boolean)
    void requestJson('/api/sync/advanced-discovery', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths }),
    })
      .then(() => renderSyncPanel())
      .then(() => showToast(STRINGS.syncSearchPathsSaved))
      .catch((err) => showToast(fmt(STRINGS.syncOperationFailed, { error: err.message }), 'err'))
  }
})
