// ---------------------------------------------------------------------------
// Tag picker — keyboard-first editor for session or project tags (key: t)
// ---------------------------------------------------------------------------

var tagPickerSession = null
var tagPickerProject = null
var tagPickerTags = []
var tagPickerOriginalTags = []
var tagPickerSuggestionIndex = -1

function openTagPicker(session, project) {
  openTagPickerTarget(project, session)
}

function openProjectTagPicker(project) {
  openTagPickerTarget(project, null)
}

function openTagPickerTarget(project, session) {
  tagPickerSession = session
  tagPickerProject = project
  tagPickerTags = (session ? session.tags : project.projectTags || []).slice()
  tagPickerOriginalTags = tagPickerTags.slice()
  tagPickerSuggestionIndex = -1
  elements.tagPickerTitle.textContent = session
    ? STRINGS.tagPickerSessionTitle
    : STRINGS.tagPickerProjectTitle
  elements.tagPickerInput.placeholder = STRINGS.tagPickerPlaceholder
  elements.tagPickerInput.value = ''
  renderTagPickerChips()
  renderTagPickerSuggestions('')
  elements.tagPickerOverlay.classList.add('open')
  elements.tagPickerInput.focus()
}

function closeTagPicker(commitChanges) {
  if (!elements.tagPickerOverlay.classList.contains('open')) return
  var project = tagPickerProject
  var session = tagPickerSession
  var tags = tagPickerTags.slice()
  var changed = tags.join('\n') !== tagPickerOriginalTags.join('\n')
  elements.tagPickerOverlay.classList.remove('open')
  tagPickerSession = null
  tagPickerProject = null
  tagPickerTags = []
  tagPickerOriginalTags = []
  tagPickerSuggestionIndex = -1
  elements.tagPickerSuggestions.innerHTML = ''
  elements.tagPickerChips.innerHTML = ''
  if (commitChanges && changed && project) {
    void persistTagPickerTags(project, session, tags)
  }
}

function renderTagPickerChips() {
  var html = ''
  for (var i = 0; i < tagPickerTags.length; i++) {
    html +=
      '<span class="tp-chip">#' +
      escapeHtml(tagPickerTags[i]) +
      '<button class="tp-chip-remove" data-tag="' +
      escapeHtml(tagPickerTags[i]) +
      '" aria-label="Remove #' +
      escapeHtml(tagPickerTags[i]) +
      '">×</button></span>'
  }
  elements.tagPickerChips.innerHTML = html
}

function tagPickerSuggestions(query) {
  var palette = (orgData && orgData.tagPalette) || []
  var normalizedQuery = query.trim().toLowerCase()
  return palette
    .filter(function (tag) {
      return (
        tagPickerTags.indexOf(tag) === -1 &&
        (!normalizedQuery || tag.toLowerCase().includes(normalizedQuery))
      )
    })
    .slice(0, 8)
}

function renderTagPickerSuggestions(query) {
  var suggestions = tagPickerSuggestions(query)
  if (tagPickerSuggestionIndex >= suggestions.length) {
    tagPickerSuggestionIndex = suggestions.length - 1
  }
  var html = ''
  for (var i = 0; i < suggestions.length; i++) {
    html +=
      '<button type="button" class="tp-suggestion' +
      (i === tagPickerSuggestionIndex ? ' active' : '') +
      '" data-tag="' +
      escapeHtml(suggestions[i]) +
      '">#' +
      escapeHtml(suggestions[i]) +
      '</button>'
  }
  elements.tagPickerSuggestions.innerHTML = html
}

async function persistTagPickerTags(project, session, tags) {
  var endpoint = session
    ? '/api/projects/' + project.id + '/sessions/' + session.id + '/tags'
    : '/api/projects/' + project.id + '/tags'
  try {
    await requestJson(endpoint, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: tags }),
    })
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
  }
  elements.tagPickerInput.value = ''
  tagPickerSuggestionIndex = -1
  renderTagPickerSuggestions('')
  elements.tagPickerInput.focus()
}

function removeTagInPicker(tag) {
  var index = tagPickerTags.indexOf(tag)
  if (index === -1) return
  tagPickerTags.splice(index, 1)
  renderTagPickerChips()
  renderTagPickerSuggestions(elements.tagPickerInput.value)
}

elements.tagPickerInput.addEventListener('input', function () {
  tagPickerSuggestionIndex = -1
  renderTagPickerSuggestions(elements.tagPickerInput.value)
})

elements.tagPickerInput.addEventListener('keydown', function (event) {
  var suggestions = tagPickerSuggestions(elements.tagPickerInput.value)
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    if (!suggestions.length) return
    var direction = event.key === 'ArrowDown' ? 1 : -1
    tagPickerSuggestionIndex =
      (tagPickerSuggestionIndex + direction + suggestions.length) % suggestions.length
    renderTagPickerSuggestions(elements.tagPickerInput.value)
    return
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    if (tagPickerSuggestionIndex >= 0 && suggestions[tagPickerSuggestionIndex]) {
      addTagInPicker(suggestions[tagPickerSuggestionIndex])
    } else {
      addTagInPicker(elements.tagPickerInput.value)
    }
    return
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    closeTagPicker(false)
  }
})

elements.tagPickerChips.addEventListener('click', function (event) {
  var removeBtn = event.target.closest('.tp-chip-remove')
  if (removeBtn) removeTagInPicker(removeBtn.dataset.tag)
})

elements.tagPickerSuggestions.addEventListener('click', function (event) {
  var suggestion = event.target.closest('.tp-suggestion')
  if (suggestion) addTagInPicker(suggestion.dataset.tag)
})

elements.tagPickerOverlay.addEventListener('click', function (event) {
  if (event.target === elements.tagPickerOverlay) closeTagPicker(true)
})

elements.tagPickerClose.addEventListener('click', function () {
  closeTagPicker(true)
})
