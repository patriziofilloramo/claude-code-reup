// ---------------------------------------------------------------------------
// Tag picker — floating dialog for adding/removing session tags (key: t)
// ---------------------------------------------------------------------------

var tagPickerSession = null // Session currently being tagged
var tagPickerProject = null // Project owning the session
var tagPickerTags = [] // Working copy of tags for the open session

function openTagPicker(session, project) {
  tagPickerSession = session
  tagPickerProject = project
  tagPickerTags = (session.tags || []).slice()
  elements.tagPickerTitle.textContent = STRINGS.tagPickerSessionTitle
  elements.tagPickerInput.placeholder = STRINGS.tagPickerPlaceholder
  renderTagPickerChips()
  renderTagPickerSuggestions('')
  elements.tagPickerOverlay.classList.add('open')
  elements.tagPickerInput.value = ''
  elements.tagPickerInput.focus()
}

function closeTagPicker() {
  if (!elements.tagPickerOverlay.classList.contains('open')) return
  elements.tagPickerOverlay.classList.remove('open')
  tagPickerSession = null
  tagPickerProject = null
  tagPickerTags = []
  elements.tagPickerSuggestions.innerHTML = ''
  elements.tagPickerChips.innerHTML = ''
}

function renderTagPickerChips() {
  var html = ''
  for (var i = 0; i < tagPickerTags.length; i++) {
    html +=
      '<span class="tp-chip">#' +
      escapeHtml(tagPickerTags[i]) +
      '<button class="tp-chip-remove" data-tag="' +
      escapeHtml(tagPickerTags[i]) +
      '">×</button></span>'
  }
  elements.tagPickerChips.innerHTML = html
}

function renderTagPickerSuggestions(query) {
  var palette = (orgData && orgData.tagPalette) || []
  var lq = query.toLowerCase()
  var filtered = palette.filter(function (tag) {
    return tag.indexOf(lq) !== -1 && tagPickerTags.indexOf(tag) === -1
  })
  if (!filtered.length || !query) {
    elements.tagPickerSuggestions.innerHTML = ''
    return
  }
  var html = ''
  for (var i = 0; i < Math.min(filtered.length, 8); i++) {
    html +=
      '<span class="tp-suggestion" data-tag="' +
      escapeHtml(filtered[i]) +
      '">#' +
      escapeHtml(filtered[i]) +
      '</span>'
  }
  elements.tagPickerSuggestions.innerHTML = html
}

async function saveTagPickerTags() {
  if (!tagPickerSession || !tagPickerProject) return
  try {
    await requestJson(
      '/api/projects/' + tagPickerProject.id + '/sessions/' + tagPickerSession.id + '/tags',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: tagPickerTags }),
      }
    )
    await refreshProjectData()
  } catch (error) {
    showToast(fmt(STRINGS.tagPickerSaveFailed, { error: error.message || String(error) }), 'err')
  }
}

function addTagInPicker(rawTag) {
  var tag = rawTag.trim().replace(/^#+/, '')
  if (!tag) return
  if (tagPickerTags.indexOf(tag) === -1) {
    tagPickerTags.push(tag)
    renderTagPickerChips()
    void saveTagPickerTags()
  }
  elements.tagPickerInput.value = ''
  renderTagPickerSuggestions('')
  elements.tagPickerInput.focus()
}

function removeTagInPicker(tag) {
  var idx = tagPickerTags.indexOf(tag)
  if (idx !== -1) {
    tagPickerTags.splice(idx, 1)
    renderTagPickerChips()
    void saveTagPickerTags()
  }
}

// ---- Event wiring ----

elements.tagPickerInput.addEventListener('input', function () {
  renderTagPickerSuggestions(elements.tagPickerInput.value)
})

elements.tagPickerInput.addEventListener('keydown', function (event) {
  if (event.key === 'Enter') {
    event.preventDefault()
    addTagInPicker(elements.tagPickerInput.value)
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    closeTagPicker()
  }
})

elements.tagPickerChips.addEventListener('click', function (event) {
  var removeBtn = event.target.closest('.tp-chip-remove')
  if (removeBtn) {
    removeTagInPicker(removeBtn.dataset.tag)
  }
})

elements.tagPickerSuggestions.addEventListener('click', function (event) {
  var suggestion = event.target.closest('.tp-suggestion')
  if (suggestion) {
    addTagInPicker(suggestion.dataset.tag)
  }
})

elements.tagPickerOverlay.addEventListener('click', function (event) {
  if (event.target === elements.tagPickerOverlay) closeTagPicker()
})

elements.tagPickerClose.addEventListener('click', closeTagPicker)

// t key — opens tag picker for selected session
