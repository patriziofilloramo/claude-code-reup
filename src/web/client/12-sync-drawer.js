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

  const selectedStatus = selectedProject
    ? syncOverview.projects.find(function (project) {
        return project.id === selectedProject.id
      })
    : null
  const selectedAction =
    selectedStatus && selectedStatus.isShared ? 'sync-unlink-selected' : 'sync-link-selected'
  const selectedLabel =
    selectedStatus && selectedStatus.isShared
      ? STRINGS.syncUnlinkSelected
      : STRINGS.syncLinkSelected
  const selectedDisabled = !syncOverview.enabled || !selectedStatus || selectedStatus.isActive
  const selectedForgettable =
    syncOverview.enabled &&
    selectedStatus &&
    !selectedStatus.isShared &&
    !selectedStatus.isRemoteProject &&
    selectedStatus.cloudPath &&
    !selectedStatus.isActive

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
    syncButtonHtml(selectedAction, selectedLabel, selectedDisabled) +
    syncButtonHtml('sync-forget-selected', STRINGS.syncForgetSelected, !selectedForgettable) +
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
    renderSyncProjectList(syncOverview.projects)
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

function renderSyncProjectList(items) {
  if (!items || items.length === 0) {
    return '<div class="lf-empty">' + STRINGS.syncNoSelectedProject + '</div>'
  }
  return (
    '<div class="sync-project-list">' +
    items
      .map(function (project) {
        const state = project.isShared ? 'linked' : project.isCloudProject ? 'cloud' : 'local'
        const classes =
          'sync-project sync-project--' + state + (project.isActive ? ' sync-project--active' : '')
        return (
          '<div class="' +
          classes +
          '">' +
          '<span class="sync-project-state">' +
          escapeHtml(project.isActive ? 'active' : state) +
          '</span>' +
          '<span class="sync-project-path">' +
          escapeHtml(project.path) +
          '</span>' +
          '</div>'
        )
      })
      .join('') +
    '</div>'
  )
}

async function runSyncDrawerAction(action) {
  try {
    if (action === 'sync-toggle') {
      await requestJson('/api/sync/feature', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !syncOverview.enabled }),
      })
    } else if (action === 'sync-link-selected') {
      if (!selectedProject) {
        showToast(STRINGS.syncNoSelectedProject, 'err')
        return
      }
      if (!window.confirm(STRINGS.syncConfirmManaged)) return
      await requestJson('/api/sync/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: selectedProject.path }),
      })
    } else if (action === 'sync-unlink-selected') {
      if (!selectedProject) {
        showToast(STRINGS.syncNoSelectedProject, 'err')
        return
      }
      await requestJson('/api/sync/unlink', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: selectedProject.path }),
      })
    } else if (action === 'sync-forget-selected') {
      if (!selectedProject) {
        showToast(STRINGS.syncNoSelectedProject, 'err')
        return
      }
      if (!window.confirm(STRINGS.syncForgetConfirm)) return
      await requestJson('/api/sync/forget', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: selectedProject.path }),
      })
    } else if (action === 'sync-link-all-cloud') {
      if (!window.confirm(STRINGS.syncConfirmBulk)) return
      const result = await requestJson('/api/sync/link-all-cloud', { method: 'POST' })
      showToast(result.message || STRINGS.syncOperationDone)
    } else if (action === 'sync-unlink-all') {
      if (!window.confirm(STRINGS.syncConfirmBulk)) return
      const result = await requestJson('/api/sync/unlink-all', { method: 'POST' })
      showToast(result.message || STRINGS.syncOperationDone)
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
  if (!button || button.disabled) return
  void runSyncDrawerAction(button.dataset.syncAction)
})
