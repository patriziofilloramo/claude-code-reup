  // ---------------------------------------------------------------------------
  // New session
  // ---------------------------------------------------------------------------

  /** Asks the server to open a new Claude Code session in the project directory. */
  async function startNewSession(project) {
    project = project || selectedProject
    if (!project) return
    try {
      const result = await requestJson('/api/new-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id }),
      })
      if (result.launched) {
        showToast('New session started in terminal')
      } else if (result.copied) {
        showToast('Launch failed — command copied to clipboard', 'copied')
      } else {
        showToast('Launch failed: ' + (result.message || 'unknown error'), 'err')
      }
    } catch (error) {
      showToast('Error: ' + error.message, 'err')
    }
  }

