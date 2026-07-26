// ---------------------------------------------------------------------------
// Lost & Found panel
// ---------------------------------------------------------------------------

/** Opens the Lost & Found panel and immediately triggers a diagnostic scan. */
function openDiagnosticsDrawer() {
  elements.diagnosticsDrawer.classList.add('open')
  elements.diagnosticsBody.innerHTML =
    '<div class="lf-loading">' + STRINGS.diagnosticsScanning + '</div>'
  void renderDiagnosticsPanel()
}

function closeDiagnosticsDrawer() {
  elements.diagnosticsDrawer.classList.remove('open')
}

/** Fetches and renders the diagnostics report into the Lost & Found panel body. */
async function renderDiagnosticsPanel() {
  let report
  try {
    report = await requestJson('/api/diagnostics')
  } catch {
    elements.diagnosticsBody.innerHTML =
      '<div class="lf-loading">' + STRINGS.diagnosticsLoadFailed + '</div>'
    return
  }

  const sections = []

  if (report.expiring && report.expiring.length > 0) {
    const rows = report.expiring
      .map(function (s) {
        return (
          '<div class="lf-item">' +
          '<div class="lf-item-name">' +
          escapeHtml(s.name || s.id) +
          '</div>' +
          '<div class="lf-item-meta lf-item-warn">' +
          escapeHtml(fmt(STRINGS.diagnosticsExpiresSoon, { path: s.projectPath || '' })) +
          '</div>' +
          '</div>'
        )
      })
      .join('')
    sections.push(
      '<div class="lf-section">' +
        '<div class="lf-section-title">' +
        fmt(STRINGS.diagnosticsSectionExpiring, { n: report.expiring.length }) +
        '</div>' +
        rows +
        '</div>'
    )
  }

  if (report.pathMissing && report.pathMissing.length > 0) {
    const rows = report.pathMissing
      .map(function (s) {
        return (
          '<div class="lf-item">' +
          '<div class="lf-item-name">' +
          escapeHtml(s.name || s.id) +
          '</div>' +
          '<div class="lf-item-meta lf-item-err">' +
          escapeHtml(fmt(STRINGS.diagnosticsPathMissing, { path: s.projectPath || '' })) +
          '</div>' +
          '</div>'
        )
      })
      .join('')
    sections.push(
      '<div class="lf-section">' +
        '<div class="lf-section-title">' +
        fmt(STRINGS.diagnosticsSectionMissingPaths, { n: report.pathMissing.length }) +
        '</div>' +
        rows +
        '</div>'
    )
  }

  if (report.orphanedTranscripts && report.orphanedTranscripts.length > 0) {
    const rows = report.orphanedTranscripts
      .map(function (t) {
        return (
          '<div class="lf-item">' +
          '<div class="lf-item-name lf-item-mono">' +
          escapeHtml(t.sessionId) +
          '</div>' +
          '<div class="lf-item-meta">' +
          escapeHtml(t.projectPath || '') +
          '</div>' +
          '</div>'
        )
      })
      .join('')
    sections.push(
      '<div class="lf-section">' +
        '<div class="lf-section-title">' +
        fmt(STRINGS.diagnosticsSectionOrphaned, { n: report.orphanedTranscripts.length }) +
        '</div>' +
        rows +
        '</div>'
    )
  }

  if (report.brokenIndices && report.brokenIndices.length > 0) {
    const rows = report.brokenIndices
      .map(function (item) {
        return (
          '<div class="lf-item">' +
          '<div class="lf-item-name">' +
          escapeHtml(item.projectId) +
          '</div>' +
          '<div class="lf-item-meta lf-item-err">' +
          escapeHtml(item.reason) +
          '</div>' +
          '</div>'
        )
      })
      .join('')
    sections.push(
      '<div class="lf-section">' +
        '<div class="lf-section-title">' +
        fmt(STRINGS.diagnosticsSectionBrokenIndices, { n: report.brokenIndices.length }) +
        '</div>' +
        rows +
        '</div>'
    )
  }

  if (report.staleLocks && report.staleLocks.length > 0) {
    const rows = report.staleLocks
      .map(function (item) {
        return (
          '<div class="lf-item">' +
          '<div class="lf-item-name">' +
          escapeHtml(item.projectId) +
          '</div>' +
          '<div class="lf-item-meta lf-item-warn">' +
          escapeHtml(item.reason) +
          '</div>' +
          '</div>'
        )
      })
      .join('')
    sections.push(
      '<div class="lf-section">' +
        '<div class="lf-section-title">' +
        fmt(STRINGS.diagnosticsSectionStaleLocks, { n: report.staleLocks.length }) +
        '</div>' +
        rows +
        '</div>'
    )
  }

  if (report.legacyProjectMemoryArtifacts && report.legacyProjectMemoryArtifacts.length > 0) {
    const rows = report.legacyProjectMemoryArtifacts
      .map(function (item) {
        return (
          '<div class="lf-item">' +
          '<div class="lf-item-name">' +
          escapeHtml(item.projectId) +
          '</div>' +
          '<div class="lf-item-meta lf-item-warn">' +
          escapeHtml(item.path) +
          '</div>' +
          '</div>'
        )
      })
      .join('')
    sections.push(
      '<div class="lf-section">' +
        '<div class="lf-section-title">' +
        fmt(STRINGS.diagnosticsSectionLegacyMemory, {
          n: report.legacyProjectMemoryArtifacts.length,
        }) +
        '</div>' +
        '<div class="lf-item-meta lf-item-warn">' +
        STRINGS.diagnosticsLegacyMemoryNote +
        '</div>' +
        rows +
        '</div>'
    )
  }

  const total =
    (report.expiring ? report.expiring.length : 0) +
    (report.pathMissing ? report.pathMissing.length : 0) +
    (report.orphanedTranscripts ? report.orphanedTranscripts.length : 0) +
    (report.brokenIndices ? report.brokenIndices.length : 0) +
    (report.staleLocks ? report.staleLocks.length : 0) +
    (report.legacyProjectMemoryArtifacts ? report.legacyProjectMemoryArtifacts.length : 0)

  elements.diagnosticsSubtitle.textContent =
    total === 1
      ? fmt(STRINGS.diagnosticsSummary, { n: total })
      : fmt(STRINGS.diagnosticsSummaryPlural, { n: total })
  elements.diagnosticsBody.innerHTML =
    sections.length > 0
      ? sections.join('')
      : '<div class="lf-empty">' + STRINGS.diagnosticsNoIssues + '</div>'
}

