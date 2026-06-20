import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Box, Text, render, useApp, useInput } from 'ink'

import { LABELS } from '../config/labels.js'
import { COLORS } from '../config/theme.js'
import type { ThemeName } from '../config/theme-tokens.js'
import { loadProjects } from '../core/project/project-discovery.js'
import { pathsReferToSameLocation } from '../core/project/path-comparison.js'
import type { Project } from '../core/session/session-model.js'
import {
  buildSyncOverview,
  forgetProjectForSync,
  getCurrentProjectSyncAction,
  linkAllCloudProjectsForSync,
  linkProjectForSync,
  type SyncOverview,
  type SyncProjectReport,
  type CurrentProjectSyncAction,
  unlinkAllSyncedProjectsForSync,
  unlinkProjectForSync,
} from '../core/sync/sync-actions.js'
import type { AdvancedDiscovery, AutoCleanup, CrossDeviceSessionStorage } from '../core/user-prefs.js'
import { readUserPrefs, setUserPref } from '../core/user-prefs.js'
import {
  isUsageStatusLineConfigured,
  removeUsageStatusLine,
  setupUsageStatusLine,
} from '../core/usage/usage-statusline-integration.js'
import { copyToClipboard } from '../utils/system.js'

const TABS = ['Interface', 'Integrations', 'Features'] as const
type Tab = (typeof TABS)[number]
type SyncSection = 'linked' | 'local' | 'remote'
type FeatureCursorItem =
  | { kind: 'cleanup' }
  | { kind: 'sync-toggle' }
  | { kind: 'advanced-discovery-toggle' }
  | { action: 'current-project' | 'link-all-cloud' | 'unlink-all'; kind: 'action' }
  | { kind: 'legend' }
  | { kind: 'section'; section: SyncSection }
  | { kind: 'project'; project: SyncProjectReport }

const TAB_CURSOR_MAX: Record<Tab, number> = {
  Interface: 2,
  Integrations: 3,
  Features: 1,
}

const MANAGED_SYNC_SETUP = {
  updateClaudeMd: true,
  updateGitignore: true,
  updatePermissionRules: true,
} as const
const SPINNER_FRAMES = ['|', '/', '-', '\\']

const SHELLS = [
  {
    label: 'PowerShell',
    cmd: 'swoop completion powershell | Out-String | Invoke-Expression',
    profile: '$PROFILE',
  },
  {
    label: 'Bash',
    cmd: 'eval "$(swoop completion bash)"',
    profile: '~/.bashrc or ~/.bash_profile',
  },
  {
    label: 'Zsh',
    cmd: 'eval "$(swoop completion zsh)"',
    profile: '~/.zshrc',
  },
] as const

function detectShell(): 0 | 1 | 2 | null {
  const shell = process.env['SHELL'] ?? ''
  if (shell.includes('zsh')) return 2
  if (shell.includes('bash')) return 1
  if (process.platform === 'win32') return 0
  return null
}

const DETECTED_SHELL = detectShell()
const DISPLAY_SHELLS = SHELLS.map((shell, index) => ({
  ...shell,
  detected: DETECTED_SHELL === index,
})).sort((left, right) => Number(right.detected) - Number(left.detected))

