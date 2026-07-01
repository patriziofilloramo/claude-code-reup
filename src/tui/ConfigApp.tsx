import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Box, Text, render, useApp, useInput } from 'ink'

import { LABELS } from '../config/labels.js'
import { COLORS } from '../config/theme.js'
import type { ThemeName } from '../config/theme-tokens.js'
import type { AutoCleanup } from '../core/user-prefs.js'
import { readUserPrefs, setUserPref } from '../core/user-prefs.js'
import {
  isUsageStatusLineConfigured,
  removeUsageStatusLine,
  setupUsageStatusLine,
} from '../core/usage/usage-statusline-integration.js'
import { copyToClipboard } from '../utils/system.js'

const TABS = ['Interface', 'Integrations', 'Features'] as const
type Tab = (typeof TABS)[number]

const TAB_CURSOR_MAX: Record<Tab, number> = {
  Interface: 2,
  Integrations: 3,
  Features: 0,
}

const SHELLS = [
  {
    label: 'PowerShell',
    cmd: 'reup completion powershell | Out-String | Invoke-Expression',
    profile: '$PROFILE',
  },
  {
    label: 'Bash',
    cmd: 'eval "$(reup completion bash)"',
    profile: '~/.bashrc or ~/.bash_profile',
  },
  {
    label: 'Zsh',
    cmd: 'eval "$(reup completion zsh)"',
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
}: {
  onClose?: () => void
  initialTab?: Tab
} = {}) {
  const { exit } = useApp()
  const initialTabIndex = initialTab ? Math.max(0, TABS.indexOf(initialTab)) : 0
  const [tabIndex, setTabIndex] = useState(initialTabIndex)
  const [cursor, setCursor] = useState(0)
  const [theme, setTheme] = useState<ThemeName>('dark')
  const [autoCleanupOnStart, setAutoCleanupOnStart] = useState<AutoCleanup>('off')
  const [usageConfigured, setUsageConfigured] = useState<boolean | null>(null)
  const [statusMsg, setStatusMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [copiedShellIndex, setCopiedShellIndex] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void readUserPrefs().then((prefs) => {
      setTheme(prefs.theme)
      setAutoCleanupOnStart(prefs.autoCleanupOnStart)
    })
    void isUsageStatusLineConfigured().then(setUsageConfigured)
  }, [])

  const currentTab = TABS[tabIndex]!
  const maxCursor = TAB_CURSOR_MAX[currentTab]

  function switchTab(delta: number): void {
    setTabIndex((index) => (index + delta + TABS.length) % TABS.length)
    setCursor(0)
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
      setStatusMsg(null)
      return
    }
    if (key.downArrow && maxCursor >= 0) {
      setCursor((value) => Math.min(maxCursor, value + 1))
      setStatusMsg(null)
      return
    }
    if ((input === ' ' || key.return) && !busy) void handleActivate()
  })

  async function handleActivate(): Promise<void> {
    if (currentTab === 'Interface') {
      const themes: ThemeName[] = ['dark', 'light', 'terminal']
      const next = themes[cursor] ?? 'dark'
      await setUserPref('theme', next)
      setTheme(next)
      setStatusMsg({ ok: true, text: `Theme set to ${next}; restart reup to apply` })
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
    const cycle: Record<AutoCleanup, AutoCleanup> = { off: 'on', on: 'auto', auto: 'off' }
    const next = cycle[autoCleanupOnStart]
    await setUserPref('autoCleanupOnStart', next)
    setAutoCleanupOnStart(next)
    setStatusMsg({ ok: true, text: `Cleanup on start: ${next}` })
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
          <FeaturesTab autoCleanupOnStart={autoCleanupOnStart} cursor={cursor} />
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
          <Text color={COLORS.text}>{LABELS.configKeyUpDown}</Text> {LABELS.wordNav}
        </Text>
        <Text color={COLORS.muted}>
          <Text color={COLORS.text}>{LABELS.configKeyEnter}</Text> {LABELS.configSelect}
        </Text>
        <Text color={COLORS.muted}>
          <Text color={COLORS.text}>{LABELS.configKeyTabLeftRight}</Text> {LABELS.configHintSwitch}
        </Text>
        <Text color={COLORS.muted}>
          <Text color={COLORS.text}>{onClose ? 'esc / q' : 'q'}</Text>
          {onClose ? ' back to reup' : ' quit'}
        </Text>
      </Box>
    </Box>
  )
}

