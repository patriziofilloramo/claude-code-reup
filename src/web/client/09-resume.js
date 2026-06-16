// ---------------------------------------------------------------------------
// Resume dialog and terminal launch
// ---------------------------------------------------------------------------

/** Opens the resume confirmation dialog pre-populated with the session details. */
function openResumeDialog(session) {
  selectSession(session)
  elements.resumeCommand.textContent = 'claude --resume ' + session.id
  elements.resumeDialogName.textContent = session.name
  elements.resumeDialogBranch.textContent = session.gitBranch ? '⎇ ' + session.gitBranch : ''
  elements.resumeDialogMessage.textContent = ''
  elements.resumeOverlay.classList.add('open')
  elements.resumeConfirmButton.focus()
}

function closeResumeDialog() {
  elements.resumeOverlay.classList.remove('open')
}

/**
 * Disables the confirm button and starts a "launching…" dot animation.
 * Returns the setInterval handle so the caller can stop it with stopLaunchAnimation.
 */
function startLaunchAnimation() {
  const labels = STRINGS.resumeLaunchingFrames
  let frame = 0

  elements.resumeConfirmButton.disabled = true
  elements.resumeDialogMessage.textContent = ''
  elements.resumeConfirmButton.textContent = labels[frame]

  return setInterval(function () {
    frame = (frame + 1) % labels.length
    elements.resumeConfirmButton.textContent = labels[frame]
  }, 300)
}

/** Stops the launch animation and restores the confirm button to its default state. */
function stopLaunchAnimation(launchAnimationTimer) {
  clearInterval(launchAnimationTimer)
  elements.resumeConfirmButton.textContent = STRINGS.resumeConfirmBtn
  elements.resumeConfirmButton.disabled = false
}

/**
 * Asks the server to open the selected session in a terminal.
 * Falls back gracefully: when the terminal launch fails, the server copies the
 * resume command to the clipboard and returns copied=true so the user can paste it.
 */
async function resumeSelectedSession() {
  if (!selectedSession || !selectedProject) return
  const launchAnimationTimer = startLaunchAnimation()

  try {
    const launchResult = await requestJson('/api/resume/' + selectedSession.id, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: selectedProject.id }),
    })
    stopLaunchAnimation(launchAnimationTimer)

    if (launchResult.launched) {
      closeResumeDialog()
      showToast(STRINGS.resumeResumed)
    } else if (launchResult.copied && launchResult.message) {
      elements.resumeDialogMessage.textContent = fmt(STRINGS.resumeLaunchFailed, {
        message: launchResult.message,
      })
    } else if (launchResult.copied) {
      closeResumeDialog()
      showToast(STRINGS.resumeCommandCopied, 'copied')
    } else {
      elements.resumeDialogMessage.textContent =
        launchResult.message || STRINGS.resumeFallbackFailed
    }
  } catch (error) {
    stopLaunchAnimation(launchAnimationTimer)
    elements.resumeDialogMessage.textContent = fmt(STRINGS.resumeError, { message: error.message })
  }
}

elements.resumeConfirmButton.addEventListener('click', function () {
  void resumeSelectedSession()
})
elements.resumeCancelButton.addEventListener('click', closeResumeDialog)
elements.resumeOverlay.addEventListener('click', function (event) {
  if (event.target === elements.resumeOverlay) closeResumeDialog()
})
elements.alwaysConfirmCheckbox.checked = shouldConfirmResume()
elements.alwaysConfirmCheckbox.addEventListener('change', function () {
  localStorage.setItem(
    CONFIRM_RESUME_PREFERENCE,
    elements.alwaysConfirmCheckbox.checked ? 'true' : 'false'
  )
})