export function ConfigApp({
  onClose,
  initialTab,
  onProjectsChanged,
}: {
  onClose?: () => void
  initialTab?: Tab
  onProjectsChanged?: (projects: Project[]) => void
} = {}) {
  const { exit } = useApp()
  const initialTabIndex = initialTab ? Math.max(0, TABS.indexOf(initialTab)) : 0
  const [tabIndex, setTabIndex] = useState(initialTabIndex)
  const [cursor, setCursor] = useState(0)
  const [theme, setTheme] = useState<ThemeName>('dark')
  const [autoCleanupOnStart, setAutoCleanupOnStart] = useState<AutoCleanup>('off')
  const [crossDeviceSessionStorage, setCrossDeviceSessionStorage] =
    useState<CrossDeviceSessionStorage>('off')
  const [advancedDiscovery, setAdvancedDiscovery] = useState<AdvancedDiscovery>('off')
  const [usageConfigured, setUsageConfigured] = useState<boolean | null>(null)
  const [statusMsg, setStatusMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pendingConfirm, setPendingConfirm] = useState<string | null>(null)
  const [copiedShellIndex, setCopiedShellIndex] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [projects, setProjects] = useState<Project[]>([])
  const [syncOverview, setSyncOverview] = useState<SyncOverview | null>(null)
  const [remoteScanning, setRemoteScanning] = useState(false)
  const [spinnerFrame, setSpinnerFrame] = useState(0)
  const [expandedSyncSections, setExpandedSyncSections] = useState<Record<SyncSection, boolean>>({
    linked: false,
    local: false,
    remote: false,
  })
  const syncRefreshId = useRef(0)

  useEffect(() => {
    void readUserPrefs().then((prefs) => {
      setTheme(prefs.theme)
      setAutoCleanupOnStart(prefs.autoCleanupOnStart)
      setCrossDeviceSessionStorage(prefs.crossDeviceSessionStorage)
      setAdvancedDiscovery(prefs.advancedDiscovery)
    })
    void isUsageStatusLineConfigured().then(setUsageConfigured)
    void loadProjects().then(setProjects)
  }, [])

  const currentTab = TABS[tabIndex]!
  const syncSections = useMemo(() => {
    const all = syncOverview?.projects ?? []
    return {
      linked: all.filter((project) => project.isShared),
      local: all.filter((project) => !project.isShared && !project.isRemoteProject),
      remote: all.filter((project) => project.isRemoteProject),
    }
  }, [syncOverview])
  const currentSyncProject = useMemo(
    () =>
      syncOverview?.projects.find((project) =>
        pathsReferToSameLocation(project.path, process.cwd())
      ),
    [syncOverview]
  )
  const currentProjectAction = getCurrentProjectSyncAction(currentSyncProject)
  const featureCursorItems = useMemo<FeatureCursorItem[]>(() => {
    const items: FeatureCursorItem[] = [{ kind: 'cleanup' }, { kind: 'sync-toggle' }]
    if (crossDeviceSessionStorage !== 'on') return items

    items.push(
      { kind: 'advanced-discovery-toggle' },
      { kind: 'action', action: 'current-project' },
      { kind: 'action', action: 'link-all-cloud' },
      { kind: 'action', action: 'unlink-all' }
    )
    for (const section of ['linked', 'local', 'remote'] as const) {
      items.push({ kind: 'section', section })
      if (expandedSyncSections[section]) {
        items.push(
          ...syncSections[section].map(
            (project): FeatureCursorItem => ({ kind: 'project', project })
          )
        )
      }
    }
    items.push({ kind: 'legend' })
    return items
  }, [advancedDiscovery, crossDeviceSessionStorage, expandedSyncSections, syncSections])
  const featuresCursorMax = featureCursorItems.length - 1
  const maxCursor = currentTab === 'Features' ? featuresCursorMax : TAB_CURSOR_MAX[currentTab]

  async function refreshProjectsAndSync(showRemoteSpinner = false): Promise<void> {
    const refreshId = ++syncRefreshId.current
    if (showRemoteSpinner) setRemoteScanning(true)
    const updatedProjects = await loadProjects()
    if (refreshId === syncRefreshId.current) {
      setProjects(updatedProjects)
      onProjectsChanged?.(updatedProjects)
    }
    try {
      const overview = await buildSyncOverview(updatedProjects)
      if (refreshId === syncRefreshId.current) setSyncOverview(overview)
    } finally {
      if (showRemoteSpinner && refreshId === syncRefreshId.current) setRemoteScanning(false)
    }
  }

  useEffect(() => {
    if (currentTab === 'Features') void refreshProjectsAndSync(true)
  }, [currentTab])

  useEffect(() => {
    if (!remoteScanning) return
    const timer = setInterval(
      () => setSpinnerFrame((frame) => (frame + 1) % SPINNER_FRAMES.length),
      80
    )
    return () => clearInterval(timer)
  }, [remoteScanning])

  useEffect(() => {
    setCursor((value) => Math.min(value, featuresCursorMax))
  }, [featuresCursorMax])

  function switchTab(delta: number): void {
    setTabIndex((index) => (index + delta + TABS.length) % TABS.length)
    setCursor(0)
    setPendingConfirm(null)
    setStatusMsg(null)
  }

  useInput((input, key) => {
    if (input === 'q' || key.escape) {
      if (onClose) onClose()
      else exit()
      return
    }
    if (key.tab || key.rightArrow) {
      switchTab(1)
      return
    }
    if (key.leftArrow) {
      switchTab(-1)
      return
    }
    if (key.upArrow) {
      setCursor((value) => Math.max(0, value - 1))
      setPendingConfirm(null)
      setStatusMsg(null)
      return
    }
    if (key.downArrow && maxCursor >= 0) {
      setCursor((value) => Math.min(maxCursor, value + 1))
      setPendingConfirm(null)
      setStatusMsg(null)
      return
    }
    if (input === 'f' && !busy) {
      void handleForgetShortcut()
      return
    }
    if ((input === ' ' || key.return) && !busy) void handleActivate()
  })

  function confirmAction(actionId: string): boolean {
    if (pendingConfirm === actionId) {
      setPendingConfirm(null)
      return true
    }
    setPendingConfirm(actionId)
    setStatusMsg({ ok: false, text: 'Press enter again to confirm this bulk sync action' })
    return false
  }

  async function handleForgetShortcut(): Promise<void> {
    if (currentTab !== 'Features' || crossDeviceSessionStorage !== 'on') return
    const item = featureCursorItems[cursor]
    if (
      item?.kind !== 'project' ||
      item.project.isShared ||
      item.project.isRemoteProject ||
      !item.project.cloudPath ||
      item.project.isActive
    ) {
      return
    }

    const confirmationId = `forget:${item.project.id}`
    if (pendingConfirm !== confirmationId) {
      setPendingConfirm(confirmationId)
      setStatusMsg({ ok: false, text: LABELS.configSyncForgetConfirm })
      return
    }

    setPendingConfirm(null)
    setBusy(true)
    try {
      const result = await forgetProjectForSync(item.project.path, { projects })
      setStatusMsg({ ok: true, text: result.message })
      await refreshProjectsAndSync(true)
    } catch (error) {
      setStatusMsg({
        ok: false,
        text: error instanceof Error ? error.message : 'forget project failed',
      })
    } finally {
      setBusy(false)
    }
  }

  async function handleActivate(): Promise<void> {
    if (currentTab === 'Interface') {
      const themes: ThemeName[] = ['dark', 'light', 'terminal']
      const next = themes[cursor] ?? 'dark'
      await setUserPref('theme', next)
      setTheme(next)
      setStatusMsg({ ok: true, text: `Theme set to ${next}; restart swoop to apply` })
      return
    }

    if (currentTab === 'Integrations') {
      await handleIntegrationAction()
      return
    }

    await handleFeaturesAction()
  }

  async function handleIntegrationAction(): Promise<void> {
    if (cursor === 0) {
      if (usageConfigured === null) return
      setBusy(true)
      try {
        if (usageConfigured) {
          const result = await removeUsageStatusLine()
          setUsageConfigured(false)
          setStatusMsg({
            ok: true,
            text: result.changed
              ? `Integration removed${result.restoredPrevious ? '; previous status line restored' : ''}`
              : 'Was not configured',
          })
        } else {
          await setupUsageStatusLine()
          setUsageConfigured(true)
          setStatusMsg({ ok: true, text: 'Integration set up; restart Claude Code to activate' })
        }
      } catch (error) {
        setStatusMsg({
          ok: false,
          text: error instanceof Error ? error.message : 'integration setup failed',
        })
      } finally {
        setBusy(false)
      }
      return
    }

    if (cursor >= 1 && cursor <= 3) {
      const shell = DISPLAY_SHELLS[cursor - 1]!
      const copiedIndex = cursor
      copyToClipboard(shell.cmd)
        .then(() => {
          setCopiedShellIndex(copiedIndex)
          setTimeout(() => setCopiedShellIndex(null), 2000)
        })
        .catch(() => setStatusMsg({ ok: false, text: 'clipboard unavailable' }))
    }
  }

  async function handleFeaturesAction(): Promise<void> {
    const item = featureCursorItems[cursor]
    if (!item) return

    if (item.kind === 'cleanup') {
      const cycle: Record<AutoCleanup, AutoCleanup> = { off: 'on', on: 'auto', auto: 'off' }
      const next = cycle[autoCleanupOnStart]
      await setUserPref('autoCleanupOnStart', next)
      setAutoCleanupOnStart(next)
      setStatusMsg({ ok: true, text: `Cleanup on start: ${next}` })
      return
    }

    if (item.kind === 'sync-toggle') {
      const next: CrossDeviceSessionStorage = crossDeviceSessionStorage === 'on' ? 'off' : 'on'
      await setUserPref('crossDeviceSessionStorage', next)
      setCrossDeviceSessionStorage(next)
      setStatusMsg({
        ok: true,
        text:
          next === 'on'
            ? 'Cross-device Session Storage enabled; link actions still require explicit selection'
            : 'Cross-device Session Storage disabled',
      })
      if (next === 'on') void refreshProjectsAndSync(true)
      return
    }

    if (item.kind === 'advanced-discovery-toggle') {
      const next: AdvancedDiscovery = advancedDiscovery === 'on' ? 'off' : 'on'
      await setUserPref('advancedDiscovery', next)
      setAdvancedDiscovery(next)
      setStatusMsg({ ok: true, text: `Advanced Discovery: ${next}` })
      void refreshProjectsAndSync(true)
      return
    }

    if (crossDeviceSessionStorage !== 'on') return
    if (item.kind === 'section') {
      setExpandedSyncSections((current) => {
        const shouldExpand = !current[item.section]
        return {
          linked: shouldExpand && item.section === 'linked',
          local: shouldExpand && item.section === 'local',
          remote: shouldExpand && item.section === 'remote',
        }
      })
      return
    }
    if (item.kind === 'legend') {
      return
    }

    setBusy(true)
    try {
      if (item.kind === 'action' && item.action === 'current-project') {
        if (currentProjectAction.startsWith('blocked-')) return
        const result =
          currentProjectAction === 'unlink'
            ? await unlinkProjectForSync(process.cwd(), { projects })
            : await linkProjectForSync(process.cwd(), {
                projects,
                setupOptions: MANAGED_SYNC_SETUP,
              })
        setStatusMsg({ ok: !result.error, text: result.message })
      } else if (item.kind === 'action' && item.action === 'link-all-cloud') {
        if (!confirmAction('link-all-cloud')) return
        const result = await linkAllCloudProjectsForSync({
          projects,
          setupOptions: MANAGED_SYNC_SETUP,
        })
        setStatusMsg({ ok: true, text: result.message })
      } else if (item.kind === 'action' && item.action === 'unlink-all') {
        if (!confirmAction('unlink-all')) return
        const result = await unlinkAllSyncedProjectsForSync({ projects })
        setStatusMsg({ ok: true, text: result.message })
      } else if (item.kind === 'project') {
        if (item.project.isActive) return
        const result = item.project.isShared
          ? await unlinkProjectForSync(item.project.path, { projects })
          : await linkProjectForSync(item.project.path, {
              projects,
              setupOptions: MANAGED_SYNC_SETUP,
            })
        setStatusMsg({ ok: !result.error, text: result.message })
      }
      await refreshProjectsAndSync()
    } catch (error) {
      setStatusMsg({ ok: false, text: error instanceof Error ? error.message : 'sync failed' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Box flexDirection="column">
      <Box gap={1} paddingX={1} paddingTop={1}>
        <Text bold color={COLORS.accent}>
          {LABELS.appName}
        </Text>
        <Text color={COLORS.muted}>{LABELS.configPanelTitle}</Text>
      </Box>

      <Box gap={3} paddingX={1} paddingY={1}>
        {TABS.map((tab, index) => (
          <Text
            bold={index === tabIndex}
            color={index === tabIndex ? COLORS.text : COLORS.muted}
            key={tab}
            underline={index === tabIndex}
          >
            {tab}
          </Text>
        ))}
      </Box>

      <Box flexDirection="column" minHeight={12} paddingX={2}>
        {currentTab === 'Interface' && <InterfaceTab cursor={cursor} theme={theme} />}
        {currentTab === 'Integrations' && (
          <IntegrationsTab
            busy={busy}
            copiedShellIndex={copiedShellIndex}
            cursor={cursor}
            usageConfigured={usageConfigured}
          />
        )}
        {currentTab === 'Features' && (
          <FeaturesTab
            advancedDiscovery={advancedDiscovery}
            autoCleanupOnStart={autoCleanupOnStart}
            busy={busy}
            cursor={cursor}
            crossDeviceSessionStorage={crossDeviceSessionStorage}
            currentProjectAction={currentProjectAction}
            expandedSyncSections={expandedSyncSections}
            featureCursorItems={featureCursorItems}
            pendingConfirm={pendingConfirm}
            remoteScanning={remoteScanning}
            spinner={SPINNER_FRAMES[spinnerFrame]!}
            syncOverview={syncOverview}
            syncSections={syncSections}
          />
        )}
      </Box>

      {statusMsg && (
        <Box paddingBottom={1} paddingX={2}>
          <Text color={statusMsg.ok ? COLORS.ok : COLORS.danger}>{statusMsg.text}</Text>
        </Box>
      )}

      <Box
        borderBottom={false}
        borderColor={COLORS.border}
        borderLeft={false}
        borderRight={false}
        borderStyle="single"
        borderTop={true}
        gap={2}
        paddingX={1}
      >
        <Text color={COLORS.muted}>
          <Text color={COLORS.text}>{LABELS.configKeyUpDown}</Text>{' '}
          {LABELS.hintNav.replace('↑↓ ', '')}
        </Text>
        <Text color={COLORS.muted}>
          <Text color={COLORS.text}>{LABELS.configKeyEnter}</Text> {LABELS.configSelect}
        </Text>
        <Text color={COLORS.muted}>
          <Text color={COLORS.text}>{LABELS.configKeyTabLeftRight}</Text> {LABELS.configHintSwitch}
        </Text>
        <Text color={COLORS.muted}>
          <Text color={COLORS.text}>{onClose ? 'esc / q' : 'q'}</Text>
          {onClose ? ' back to swoop' : ' quit'}
        </Text>
      </Box>
    </Box>
  )
}

function InterfaceTab({ cursor, theme }: { cursor: number; theme: ThemeName }) {
  const options: { desc: string; label: string; value: ThemeName }[] = [
    { value: 'dark', label: 'dark', desc: 'Dark background; default' },
    { value: 'light', label: 'light', desc: 'Light background; high contrast in bright rooms' },
    { value: 'terminal', label: 'terminal', desc: 'Phosphor green on near-black' },
  ]

  return (
    <Box flexDirection="column">
      <Text bold color={COLORS.text}>
        {LABELS.configColorThemeTitle}
      </Text>
      <Text color={COLORS.dim}>{LABELS.configColorThemeDesc}</Text>
      <Box flexDirection="column" marginTop={1}>
        {options.map((option, index) => (
          <SelectableRow
            active={option.value === theme}
            description={option.desc}
            focused={cursor === index}
            key={option.value}
            label={option.label}
          />
        ))}
      </Box>
    </Box>
  )
}

function IntegrationsTab({
  busy,
  copiedShellIndex,
  cursor,
  usageConfigured,
}: {
  busy: boolean
  copiedShellIndex: number | null
  cursor: number
  usageConfigured: boolean | null
}) {
  return (
    <Box flexDirection="column" gap={1}>
      <FeatureCard focused={cursor === 0}>
        <Box gap={1}>
          <Text color={cursor === 0 ? COLORS.accent : COLORS.dim}>{cursor === 0 ? '>' : ' '}</Text>
          <Text bold={cursor === 0} color={cursor === 0 ? COLORS.text : COLORS.textSub}>
            {LABELS.configLiveUsageTitle}
          </Text>
          <Text color={usageConfigured ? COLORS.ok : COLORS.dim}>
            {usageConfigured === null ? '...' : usageConfigured ? 'on' : 'off'}
          </Text>
          {busy && <Text color={COLORS.muted}> {LABELS.configWorking}</Text>}
        </Box>
        <Box paddingLeft={2}>
          <Text color={COLORS.dim}>{LABELS.configLiveUsageDesc}</Text>
        </Box>
      </FeatureCard>

      <FeatureCard focused={cursor >= 1}>
        <Box paddingLeft={2}>
          <Text bold color={cursor >= 1 ? COLORS.text : COLORS.textSub}>
            {LABELS.configShellCompletionTitle}
          </Text>
        </Box>
        <Box paddingLeft={2}>
          <Text color={COLORS.dim}>{LABELS.configShellCompletionDesc}</Text>
        </Box>
        <Box flexDirection="column" marginTop={1}>
          {DISPLAY_SHELLS.map((shell, index) => {
            const shellCursor = index + 1
            const focused = cursor === shellCursor
            return (
              <Box flexDirection="column" key={shell.label} marginBottom={1}>
                <Box gap={1}>
                  <Text color={focused ? COLORS.accent : COLORS.dim}>{focused ? '>' : ' '}</Text>
                  <Text bold={focused} color={focused ? COLORS.text : COLORS.textSub}>
                    {shell.label}
                  </Text>
                  {shell.detected && (
                    <Text bold color={COLORS.ok} inverse>
                      {' '}
                      {LABELS.configDetected}{' '}
                    </Text>
                  )}
                </Box>
                {focused && (
                  <Box flexDirection="column" paddingLeft={2}>
                    <Text color={COLORS.muted}>{shell.cmd}</Text>
                    <Text color={copiedShellIndex === shellCursor ? COLORS.ok : COLORS.dim}>
                      {copiedShellIndex === shellCursor
                        ? 'command copied; paste in your terminal'
                        : `enter to copy; add to ${shell.profile} for permanent setup`}
                    </Text>
                  </Box>
                )}
              </Box>
            )
          })}
        </Box>
      </FeatureCard>
    </Box>
  )
}

function FeaturesTab({
  advancedDiscovery,
  autoCleanupOnStart,
  busy,
  cursor,
  crossDeviceSessionStorage,
  currentProjectAction,
  expandedSyncSections,
  featureCursorItems,
  pendingConfirm,
  remoteScanning,
  spinner,
  syncOverview,
  syncSections,
}: {
  advancedDiscovery: AdvancedDiscovery
  autoCleanupOnStart: AutoCleanup
  busy: boolean
  cursor: number
  crossDeviceSessionStorage: CrossDeviceSessionStorage
  currentProjectAction: CurrentProjectSyncAction
  expandedSyncSections: Record<SyncSection, boolean>
  featureCursorItems: FeatureCursorItem[]
  pendingConfirm: string | null
  remoteScanning: boolean
  spinner: string
  syncOverview: SyncOverview | null
  syncSections: Record<SyncSection, SyncProjectReport[]>
}) {
  const syncEnabled = crossDeviceSessionStorage === 'on'
  const advancedDiscoveryEnabled = advancedDiscovery === 'on'
  const syncCardFocused = cursor >= 1
  const cleanupLabel =
    autoCleanupOnStart === 'on' ? 'on' : autoCleanupOnStart === 'auto' ? 'auto' : 'off'
  const cursorFor = (predicate: (item: FeatureCursorItem) => boolean): number =>
    featureCursorItems.findIndex(predicate)
  const advancedDiscoveryCursor = cursorFor((item) => item.kind === 'advanced-discovery-toggle')
  const actionCursor = (action: 'current-project' | 'link-all-cloud' | 'unlink-all'): number =>
    cursorFor((item) => item.kind === 'action' && item.action === action)
  const currentProjectPresentation =
    currentProjectAction === 'blocked-linked'
      ? {
          disabled: true,
          label: LABELS.configSyncCurrentLinked,
          suffix: LABELS.configSyncCurrentLinkedActive,
        }
      : currentProjectAction === 'blocked-local'
        ? {
            disabled: true,
            label: LABELS.configSyncLinkCurrent,
            suffix: LABELS.configSyncCurrentLocalActive,
          }
        : currentProjectAction === 'unlink'
          ? {
              disabled: false,
              label: LABELS.configSyncUnlinkCurrent,
              suffix: process.cwd(),
            }
          : {
              disabled: false,
              label: LABELS.configSyncLinkCurrent,
              suffix: process.cwd(),
            }
  const sectionCursor = (section: SyncSection): number =>
    cursorFor((item) => item.kind === 'section' && item.section === section)
  const legendCursor = cursorFor((item) => item.kind === 'legend')

  return (
    <Box flexDirection="column" gap={1}>
      <FeatureCard focused={cursor === 0}>
        <SelectableRow
          active={autoCleanupOnStart !== 'off'}
          description={
            autoCleanupOnStart === 'off'
              ? 'No automatic cleanup. Run `swoop cleanup` manually.'
              : autoCleanupOnStart === 'auto'
                ? 'Archives high-confidence cleanup candidates automatically on startup.'
                : 'Shows cleanup picker before opening swoop; you choose what to archive.'
          }
          focused={cursor === 0}
          label="Cleanup on start"
          status={cleanupLabel}
        />
      </FeatureCard>

      <FeatureCard focused={cursor >= 1}>
        <SelectableRow
          active={syncEnabled}
          badge="Alpha"
          description={
            cursor === 1
              ? LABELS.configSyncFeatureDescriptionExpanded
              : LABELS.configSyncFeatureDescription
          }
          focused={cursor === 1}
          label="Cross-device Session Storage"
          noBottomMargin={syncEnabled}
          status={syncEnabled ? 'on' : 'off'}
        />

        {!syncCardFocused && <CloudIconLegend focused={false} />}

        {syncEnabled && syncCardFocused && (
          <Box flexDirection="column" paddingLeft={3} marginTop={1} marginBottom={1}>
            <SelectableRow
              active={advancedDiscoveryEnabled}
              description="Scan specific folders for projects linked on other devices. Configure search paths in the web UI."
              focused={cursor === advancedDiscoveryCursor}
              label="Advanced Discovery"
              status={advancedDiscoveryEnabled ? 'on' : 'off'}
            />
            <Box marginTop={1}>
              <Text bold color={COLORS.text}>
                {LABELS.configSyncActionsTitle}
              </Text>
            </Box>
            <SyncActionRow
              confirm={false}
              disabled={currentProjectPresentation.disabled}
              focused={cursor === actionCursor('current-project')}
              label={currentProjectPresentation.label}
              suffix={
                busy && cursor === actionCursor('current-project')
                  ? LABELS.configWorking
                  : currentProjectPresentation.suffix
              }
            />
            <SyncActionRow
              confirm={pendingConfirm === 'link-all-cloud'}
              focused={cursor === actionCursor('link-all-cloud')}
              label={LABELS.configSyncLinkAllCloud}
              suffix={`${syncOverview?.cloudProjectCandidates.length ?? 0} ${LABELS.configSyncCandidates}`}
            />
            <SyncActionRow
              confirm={pendingConfirm === 'unlink-all'}
              focused={cursor === actionCursor('unlink-all')}
              label={LABELS.configSyncUnlinkAll}
              suffix={`${syncOverview?.linkedProjects.length ?? 0} ${LABELS.configSyncLinked}`}
            />

            <Box flexDirection="column" marginTop={1}>
              <SyncProjectSection
                cursor={cursor}
                expanded={expandedSyncSections.linked}
                projects={syncSections.linked}
                sectionCursor={sectionCursor('linked')}
                title={LABELS.configSyncLinkedProjectsTitle}
              />
              <SyncProjectSection
                cursor={cursor}
                expanded={expandedSyncSections.local}
                projects={syncSections.local}
                sectionCursor={sectionCursor('local')}
                title={LABELS.configSyncUnlinkedProjectsTitle}
              />
              <SyncProjectSection
                cursor={cursor}
                expanded={expandedSyncSections.remote}
                projects={syncSections.remote}
                remoteScanning={remoteScanning}
                sectionCursor={sectionCursor('remote')}
                spinner={spinner}
                title={LABELS.configSyncRemoteProjectsTitle}
              />
            </Box>

            <CloudIconLegend focused={cursor === legendCursor} />
          </Box>
        )}
      </FeatureCard>
    </Box>
  )
}

function FeatureCard({ children, focused }: { children: ReactNode; focused: boolean }) {
  return (
    <Box
      borderColor={focused ? COLORS.accent : COLORS.border}
      borderStyle="single"
      flexDirection="column"
      paddingX={1}
    >
      {children}
    </Box>
  )
}

function SyncProjectSection({
  cursor,
  expanded,
  projects,
  remoteScanning = false,
  sectionCursor,
  spinner = '',
  title,
}: {
  cursor: number
  expanded: boolean
  projects: SyncProjectReport[]
  remoteScanning?: boolean
  sectionCursor: number
  spinner?: string
  title: string
}) {
  const focused = cursor === sectionCursor
  const hint = expanded ? LABELS.configSyncCollapseSection : LABELS.configSyncExpandSection

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box gap={1}>
        <Text color={focused ? COLORS.accent : COLORS.dim}>{focused ? '>' : ' '}</Text>
        <Text bold={focused} color={focused ? COLORS.text : COLORS.textSub}>
          {expanded ? '[-]' : '[+]'} {title}
        </Text>
        <Text color={COLORS.muted}>({projects.length})</Text>
        {remoteScanning ? (
          <Text color={COLORS.accent}>
            {spinner} {LABELS.configSyncRemoteScanning}
          </Text>
        ) : (
          <Text color={COLORS.dim}>{hint}</Text>
        )}
      </Box>

      {expanded && (
        <Box flexDirection="column" paddingLeft={2}>
          {projects.length === 0 && !remoteScanning ? (
            <Text color={COLORS.dim}>{LABELS.configSyncNone}</Text>
          ) : (
            projects.map((project, index) =>
              project.isShared ? (
                <SyncLinkedProjectRow
                  focused={cursor === sectionCursor + index + 1}
                  key={project.id}
                  project={project}
                />
              ) : (
                <SyncUnlinkedProjectRow
                  focused={cursor === sectionCursor + index + 1}
                  key={project.id}
                  project={project}
                />
              )
            )
          )}
        </Box>
      )}
    </Box>
  )
}

function CloudIconLegend({ focused }: { focused: boolean }) {
  return (
    <Box flexDirection="column" marginBottom={1} marginTop={1} paddingLeft={focused ? 0 : 3}>
      <Box gap={1}>
        <Text color={focused ? COLORS.accent : COLORS.dim}>{focused ? '>' : ' '}</Text>
        <Text color={COLORS.muted}>{LABELS.configCloudIconLegendTitle}:</Text>
        <Text color={COLORS.ok}>☁</Text>
        <Text color={COLORS.dim}>{LABELS.configCloudIconLinkedShort}</Text>
        <Text color={COLORS.orange}>☁</Text>
        <Text color={COLORS.dim}>{LABELS.configCloudIconUnlinkedUseShort}</Text>
        <Text color={COLORS.muted}>☁</Text>
        <Text color={COLORS.dim}>{LABELS.configCloudIconOfflineShort}</Text>
      </Box>
      {focused && (
        <Box flexDirection="column" paddingLeft={2}>
          <Box gap={1}>
            <Text color={COLORS.ok}>☁</Text>
            <Text color={COLORS.dim}>{LABELS.configCloudIconOnline}</Text>
          </Box>
          <Box gap={1}>
            <Text color={COLORS.orange}>☁</Text>
            <Text color={COLORS.dim}>{LABELS.configCloudIconPartial}</Text>
          </Box>
          <Box gap={1}>
            <Text color={COLORS.muted}>☁</Text>
            <Text color={COLORS.dim}>{LABELS.configCloudIconOffline}</Text>
          </Box>
        </Box>
      )}
    </Box>
  )
}

function SelectableRow({
  active,
  badge,
  description,
  focused,
  label,
  noBottomMargin,
  status,
}: {
  active: boolean
  badge?: string
  description: string
  focused: boolean
  label: string
  noBottomMargin?: boolean
  status?: string
}) {
  return (
    <Box flexDirection="column" marginBottom={noBottomMargin ? 0 : 1}>
      <Box gap={1}>
        <Text color={focused ? COLORS.accent : COLORS.dim}>{focused ? '>' : ' '}</Text>
        <Text bold={focused} color={focused ? COLORS.text : COLORS.textSub}>
          {label}
        </Text>
        {badge && <Text color={COLORS.muted}>{badge}</Text>}
        {status && <Text color={active ? COLORS.ok : COLORS.dim}>{status}</Text>}
      </Box>
      <Box paddingLeft={3}>
        <Text color={COLORS.dim}>{description}</Text>
      </Box>
    </Box>
  )
}

function SyncActionRow({
  confirm,
  disabled = false,
  focused,
  label,
  suffix,
}: {
  confirm: boolean
  disabled?: boolean
  focused: boolean
  label: string
  suffix: string
}) {
  return (
    <Box gap={1}>
      <Text color={focused && !disabled ? COLORS.accent : COLORS.dim}>{focused ? '>' : ' '}</Text>
      <Text bold={focused} color={disabled ? COLORS.muted : focused ? COLORS.text : COLORS.textSub}>
        {label}
      </Text>
      <Text color={disabled ? COLORS.muted : confirm ? COLORS.orange : COLORS.dim}>
        {confirm ? 'press enter again' : suffix}
      </Text>
    </Box>
  )
}

function SyncLinkedProjectRow({
  focused,
  project,
}: {
  focused: boolean
  project: SyncProjectReport
}) {
  const cloudColor = project.cloudOffline
    ? COLORS.muted
    : project.unlinkedDevices.length
      ? COLORS.orange
      : COLORS.ok
  const action = project.isActive ? 'active — cannot unlink' : 'enter to unlink'

  return (
    <Box gap={1}>
      <Box flexShrink={0} width={2}>
        <Text color={focused ? COLORS.accent : COLORS.dim}>{focused ? '>' : ''}</Text>
      </Box>
      <Text color={cloudColor}>☁</Text>
      <Text bold={focused} color={focused ? COLORS.text : COLORS.textSub}>
        {project.path}
      </Text>
      <Text color={project.isActive ? COLORS.muted : COLORS.dim}>{action}</Text>
    </Box>
  )
}

function SyncUnlinkedProjectRow({
  focused,
  project,
}: {
  focused: boolean
  project: SyncProjectReport
}) {
  const forgettable = !project.isRemoteProject && Boolean(project.cloudPath) && !project.isActive
  const action = project.isActive
    ? 'active — cannot change'
    : forgettable
      ? `enter to link · ${LABELS.configSyncForgetHint}`
      : 'enter to link'

  return (
    <Box gap={1}>
      <Box flexShrink={0} width={2}>
        <Text color={focused ? COLORS.accent : COLORS.dim}>{focused ? '>' : ''}</Text>
      </Box>
      <Text bold={focused} color={focused ? COLORS.text : COLORS.textSub}>
        {project.path}
      </Text>
      <Text color={COLORS.dim}>{action}</Text>
    </Box>
  )
}

export function runConfigApp(options: { initialTab?: Tab } = {}): Promise<void> {
  return new Promise<void>((resolve) => {
    const { waitUntilExit } = render(<ConfigApp initialTab={options.initialTab} />)
    waitUntilExit()
      .then(() => resolve())
      .catch(() => resolve())
  })
}