function InterfaceTab({ cursor, theme }: { cursor: number; theme: ThemeName }) {
  const options: Array<{ description: string; label: ThemeName }> = [
    { label: 'dark', description: 'High contrast dark theme' },
    { label: 'light', description: 'Bright theme for light terminals' },
    { label: 'terminal', description: 'Use terminal default colors' },
  ]

  return (
    <Box flexDirection="column" gap={1}>
      <FeatureCard focused={true}>
        <Box flexDirection="column">
          <Text bold color={COLORS.text}>
            {LABELS.configColorThemeTitle}
          </Text>
          <Text color={COLORS.dim}>{LABELS.configColorThemeDesc}</Text>
          <Box flexDirection="column" marginTop={1}>
            {options.map((option, index) => (
              <SelectableRow
                active={theme === option.label}
                description={option.description}
                focused={cursor === index}
                key={option.label}
                label={option.label}
                status={theme === option.label ? 'active' : undefined}
              />
            ))}
          </Box>
        </Box>
      </FeatureCard>
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
  const usageFocused = cursor === 0

  return (
    <Box flexDirection="column" gap={1}>
      <FeatureCard focused={usageFocused}>
        <SelectableRow
          active={usageConfigured === true}
          description={LABELS.configLiveUsageDesc}
          focused={usageFocused}
          label={LABELS.configLiveUsageTitle}
          status={busy ? LABELS.configWorking : usageConfigured ? 'on' : 'off'}
        />
      </FeatureCard>

      <FeatureCard focused={cursor >= 1}>
        <Box flexDirection="column">
          <Text bold color={COLORS.text}>
            {LABELS.configShellCompletionTitle}
          </Text>
          <Text color={COLORS.dim}>{LABELS.configShellCompletionDesc}</Text>
          {DISPLAY_SHELLS.map((shell, index) => {
            const shellCursor = index + 1
            const focused = cursor === shellCursor
            return (
              <Box flexDirection="column" key={shell.label} marginTop={1}>
                <Box gap={1}>
                  <Text color={focused ? COLORS.accent : COLORS.dim}>{focused ? '>' : ' '}</Text>
                  <Text bold={focused} color={focused ? COLORS.text : COLORS.textSub}>
                    {shell.label}
                  </Text>
                  {shell.detected && (
                    <Text bold color={COLORS.ok} inverse>
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
  autoCleanupOnStart,
  cursor,
}: {
  autoCleanupOnStart: AutoCleanup
  cursor: number
}) {
  const cleanupLabel =
    autoCleanupOnStart === 'on' ? 'on' : autoCleanupOnStart === 'auto' ? 'auto' : 'off'

  return (
    <Box flexDirection="column" gap={1}>
      <FeatureCard focused={cursor === 0}>
        <SelectableRow
          active={autoCleanupOnStart !== 'off'}
          description={
            autoCleanupOnStart === 'off'
              ? 'No automatic cleanup. Run `reup cleanup` manually.'
              : autoCleanupOnStart === 'auto'
                ? 'Archives high-confidence cleanup candidates automatically on startup.'
                : 'Shows cleanup picker before opening reup; you choose what to archive.'
          }
          focused={cursor === 0}
          label="Cleanup on start"
          status={cleanupLabel}
        />
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

export function runConfigApp(options: { initialTab?: Tab } = {}): Promise<void> {
  return new Promise<void>((resolve) => {
    const { waitUntilExit } = render(<ConfigApp initialTab={options.initialTab} />)
    waitUntilExit()
      .then(() => resolve())
      .catch(() => resolve())
  })
}
