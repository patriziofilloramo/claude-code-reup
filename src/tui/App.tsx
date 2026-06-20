import { useEffect, useMemo, useState } from 'react'
import { Box, Text, render, useApp, useInput, useStdout } from 'ink'

import { join } from 'node:path'

import { APP } from '../config/app.js'
import { COLORS } from '../config/theme.js'
import { getActiveSessions } from '../core/session/active-sessions.js'
import { getProjectDirectory } from '../core/project/claude-paths.js'
import { formatHandoff, readTranscriptHandoffContext } from '../core/session/session-handoff.js'
import { readLiveUsageSummary } from '../core/usage/live-usage.js'
import type { LiveUsageSummary } from '../core/usage/live-usage.js'
import { loadProjects } from '../core/project/project-discovery.js'
import type { Project, Session } from '../core/session/session-model.js'
import { deleteSession, setSessionArchived } from '../core/session/session-metadata.js'
import { forgetProjectForSync } from '../core/sync/sync-actions.js'
import { copyToClipboard, openDirectory } from '../utils/system.js'
import { ConfigApp } from './ConfigApp.js'
import { DeepSearchPicker } from './DeepSearchPicker.js'
import AppFooter from './components/AppFooter.js'
import AppHeader from './components/AppHeader.js'
import AppToolbar from './components/AppToolbar.js'
import { COMMANDS } from './commands.js'
import type { VisibleWhen } from './commands.js'
import CommandPalette from './components/CommandPalette.js'
import type { PaletteCommand } from './components/CommandPalette.js'
import LaunchScreen from './components/LaunchScreen.js'
import ProjectActionMenu from './components/ProjectActionMenu.js'
import type { ProjectActionCommand } from './components/ProjectActionMenu.js'
import ProjectList from './components/ProjectList.js'
import ResumeCard from './components/ResumeCard.js'
import SessionActionMenu from './components/SessionActionMenu.js'
import type { SessionActionCommand } from './components/SessionActionMenu.js'
import HelpOverlay from './components/HelpOverlay.js'
import SessionList from './components/SessionList.js'
import {
  calculateMaximumVisibleSessions,
  createVisibleWindow,
  deriveSearchResults,
} from './session-view.js'

type FocusedPanel = 'projects' | 'sessions'

export interface ResumeTarget {
  projectPath: string
  sessionId?: string // undefined = start new session in the project directory
}

export type LaunchState =
  | { kind: 'resume'; session: Session }
  | { kind: 'new'; projectPath: string }

interface AppProps {
  onResume: (resumeTarget: ResumeTarget) => void
}

const LAUNCH_SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧']
// Header, toolbar, footer, panel labels, and one padding row are not available
// to the scrolling project/session viewports.
const CHROME_ROW_COUNT = 10

