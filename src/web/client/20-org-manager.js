// ---------------------------------------------------------------------------
// Org item manager — view and remove members from stacks and groups
// ---------------------------------------------------------------------------

var orgManagerKind = null // 'stack' | 'group'
var orgManagerId = null

function openOrgManager(kind, id, name) {
  if (!elements.orgManagerOverlay) return
  orgManagerKind = kind
  orgManagerId = id
  elements.orgManagerTitle.textContent = (kind === 'stack' ? 'Stack: ' : 'Group: ') + name
  renderOrgManagerList()
  elements.orgManagerOverlay.classList.add('open')
}

function closeOrgManager() {
  if (!elements.orgManagerOverlay) return
  elements.orgManagerOverlay.classList.remove('open')
  orgManagerKind = null
  orgManagerId = null
}

function renderOrgManagerList() {
  if (!elements.orgManagerList) return
  var html = ''

  if (orgManagerKind === 'stack') {
    var stack = null
    if (orgData && orgData.stacks) {
      for (var si = 0; si < orgData.stacks.length; si++) {
        if (orgData.stacks[si].id === orgManagerId) {
          stack = orgData.stacks[si]
          break
        }
      }
    }
    if (!stack || stack.items.length === 0) {
      elements.orgManagerList.innerHTML =
        '<div class="org-manager-empty">' + escapeHtml(STRINGS.railManagerEmpty) + '</div>'
      return
    }
    for (var ii = 0; ii < stack.items.length; ii++) {
      var stackItem = stack.items[ii]
      var proj = null
      for (var pi = 0; pi < projects.length; pi++) {
        if (projects[pi].id === stackItem.projectId) {
          proj = projects[pi]
          break
        }
      }
      var projName = proj ? compactPath(proj.path) : stackItem.projectId
      if (stackItem.kind === 'project') {
        html +=
          '<div class="org-manager-item">' +
          '<span class="org-manager-icon">📁</span>' +
          '<span class="org-manager-label">' +
          escapeHtml(projName) +
          '</span>' +
          '<button class="org-manager-remove" data-item-ref="' +
          escapeHtml(stackItem.projectId) +
          '" title="Remove">' +
          escapeHtml(STRINGS.railManagerRemove) +
          '</button>' +
          '</div>'
      } else if (stackItem.kind === 'session' && stackItem.sessionId) {
        var sess = null
        if (proj) {
          for (var xs = 0; xs < proj.sessions.length; xs++) {
            if (proj.sessions[xs].id === stackItem.sessionId) {
              sess = proj.sessions[xs]
              break
            }
          }
        }
        var sessName = sess ? sess.alias || sess.name : stackItem.sessionId.slice(0, 8) + '…'
        var sessionRef = stackItem.projectId + ':' + stackItem.sessionId
        html +=
          '<div class="org-manager-item org-manager-item-session">' +
          '<span class="org-manager-icon org-manager-indent">↳</span>' +
          '<span class="org-manager-sub">' +
          escapeHtml(projName) +
          ' / </span>' +
          '<span class="org-manager-label">' +
          escapeHtml(sessName) +
          '</span>' +
          '<button class="org-manager-remove" data-item-ref="' +
          escapeHtml(sessionRef) +
          '" title="Remove">' +
          escapeHtml(STRINGS.railManagerRemove) +
          '</button>' +
          '</div>'
      }
    }
  } else if (orgManagerKind === 'group') {
    var assignments = (orgData && orgData.projectGroupAssignments) || {}
    var assigned = []
    for (var gi = 0; gi < projects.length; gi++) {
      if (assignments[projects[gi].id] === orgManagerId) assigned.push(projects[gi])
    }
    if (assigned.length === 0) {
      elements.orgManagerList.innerHTML =
        '<div class="org-manager-empty">' + escapeHtml(STRINGS.railManagerEmpty) + '</div>'
      return
    }
    for (var ai = 0; ai < assigned.length; ai++) {
      var assignedProj = assigned[ai]
      html +=
        '<div class="org-manager-item">' +
        '<span class="org-manager-icon">📁</span>' +
        '<span class="org-manager-label">' +
        escapeHtml(compactPath(assignedProj.path)) +
        '</span>' +
        '<button class="org-manager-remove" data-project-id="' +
        escapeHtml(assignedProj.id) +
        '" title="Remove">' +
        escapeHtml(STRINGS.railManagerRemove) +
        '</button>' +
        '</div>'
    }
  }

  elements.orgManagerList.innerHTML =
    html || '<div class="org-manager-empty">' + escapeHtml(STRINGS.railManagerEmpty) + '</div>'
}

if (elements.orgManagerList) {
  elements.orgManagerList.addEventListener('click', function (event) {
    var btn = event.target.closest('.org-manager-remove')
    if (!btn) return

    if (orgManagerKind === 'stack') {
      var itemRef = btn.dataset.itemRef
      if (!itemRef || !orgManagerId) return
      requestJson('/api/org/stacks/' + orgManagerId + '/items/' + encodeURIComponent(itemRef), {
        method: 'DELETE',
      })
        .then(function () {
          return refreshProjectData()
        })
        .then(function () {
          renderOrgManagerList()
        })
        .catch(function (error) {
          showToast('Failed to remove item: ' + (error.message || String(error)), 'err')
        })
    } else if (orgManagerKind === 'group') {
      var projectId = btn.dataset.projectId
      if (!projectId) return
      requestJson('/api/projects/' + projectId + '/group', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId: null }),
      })
        .then(function () {
          return refreshProjectData()
        })
        .then(function () {
          renderOrgManagerList()
        })
        .catch(function (error) {
          showToast('Failed to remove from group: ' + (error.message || String(error)), 'err')
        })
    }
  })
}

if (elements.orgManagerClose) {
  elements.orgManagerClose.addEventListener('click', closeOrgManager)
}

if (elements.orgManagerOverlay) {
  elements.orgManagerOverlay.addEventListener('click', function (event) {
    if (event.target === elements.orgManagerOverlay) closeOrgManager()
  })
}