/**
 * Saves the current CLAUDE.md editor content to the server.
 * Guards against a delayed auto-save writing to the wrong project if the
 * user switched selection between the keystroke and the debounce firing.
 */
async function saveClaudeInstructions() {
  // The open drawer owns this project ID even if a background refresh changes
  // the current selection. Closing the drawer clears it, so a delayed timer
  // can never be redirected to another project.
  if (!claudeInstructionsProjectId) return false
  clearTimeout(claudeInstructionsSaveTimer)
  const projectId = claudeInstructionsProjectId
  const content = elements.instructionsEditor.value

  // Every request starts after the previous one settles. A slow older write
  // can therefore never arrive after and overwrite a newer editor snapshot.
  const result = claudeInstructionsSaveQueue.then(async function () {
    try {
      await requestJson('/api/claude-md/' + encodeURIComponent(projectId), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: content }),
      })
      if (
        claudeInstructionsProjectId === projectId &&
        elements.instructionsEditor.value === content
      ) {
        claudeInstructionsDirty = false
        elements.instructionsSaveStatus.textContent = STRINGS.claudeMdSaved
        elements.instructionsSaveStatus.className = 'save-status saved'
      }
      return true
    } catch (error) {
      if (
        claudeInstructionsProjectId === projectId &&
        elements.instructionsEditor.value === content
      ) {
        elements.instructionsSaveStatus.textContent = fmt(STRINGS.claudeMdSaveError, {
          message: error.message,
        })
      }
      return false
    }
  })
  claudeInstructionsSaveQueue = result.then(function () {
    return undefined
  })
  return result
}

elements.instructionsTag.addEventListener('click', function (event) {
  event.preventDefault()
  void openClaudeInstructionsDrawer()
})
elements.instructionsCloseButton.addEventListener('click', function () {
  void closeClaudeInstructionsDrawer()
})
elements.instructionsFooterCloseButton.addEventListener('click', function () {
  void closeClaudeInstructionsDrawer()
})
elements.instructionsDrawer.addEventListener('click', function (event) {
  if (event.target === elements.instructionsDrawer) void closeClaudeInstructionsDrawer()
})
elements.diagnosticsButton.addEventListener('click', openDiagnosticsDrawer)
elements.diagnosticsCloseButton.addEventListener('click', closeDiagnosticsDrawer)
elements.diagnosticsDrawer.addEventListener('click', function (event) {
  if (event.target === elements.diagnosticsDrawer) closeDiagnosticsDrawer()
})
elements.instructionsEditor.addEventListener('input', function () {
  claudeInstructionsDirty = true
  elements.instructionsSaveStatus.textContent = STRINGS.claudeMdUnsaved
  elements.instructionsSaveStatus.className = 'save-status'
  clearTimeout(claudeInstructionsSaveTimer)
  claudeInstructionsSaveTimer = setTimeout(function () {
    void saveClaudeInstructions()
  }, AUTO_SAVE_DELAY_MS)
})
elements.instructionsSaveButton.addEventListener('click', function () {
  void saveClaudeInstructions()
})