function App({ onResume }: AppProps) {
  const { exit } = useApp()
  const { stdout } = useStdout()

  // ---------------------------------------------------------------------------
  // Application state
  // ---------------------------------------------------------------------------

  const [projects, setProjects] = useState<Project[]>([])
  const [activeSessionIds, setActiveSessionIds] = useState<Set<string>>(new Set())
  const [liveUsage, setLiveUsage] = useState<LiveUsageSummary | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [focusedPanel, setFocusedPanel] = useState<FocusedPanel>('projects')
  const [selectedProjectIndex, setSelectedProjectIndex] = useState(0)
  const [selectedSessionIndex, setSelectedSessionIndex] = useState(0)
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [showArchivedSessions, setShowArchivedSessions] = useState(false)
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false)
  const [isProjectActionMenuOpen, setIsProjectActionMenuOpen] = useState(false)
  const [isSessionActionMenuOpen, setIsSessionActionMenuOpen] = useState(false)
  const [resumeCardSession, setResumeCardSession] = useState<Session | null>(null)
  const [isDeepSearchOpen, setIsDeepSearchOpen] = useState(false)
  const [bulkSelectedIds, setBulkSelectedIds] = useState<Set<string>>(new Set())
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [pendingDeleteIds, setPendingDeleteIds] = useState<Set<string>>(new Set())

  const [launching, setLaunching] = useState<LaunchState | null>(null)
  const [isConfigOpen, setIsConfigOpen] = useState(false)
  const [isHelpOpen, setIsHelpOpen] = useState(false)
  const [launchSpinnerFrame, setLaunchSpinnerFrame] = useState(0)

  // ---------------------------------------------------------------------------
  // Data loading and lifecycle
  // ---------------------------------------------------------------------------

  useEffect(() => {
    Promise.all([loadProjects(), getActiveSessions()])
      .then(([loadedProjects, activeIds]) => {
        setProjects(loadedProjects)
        setActiveSessionIds(activeIds)
        setIsLoading(false)
      })
      .catch((error) => {
        setLoadError(String(error))
        setIsLoading(false)
      })
  }, [])

  useEffect(() => {
    let disposed = false
    let refreshInProgress = false

    const refreshUsage = async (): Promise<void> => {
      if (refreshInProgress) return
      refreshInProgress = true
      try {
        const usage = await readLiveUsageSummary()
        if (!disposed) setLiveUsage(usage)
      } finally {
        refreshInProgress = false
      }
    }

    void refreshUsage()
    const intervalId = setInterval(() => void refreshUsage(), APP.usagePollMs)
    return () => {
      disposed = true
      clearInterval(intervalId)
    }
  }, [])

  useEffect(() => {
    let disposed = false
    let refreshInProgress = false

    const refreshActiveSessions = async (): Promise<void> => {
      if (refreshInProgress) return
      refreshInProgress = true
      try {
        const activeIds = await getActiveSessions()
        if (!disposed) setActiveSessionIds(activeIds)
      } finally {
        refreshInProgress = false
      }
    }

    const intervalId = setInterval(() => {
      void refreshActiveSessions()
    }, APP.activeSessionsPollMs)

    return () => {
      disposed = true
      clearInterval(intervalId)
    }
  }, [])

  useEffect(() => {
    setBulkSelectedIds(new Set())
    setSelectedSessionIndex(0)
    setIsProjectActionMenuOpen(false)
    setIsSessionActionMenuOpen(false)
    setResumeCardSession(null)
  }, [selectedProjectIndex])

  useEffect(() => {
    setSelectedProjectIndex(0)
    setSelectedSessionIndex(0)
  }, [searchQuery, showArchivedSessions])

  useEffect(() => {
    let disposed = false
    let refreshInProgress = false

    const refreshProjects = async (): Promise<void> => {
      if (refreshInProgress) return
      refreshInProgress = true
      try {
        const loadedProjects = await loadProjects()
        if (!disposed) setProjects(loadedProjects)
      } finally {
        refreshInProgress = false
      }
    }

    const intervalId = setInterval(() => {
      void refreshProjects()
    }, APP.projectRefreshMs)

    return () => {
      disposed = true
      clearInterval(intervalId)
    }
  }, [])

  useEffect(() => {
    if (!launching) return

    const spinnerInterval = setInterval(
      () => setLaunchSpinnerFrame((frame) => (frame + 1) % LAUNCH_SPINNER_FRAMES.length),
      80
    )
    const exitTimeout = setTimeout(exit, 700)

    return () => {
      clearInterval(spinnerInterval)
      clearTimeout(exitTimeout)
    }
  }, [exit, launching])

  // ---------------------------------------------------------------------------
  // Derived view model
  // ---------------------------------------------------------------------------

  const REMOTE_ACTIVE_THRESHOLD_MS = 5 * 60 * 1000
  const remotelyActiveSessionIds = useMemo(() => {
    const now = Date.now()
    const ids = new Set<string>()
    for (const project of projects) {
      for (const session of project.sessions) {
        if (
          !activeSessionIds.has(session.id) &&
          now - new Date(session.updated).getTime() < REMOTE_ACTIVE_THRESHOLD_MS
        ) {
          ids.add(session.id)
        }
      }
    }
    return ids
  }, [projects, activeSessionIds])

  const matchingProjects = deriveSearchResults(
    projects,
    searchQuery,
    showArchivedSessions,
    activeSessionIds
  )
  const selectedProject = matchingProjects[selectedProjectIndex] ?? null
  const selectableSessions = selectedProject?.sessions ?? []
  const clampedSessionIndex = Math.min(
    selectedSessionIndex,
    Math.max(0, selectableSessions.length - 1)
  )
  const focusedSession = selectableSessions[clampedSessionIndex] ?? null

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  function resumeSession(session: Session): void {
    onResume({ sessionId: session.id, projectPath: session.projectPath })
    setLaunching({ kind: 'resume', session })
  }

  function newSession(project: NonNullable<typeof selectedProject>): void {
    onResume({ projectPath: project.path })
    setLaunching({ kind: 'new', projectPath: project.path })
  }

  function flashMessage(message: string): void {
    setStatusMessage(message)
    setTimeout(() => setStatusMessage(null), 2200)
  }

  function archiveSessions(sessions: Session[]): void {
    if (!selectedProject || sessions.length === 0) return
    const archivable = sessions.filter((s) => !activeSessionIds.has(s.id))
    if (archivable.length === 0) {
      flashMessage('cannot archive — session is active')
      return
    }
    if (archivable.length < sessions.length) {
      flashMessage(`skipped ${sessions.length - archivable.length} active session(s)`)
    }
    Promise.all(
      archivable.map((s) => setSessionArchived(selectedProject.id, s.id, !s.signals.archived))
    )
      .then(() => loadProjects())
      .then((loaded) => setProjects(loaded))
      .catch(() => {})
    setBulkSelectedIds(new Set())
  }

  function archiveSelectedSession(): void {
    if (!focusedSession) return
    if (bulkSelectedIds.size > 0) {
      const targets = selectableSessions.filter((s) => bulkSelectedIds.has(s.id))
      archiveSessions(targets)
      return
    }
    if (activeSessionIds.has(focusedSession.id)) {
      flashMessage('cannot archive — session is active')
      return
    }
    archiveSessions([focusedSession])
  }

  function deleteSessions(sessions: Session[]): void {
    if (!selectedProject || sessions.length === 0) return
    const deletable = sessions.filter((s) => !activeSessionIds.has(s.id))
    if (deletable.length === 0) {
      flashMessage('cannot delete — session is active')
      return
    }
    Promise.all(deletable.map((s) => deleteSession(selectedProject.id, s.id)))
      .then(() => loadProjects())
      .then((loaded) => setProjects(loaded))
      .catch(() => flashMessage('delete failed'))
    setBulkSelectedIds(new Set())
    setPendingDeleteIds(new Set())
  }

  function requestDeleteConfirm(sessions: Session[]): void {
    if (sessions.some((s) => activeSessionIds.has(s.id))) {
      flashMessage('cannot delete — session is active')
      return
    }
    const ids = new Set(sessions.map((s) => s.id))
    setPendingDeleteIds(ids)
    const count = ids.size
    setStatusMessage(
      `Delete ${count} session${count === 1 ? '' : 's'} permanently? D confirm · esc cancel`
    )
  }

  function executeProjectAction(command: ProjectActionCommand): void {
    setIsProjectActionMenuOpen(false)
    if (!selectedProject) return
    switch (command) {
      case 'new-session':
        if (selectedProject.cloudOffline) {
          flashMessage('cloud offline — new session paused until sync resumes')
        } else {
          newSession(selectedProject)
        }
        break
      case 'browse-sessions':
        setFocusedPanel('sessions')
        setSelectedSessionIndex(0)
        break
      case 'open-directory':
        openDirectory(selectedProject.path)
        flashMessage('opened in file manager')
        break
      case 'copy-path':
        copyToClipboard(selectedProject.path)
          .then(() => flashMessage('path copied'))
          .catch(() => flashMessage('clipboard unavailable'))
        break
      case 'forget-project':
        forgetProjectForSync(selectedProject.path, { projects })
          .then((result) => loadProjects().then((loaded) => ({ loaded, result })))
          .then(({ loaded, result }) => {
            setProjects(loaded)
            flashMessage(result.message)
          })
          .catch((error: unknown) =>
            flashMessage(error instanceof Error ? error.message : 'forget project failed')
          )
        break
    }
  }

  function executeSessionAction(command: SessionActionCommand): void {
    setIsSessionActionMenuOpen(false)
    if (!focusedSession) return
    switch (command) {
      case 'resume':
        resumeSession(focusedSession)
        break
      case 'select':
        toggleBulkSelection(focusedSession)
        break
      case 'archive':
        archiveSessions([focusedSession])
        break
      case 'copy-id':
        copyToClipboard(focusedSession.id)
          .then(() => flashMessage('session ID copied'))
          .catch(() => flashMessage('clipboard unavailable'))
        break
      case 'handoff': {
        const s = focusedSession
        const transcriptPath = join(getProjectDirectory(selectedProject?.id ?? ''), `${s.id}.jsonl`)
        readTranscriptHandoffContext(transcriptPath)
          .then((ctx) => copyToClipboard(formatHandoff(s, ctx)))
          .then(() => flashMessage('handoff packet copied to clipboard'))
          .catch(() => flashMessage('handoff failed — transcript not found'))
        break
      }
      case 'delete':
        requestDeleteConfirm([focusedSession])
        break
    }
  }

  function toggleBulkSelection(session: Session): void {
    setBulkSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(session.id)) {
        next.delete(session.id)
      } else {
        next.add(session.id)
      }
      return next
    })
  }

  // ---------------------------------------------------------------------------
  // Command palette
  // ---------------------------------------------------------------------------

  // Evaluates a named visibility condition from the COMMANDS registry.
  // Only dynamic label overrides (text that changes with app state) stay here.
  function resolveVisibility(cond: VisibleWhen): boolean {
    switch (cond) {
      case 'always':
        return true
      case 'session-focused':
        return focusedPanel === 'sessions' && !!focusedSession
      case 'project-selected':
        return !!selectedProject
      case 'in-projects-panel':
        return focusedPanel === 'projects'
      case 'in-sessions-panel':
        return focusedPanel === 'sessions'
    }
  }

  const labelOverrides: Partial<Record<string, string>> = {
    archive:
      bulkSelectedIds.size > 0
        ? `Archive ${bulkSelectedIds.size} selected session(s)`
        : focusedSession?.signals.archived
          ? 'Unarchive selected session'
          : 'Archive selected session',
    delete:
      bulkSelectedIds.size > 0
        ? `Delete ${bulkSelectedIds.size} selected session(s) permanently`
        : 'Delete session permanently',
    'toggle-archived': showArchivedSessions ? 'Hide archived sessions' : 'Show archived sessions',
    'new-session': 'Start new session in this project',
  }

  const paletteCommands: PaletteCommand[] = COMMANDS.map((cmd) => ({
    key: cmd.id,
    description: labelOverrides[cmd.id] ?? cmd.label,
    keybinding: cmd.keybinding,
    group: cmd.group,
    visible: resolveVisibility(cmd.visibleWhen),
  }))

  function executePaletteCommand(commandKey: string): void {
    setIsCommandPaletteOpen(false)
    switch (commandKey) {
      case 'resume':
        if (focusedSession) {
          if (activeSessionIds.has(focusedSession.id)) {
            setResumeCardSession(focusedSession)
          } else {
            resumeSession(focusedSession)
          }
        }
        break
      case 'preview':
        if (focusedSession) setResumeCardSession(focusedSession)
        break
      case 'new-session':
        if (selectedProject) {
          if (selectedProject.cloudOffline) {
            flashMessage('cloud offline — new session paused until sync resumes')
          } else {
            newSession(selectedProject)
          }
        }
        break
      case 'archive':
        archiveSelectedSession()
        break
      case 'delete':
        if (focusedSession) {
          const targets =
            bulkSelectedIds.size > 0
              ? selectableSessions.filter((s) => bulkSelectedIds.has(s.id))
              : [focusedSession]
          requestDeleteConfirm(targets)
        }
        break
      case 'bulk-select':
        if (focusedSession) toggleBulkSelection(focusedSession)
        break
      case 'session-actions':
        if (focusedSession) setIsSessionActionMenuOpen(true)
        break
      case 'search':
        setIsSearchOpen(true)
        break
      case 'toggle-archived':
        setShowArchivedSessions((v) => !v)
        break
      case 'focus-sessions':
        setFocusedPanel('sessions')
        break
      case 'focus-projects':
        setFocusedPanel('projects')
        break
      case 'config':
        setIsConfigOpen(true)
        break
      case 'help':
        setIsHelpOpen(true)
        break
      case 'quit':
        exit()
        break
    }
  }

  // ---------------------------------------------------------------------------
  // Keyboard controller
  // ---------------------------------------------------------------------------

  useInput((input, key) => {
    if (launching) return
    if (isConfigOpen) return
    if (isHelpOpen) return

    // Ctrl+K (or raw \x0b on some Windows terminals) toggles command palette
    if ((key.ctrl && input === 'k') || input === '\x0b') {
      setIsCommandPaletteOpen((v) => !v)
      return
    }

    // While any overlay is open, let it handle input exclusively
    if (isCommandPaletteOpen) return
    if (isProjectActionMenuOpen) return
    if (isSessionActionMenuOpen) return
    if (resumeCardSession) return

    const escapePressed = key.escape || input === '\x1b'
    if (isSearchOpen) {
      if (escapePressed) {
        setIsSearchOpen(false)
        setSearchQuery('')
        return
      }
      if (key.tab) {
        setIsDeepSearchOpen(true)
        return
      }
      if (key.backspace || key.delete) {
        setSearchQuery((query) => query.slice(0, -1))
        return
      }
      const isNavKey = key.upArrow || key.downArrow || key.leftArrow || key.rightArrow || key.return
      if (!isNavKey && input && !key.ctrl && !key.meta) {
        setSearchQuery((query) => query + input)
        return
      }
    }

    if (escapePressed) {
      // Cancel pending delete confirmation
      if (pendingDeleteIds.size > 0) {
        setPendingDeleteIds(new Set())
        setStatusMessage(null)
        return
      }
      // Clear bulk selection before backing out of panel
      if (bulkSelectedIds.size > 0) {
        setBulkSelectedIds(new Set())
        return
      }
      if (focusedPanel === 'sessions') setFocusedPanel('projects')
      else exit()
      return
    }
    if (input === 'q') {
      exit()
      return
    }
    if (input === 'C') {
      setIsConfigOpen(true)
      return
    }
    if (input === '?') {
      setIsHelpOpen(true)
      return
    }
    if (!isLoading && input === 'n' && selectedProject) {
      if (selectedProject.cloudOffline) {
        flashMessage('cloud offline — new session paused until sync resumes')
      } else {
        newSession(selectedProject)
      }
      return
    }
    if (!isLoading && input === '/') {
      setIsSearchOpen(true)
      return
    }
    if (!isLoading && input === 'a') {
      setShowArchivedSessions((visible) => !visible)
      return
    }
    // Capital A: archive focused or all bulk-selected
    if (!isLoading && input === 'A' && focusedPanel === 'sessions') {
      archiveSelectedSession()
      return
    }
    // Capital D: confirm pending delete, or request delete for focused/bulk
    if (!isLoading && input === 'D' && focusedPanel === 'sessions') {
      if (pendingDeleteIds.size > 0) {
        const targets = selectableSessions.filter((s) => pendingDeleteIds.has(s.id))
        deleteSessions(targets)
      } else if (bulkSelectedIds.size > 0) {
        const targets = selectableSessions.filter((s) => bulkSelectedIds.has(s.id))
        requestDeleteConfirm(targets)
      } else if (focusedSession) {
        requestDeleteConfirm([focusedSession])
      }
      return
    }
    // Space: open context action menu for the focused item
    if (!isLoading && input === ' ' && focusedPanel === 'projects' && selectedProject) {
      setIsProjectActionMenuOpen(true)
      return
    }
    if (!isLoading && input === ' ' && focusedPanel === 'sessions' && focusedSession) {
      setIsSessionActionMenuOpen(true)
      return
    }
    // s: toggle bulk selection on focused session
    if (!isLoading && input === 's' && focusedPanel === 'sessions' && focusedSession) {
      toggleBulkSelection(focusedSession)
      return
    }
    if (key.tab || key.rightArrow) {
      setFocusedPanel('sessions')
      return
    }
    if (key.leftArrow) {
      setFocusedPanel('projects')
      return
    }
    if (key.upArrow) {
      if (focusedPanel === 'projects') {
        setSelectedProjectIndex((index) => Math.max(0, index - 1))
      } else {
        setSelectedSessionIndex((index) => Math.max(0, index - 1))
      }
      return
    }
    if (key.downArrow) {
      if (focusedPanel === 'projects') {
        setSelectedProjectIndex((index) =>
          Math.min(Math.max(0, matchingProjects.length - 1), index + 1)
        )
      } else {
        setSelectedSessionIndex((index) =>
          Math.min(Math.max(0, selectableSessions.length - 1), index + 1)
        )
      }
      return
    }
    // p = open preview card (works for all sessions including active ones)
    if (!isLoading && input === 'p' && focusedPanel === 'sessions' && focusedSession) {
      setResumeCardSession(focusedSession)
      return
    }

    if (!key.return) return

    if (focusedPanel === 'projects') {
      setFocusedPanel('sessions')
      setSelectedSessionIndex(0)
      return
    }

    if (focusedSession) {
      // Active sessions show the warning card first — resuming a live session
      // scrambles its transcript. The card explains the risk and still lets
      // the user proceed with a deliberate second Enter.
      if (activeSessionIds.has(focusedSession.id)) {
        setResumeCardSession(focusedSession)
      } else {
        resumeSession(focusedSession)
      }
    }
  })

  // ---------------------------------------------------------------------------
  // Terminal viewport
  // ---------------------------------------------------------------------------

  const terminalHeight = stdout?.rows ?? 24
  const availableBodyRows = Math.max(6, terminalHeight - CHROME_ROW_COUNT)
  const maximumVisibleSessionRows = calculateMaximumVisibleSessions(availableBodyRows, false)
  const [visibleProjects, visibleProjectSelectionIndex] = createVisibleWindow(
    matchingProjects,
    selectedProjectIndex,
    availableBodyRows
  )
  const [visibleSessions, visibleSessionSelectionIndex] = createVisibleWindow(
    selectableSessions,
    selectedSessionIndex,
    maximumVisibleSessionRows
  )

  if (launching) {
    return (
      <LaunchScreen
        launching={launching}
        spinnerFrame={LAUNCH_SPINNER_FRAMES[launchSpinnerFrame]}
        version={APP.version}
      />
    )
  }

  if (isConfigOpen) {
    return <ConfigApp onClose={() => setIsConfigOpen(false)} onProjectsChanged={setProjects} />
  }

  if (isHelpOpen) {
    return <HelpOverlay onClose={() => setIsHelpOpen(false)} />
  }

  function renderApplicationBody() {
    if (isDeepSearchOpen) {
      return (
        <DeepSearchPicker
          query={searchQuery}
          projects={projects}
          onSelect={(match) => {
            setIsDeepSearchOpen(false)
            resumeSession(match.session)
          }}
          onBack={() => setIsDeepSearchOpen(false)}
        />
      )
    }

    if (isCommandPaletteOpen) {
      return (
        <CommandPalette
          commands={paletteCommands}
          onClose={() => setIsCommandPaletteOpen(false)}
          onExecute={executePaletteCommand}
        />
      )
    }

    if (isLoading) {
      return (
        <Box flexGrow={1} padding={1}>
          <Text color={COLORS.dim}>scanning sessions…</Text>
        </Box>
      )
    }
    if (loadError) {
      return (
        <Box flexDirection="column" flexGrow={1} padding={1}>
          <Text bold color={COLORS.danger}>
            failed to load sessions
          </Text>
          <Text color={COLORS.muted}>{loadError}</Text>
        </Box>
      )
    }
    if (projects.length === 0) {
      return (
        <Box flexGrow={1} padding={1}>
          <Text color={COLORS.muted}>no projects found in ~/.claude/projects/</Text>
        </Box>
      )
    }
    if (matchingProjects.length === 0) {
      return (
        <Box flexGrow={1} padding={1}>
          <Text color={COLORS.muted}>no projects or sessions match your search</Text>
        </Box>
      )
    }

    return (
      <Box flexGrow={1}>
        <ProjectList
          isFocused={focusedPanel === 'projects'}
          projects={visibleProjects}
          selectedIndex={visibleProjectSelectionIndex}
          totalCount={matchingProjects.length}
        />
        {resumeCardSession && selectedProject ? (
          <ResumeCard
            isActive={activeSessionIds.has(resumeCardSession.id)}
            projectId={selectedProject.id}
            session={resumeCardSession}
            onResume={() => {
              const s = resumeCardSession
              setResumeCardSession(null)
              resumeSession(s)
            }}
            onClose={() => setResumeCardSession(null)}
          />
        ) : isProjectActionMenuOpen && selectedProject ? (
          <ProjectActionMenu
            project={selectedProject}
            onExecute={executeProjectAction}
            onClose={() => setIsProjectActionMenuOpen(false)}
          />
        ) : isSessionActionMenuOpen && focusedSession ? (
          <SessionActionMenu
            isActive={activeSessionIds.has(focusedSession.id)}
            isBulkSelected={bulkSelectedIds.has(focusedSession.id)}
            session={focusedSession}
            onExecute={executeSessionAction}
            onClose={() => setIsSessionActionMenuOpen(false)}
          />
        ) : (
          <SessionList
            activeSessionIds={activeSessionIds}
            bulkSelectedIds={bulkSelectedIds}
            isFocused={focusedPanel === 'sessions'}
            project={selectedProject}
            remotelyActiveSessionIds={remotelyActiveSessionIds}
            selectedIndex={visibleSessionSelectionIndex}
            sessions={visibleSessions}
            totalCount={selectableSessions.length}
          />
        )}
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      <AppHeader usage={liveUsage} version={APP.version} />
      <AppToolbar
        isLoading={isLoading}
        isSearchOpen={isSearchOpen}
        projectCount={matchingProjects.length}
        searchQuery={searchQuery}
      />
      {renderApplicationBody()}
      <AppFooter
        bulkSelectedCount={bulkSelectedIds.size}
        focusedPanel={focusedPanel}
        isProjectActionMenuOpen={isProjectActionMenuOpen}
        isResumeCardOpen={resumeCardSession !== null}
        isSearchOpen={isSearchOpen}
        isSessionActionMenuOpen={isSessionActionMenuOpen}
        statusMessage={statusMessage}
      />
    </Box>
  )
}

export function runTUI(): Promise<ResumeTarget | null> {
  return new Promise((resolve) => {
    let resumeTarget: ResumeTarget | null = null
    const { waitUntilExit } = render(
      <App
        onResume={(selectedResumeTarget) => {
          resumeTarget = selectedResumeTarget
        }}
      />
    )
    waitUntilExit()
      .then(() => resolve(resumeTarget))
      .catch(() => resolve(null))
  })
}
