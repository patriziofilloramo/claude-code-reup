// ---------------------------------------------------------------------------
// Org picker — assign a project to a group, or add a session/project to a stack
// ---------------------------------------------------------------------------

var orgPickerMode = null // 'group' | 'stack'
var orgPickerTarget = null // { project } or { project, session }
var orgPickerCreating = false

function openGroupPicker(project) {
  orgPickerMode = 'group'
  orgPickerTarget = { project: project }
  elements.orgPickerTitle.textContent = STRINGS.orgPickerGroupTitle
  renderOrgPickerList()
  elements.orgPickerOverlay.classList.add('open')
}

function openStackPicker(project, session) {
  orgPickerMode = 'stack'
  orgPickerTarget = { project: project, session: session || null }
  elements.orgPickerTitle.textContent = STRINGS.orgPickerStackTitle
  renderOrgPickerList()
  elements.orgPickerOverlay.classList.add('open')
}

function closeOrgPicker() {
  elements.orgPickerOverlay.classList.remove('open')
  orgPickerMode = null
  orgPickerTarget = null
  orgPickerCreating = false
}

function renderOrgPickerList() {
  if (!orgData) {
    elements.orgPickerList.innerHTML =
      '<div class="org-picker-empty">' + STRINGS.orgPickerNoItems + '</div>'
    return
  }

  var items = orgPickerMode === 'group' ? orgData.groups : orgData.stacks
  if (!items) items = []

  var currentGroupId =
    orgPickerMode === 'group' && orgPickerTarget && orgPickerTarget.project
      ? (orgData.projectGroupAssignments || {})[orgPickerTarget.project.id]
      : null

  var html = ''
  if (items.length === 0) {
    html += '<div class="org-picker-empty">' + STRINGS.orgPickerNoItems + '</div>'
  }

  if (orgPickerMode === 'group' && currentGroupId) {
    html +=
      '<div class="org-picker-item org-picker-remove" data-item-id="">' +
      escapeHtml(STRINGS.orgPickerRemoveGroup) +
      '</div>'
  }
  for (var i = 0; i < items.length; i++) {
    var item = items[i]
    var isCurrent = orgPickerMode === 'group' && item.id === currentGroupId
    html +=
      '<div class="org-picker-item' +
      (isCurrent ? ' active' : '') +
      '" data-item-id="' +
      escapeHtml(item.id) +
      '">' +
      escapeHtml(item.name) +
      (isCurrent ? ' ✓' : '') +
      '</div>'
  }

  if (orgPickerCreating) {
    var placeholder =
      orgPickerMode === 'group'
        ? STRINGS.orgPickerCreateGroupPlaceholder
        : STRINGS.orgPickerCreateStackPlaceholder
    html +=
      '<div class="org-picker-create">' +
      '<input class="org-picker-create-input" placeholder="' +
      escapeHtml(placeholder) +
      '" />' +
      '<div class="org-picker-create-hint">' +
      escapeHtml(STRINGS.orgPickerCreateHint) +
      '</div>' +
      '</div>'
  } else {
    var createLabel =
      orgPickerMode === 'group' ? STRINGS.orgPickerNewGroup : STRINGS.orgPickerNewStack
    html +=
      '<div class="org-picker-item org-picker-create-trigger" data-picker-action="create">' +
      escapeHtml(createLabel) +
      '</div>'
  }

  elements.orgPickerList.innerHTML = html
  if (orgPickerCreating) {
    var input = elements.orgPickerList.querySelector('.org-picker-create-input')
    if (input) input.focus()
  }
}

async function applyOrgPickerSelection(itemId) {
  if (!orgPickerTarget) return
  var mode = orgPickerMode
  var target = orgPickerTarget
  closeOrgPicker()

  try {
    if (mode === 'group') {
      await requestJson('/api/projects/' + encodeURIComponent(target.project.id) + '/group', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId: itemId }),
      })
    } else {
      var body = target.session
        ? { kind: 'session', projectId: target.project.id, sessionId: target.session.id }
        : { kind: 'project', projectId: target.project.id }
      await requestJson('/api/org/stacks/' + encodeURIComponent(itemId) + '/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    }
    void refreshProjectData()
  } catch (error) {
    var key = mode === 'group' ? 'orgPickerGroupFailed' : 'orgPickerStackFailed'
    showToast(fmt(STRINGS[key], { error: error.message || String(error) }), 'err')
  }
}

async function createAndApplyOrgPickerItem(name) {
  if (!orgPickerTarget || !orgPickerMode) return
  var mode = orgPickerMode
  var endpoint = mode === 'group' ? '/api/org/groups' : '/api/org/stacks'

  try {
    var created = await requestJson(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name }),
    })
    var item = mode === 'group' ? created.group : created.stack
    if (!item || !item.id) throw new Error('missing created item id')
    await applyOrgPickerSelection(item.id)
  } catch (error) {
    showToast(fmt(STRINGS.orgPickerCreateFailed, { error: error.message || String(error) }), 'err')
  }
}

async function removeProjectFromGroup(project) {
  try {
    await requestJson('/api/projects/' + encodeURIComponent(project.id) + '/group', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId: null }),
    })
    void refreshProjectData()
  } catch (error) {
    showToast(fmt(STRINGS.orgPickerGroupFailed, { error: error.message || String(error) }), 'err')
  }
}

// ---- Event wiring ----

elements.orgPickerList.addEventListener('click', function (event) {
  var item = event.target.closest('.org-picker-item')
  if (!item) return

  if (item.dataset.pickerAction === 'create') {
    orgPickerCreating = true
    renderOrgPickerList()
    return
  }

  if (item.classList.contains('org-picker-remove')) {
    if (orgPickerTarget && orgPickerTarget.project) {
      var proj = orgPickerTarget.project
      closeOrgPicker()
      void removeProjectFromGroup(proj)
    }
    return
  }

  var itemId = item.dataset.itemId
  if (itemId) void applyOrgPickerSelection(itemId)
})

elements.orgPickerList.addEventListener('keydown', function (event) {
  var input = event.target.closest('.org-picker-create-input')
  if (!input) return

  if (event.key === 'Enter') {
    event.preventDefault()
    var name = input.value.trim()
    if (name) void createAndApplyOrgPickerItem(name)
  } else if (event.key === 'Escape') {
    event.preventDefault()
    orgPickerCreating = false
    renderOrgPickerList()
  }
})

elements.orgPickerOverlay.addEventListener('click', function (event) {
  if (event.target === elements.orgPickerOverlay) closeOrgPicker()
})

elements.orgPickerClose.addEventListener('click', closeOrgPicker)

document.addEventListener('keydown', function (event) {
  if (elements.orgPickerOverlay.classList.contains('open') && event.key === 'Escape') {
    event.preventDefault()
    closeOrgPicker()
  }
})
