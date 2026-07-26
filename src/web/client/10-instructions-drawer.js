// ---------------------------------------------------------------------------
// CLAUDE.md drawer
// ---------------------------------------------------------------------------

/**
 * Checks whether a CLAUDE.md file exists for the project and shows or hides the
 * instructions tag accordingly. Called whenever the selected project changes.
 */
async function refreshClaudeInstructionsAvailability(project) {
  elements.instructionsTag.style.display = 'none'
  clearTimeout(claudeInstructionsSaveTimer)
  try {
    const instructions = await requestJson('/api/claude-md/' + encodeURIComponent(project.id))
    if (selectedProject && selectedProject.id === project.id && instructions.content !== null) {
      elements.instructionsTag.style.display = 'inline-flex'
    }
  } catch {
    if (selectedProject && selectedProject.id === project.id) {
      elements.instructionsTag.style.display = 'none'
    }
  }
}

/**
 * Fetches the project's CLAUDE.md and opens the editor drawer.
 * Captures the project reference before the async fetch so a project change
 * mid-flight cannot populate the wrong drawer content.
 */
async function openClaudeInstructionsDrawer() {
  if (!selectedProject) return
  // Capture the project so a slow response cannot populate a newly selected one.
  const project = selectedProject
  const instructions = await requestJson('/api/claude-md/' + encodeURIComponent(project.id))
  if (!selectedProject || selectedProject.id !== project.id) return

  elements.instructionsPath.textContent = instructions.path || '(no CLAUDE.md found)'
  elements.instructionsEditor.value = instructions.content || ''
  elements.instructionsEditor.disabled = instructions.content === null
  elements.instructionsSaveButton.disabled = instructions.content === null
  elements.instructionsSaveStatus.textContent = ''
  claudeInstructionsProjectId = project.id
  claudeInstructionsDirty = false
  elements.instructionsDrawer.classList.add('open')
  if (instructions.content !== null) elements.instructionsEditor.focus()
}

async function closeClaudeInstructionsDrawer() {
  if (claudeInstructionsClosing) return
  clearTimeout(claudeInstructionsSaveTimer)
  claudeInstructionsClosing = true
  const editorWasDisabled = elements.instructionsEditor.disabled
  const saveButtonWasDisabled = elements.instructionsSaveButton.disabled
  elements.instructionsEditor.disabled = true
  elements.instructionsSaveButton.disabled = true

  try {
    if (claudeInstructionsDirty && !(await saveClaudeInstructions())) return
    claudeInstructionsProjectId = null
    elements.instructionsDrawer.classList.remove('open')
  } finally {
    claudeInstructionsClosing = false
    if (elements.instructionsDrawer.classList.contains('open')) {
      elements.instructionsEditor.disabled = editorWasDisabled
      elements.instructionsSaveButton.disabled = saveButtonWasDisabled
    }
  }
}
