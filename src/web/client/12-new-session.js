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
      showToast(STRINGS.newSessionStarted)
    } else if (result.copied) {
      showToast(STRINGS.newSessionLaunchFailedCopied, 'copied')
    } else {
      showToast(
        fmt(STRINGS.newSessionLaunchFailed, { message: result.message || 'unknown error' }),
        'err'
      )
    }
  } catch (error) {
    showToast(fmt(STRINGS.newSessionError, { message: error.message }), 'err')
  }
}
