import { useEffect, useState } from 'react'
import { Box, Text, render, useApp, useInput } from 'ink'

import { COLORS } from '../config/theme.js'
import { readUserPrefs, setUserPref, type Density } from '../core/user-prefs.js'
import {
  isUsageStatusLineConfigured,
  removeUsageStatusLine,
  setupUsageStatusLine,
} from '../core/usage-statusline-integration.js'

const TABS = ['Interface', 'Integrations', 'Features'] as const
type Tab = (typeof TABS)[number]

// Highest cursor index per tab (-1 = no navigable items)
const TAB_CURSOR_MAX: Record<Tab, number> = {
  Interface: 1,    // 0 = compact, 1 = comfortable
  Integrations: 1, // 0 = usage statusline, 1 = shell completion
  Features: -1,
}

const COMPLETION_CMD =
  process.platform === 'win32'
    ? 'ccm completion powershell | Out-String | Invoke-Expression'
    : (process.env['SHELL'] ?? '').includes('zsh')
      ? 'eval "$(ccm completion zsh)"'
      : 'eval "$(ccm completion bash)"'

export function ConfigApp() {
  const { exit } = useApp()
  const [tabIndex, setTabIndex] = useState(0)
  const [cursor, setCursor] = useState(0)
  const [density, setDensity] = useState<Density>('compact')
  const [usageConfigured, setUsageConfigured] = useState<boolean | null>(null)
  const [statusMsg, setStatusMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void readUserPrefs().then(p => setDensity(p.density))
    void isUsageStatusLineConfigured().then(setUsageConfigured)
  }, [])

  const currentTab = TABS[tabIndex]!
  const maxCursor = TAB_CURSOR_MAX[currentTab]

  function switchTab(delta: number) {
    setTabIndex(i => (i + delta + TABS.length) % TABS.length)
    setCursor(0)
    setStatusMsg(null)
  }

  useInput((input, key) => {
    if (input === 'q' || key.escape) { exit(); return }

    if (key.tab || (key.rightArrow && !key.shift)) { switchTab(1); return }
    if (key.leftArrow) { switchTab(-1); return }

    if (key.upArrow) { setCursor(c => Math.max(0, c - 1)); setStatusMsg(null); return }
    if (key.downArrow && maxCursor >= 0) {
      setCursor(c => Math.min(maxCursor, c + 1))
      setStatusMsg(null)
      return
    }

    if ((input === ' ' || key.return) && !busy) void handleActivate()
  })

  async function handleActivate() {
    if (currentTab === 'Interface') {
      const next: Density = cursor === 0 ? 'compact' : 'comfortable'
      await setUserPref('density', next)
      setDensity(next)
      setStatusMsg({ text: `Saved: density = ${next}`, ok: true })
      return
    }

    if (currentTab === 'Integrations') {
      if (cursor === 0) {
        if (usageConfigured === null) return
        setBusy(true)
        try {
          if (usageConfigured) {
            const r = await removeUsageStatusLine()
            setUsageConfigured(false)
            setStatusMsg({
              text: r.changed
                ? 'Integration removed' + (r.restoredPrevious ? ' — previous status line restored' : '')
                : 'Was not configured',
              ok: true,
            })
          } else {
            try {
              await setupUsageStatusLine()
              setUsageConfigured(true)
              setStatusMsg({ text: 'Integration set up — restart Claude Code to activate', ok: true })
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err)
              if (msg.includes('existing') && msg.includes('--replace')) {
                setStatusMsg({ text: 'An existing status line is set — run: ccm usage setup --replace', ok: false })
              } else {
                setStatusMsg({ text: `Error: ${msg}`, ok: false })
              }
            }
          }
        } finally {
          setBusy(false)
        }
      }
      // cursor === 1 (shell completion) — info only, no action
    }
  }

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box gap={1} paddingX={1} paddingTop={1}>
        <Text bold color={COLORS.accent}>ccm</Text>
        <Text color={COLORS.muted}>config</Text>
      </Box>

      {/* Tab bar */}
      <Box gap={3} paddingX={1} paddingY={1}>
        {TABS.map((tab, i) => (
          <Text
            bold={i === tabIndex}
            color={i === tabIndex ? COLORS.text : COLORS.muted}
            key={tab}
            underline={i === tabIndex}
          >
            {tab}
          </Text>
        ))}
      </Box>

      {/* Content */}
      <Box flexDirection="column" minHeight={12} paddingX={2}>
        {currentTab === 'Interface' && (
          <InterfaceTab cursor={cursor} density={density} />
        )}
        {currentTab === 'Integrations' && (
          <IntegrationsTab busy={busy} cursor={cursor} usageConfigured={usageConfigured} />
        )}
        {currentTab === 'Features' && <FeaturesTab />}
      </Box>

      {/* Status message */}
      {statusMsg && (
        <Box paddingBottom={1} paddingX={2}>
          <Text color={statusMsg.ok ? COLORS.ok : COLORS.danger}>{statusMsg.text}</Text>
        </Box>
      )}

      {/* Hints */}
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
        <Text color={COLORS.muted}><Text color={COLORS.text}>↑↓</Text> nav</Text>
        <Text color={COLORS.muted}><Text color={COLORS.text}>enter</Text> select</Text>
        <Text color={COLORS.muted}><Text color={COLORS.text}>tab / ←→</Text> switch</Text>
        <Text color={COLORS.muted}><Text color={COLORS.text}>q</Text> quit</Text>
      </Box>
    </Box>
  )
}

function InterfaceTab({ cursor, density }: { cursor: number; density: Density }) {
  const options: { value: Density; label: string; desc: string }[] = [
    { value: 'compact', label: 'compact', desc: 'Single-line session rows, more visible at once' },
    { value: 'comfortable', label: 'comfortable', desc: 'Two-line rows with extra breathing room' },
  ]

  return (
    <Box flexDirection="column">
      <Text bold color={COLORS.text}>Session list density</Text>
      <Box flexDirection="column" marginTop={1}>
        {options.map((opt, i) => {
          const focused = i === cursor
          const active = opt.value === density
          return (
            <Box flexDirection="column" key={opt.value} marginBottom={1}>
              <Box gap={1}>
                <Text color={focused ? COLORS.accent : COLORS.dim}>{focused ? '▶' : ' '}</Text>
                <Text color={active ? COLORS.accent : COLORS.muted}>{active ? '◉' : '○'}</Text>
                <Text bold={active} color={focused ? COLORS.text : COLORS.textSub}>{opt.label}</Text>
              </Box>
              <Box paddingLeft={3}>
                <Text color={COLORS.dim}>{opt.desc}</Text>
              </Box>
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}

function IntegrationsTab({
  busy,
  cursor,
  usageConfigured,
}: {
  busy: boolean
  cursor: number
  usageConfigured: boolean | null
}) {
  return (
    <Box flexDirection="column" gap={1}>
      {/* Usage status line */}
      <Box flexDirection="column">
        <Box gap={1}>
          <Text color={cursor === 0 ? COLORS.accent : COLORS.dim}>{cursor === 0 ? '▶' : ' '}</Text>
          <Text bold color={cursor === 0 ? COLORS.text : COLORS.textSub}>Live usage status line</Text>
        </Box>
        <Box paddingLeft={3}>
          <Text color={COLORS.dim}>Captures rate-limit data by hooking Claude Code's status line</Text>
        </Box>
        <Box gap={1} paddingLeft={3}>
          {usageConfigured === null ? (
            <Text color={COLORS.dim}>checking…</Text>
          ) : usageConfigured ? (
            <>
              <Text color={COLORS.ok}>●</Text>
              <Text color={COLORS.textSub}>configured</Text>
              {!busy && <Text color={COLORS.dim}> — enter to remove</Text>}
            </>
          ) : (
            <>
              <Text color={COLORS.dim}>○</Text>
              <Text color={COLORS.muted}> not configured</Text>
              {!busy && <Text color={COLORS.dim}> — enter to set up</Text>}
            </>
          )}
          {busy && <Text color={COLORS.muted}> working…</Text>}
        </Box>
      </Box>

      {/* Shell completion */}
      <Box flexDirection="column" marginTop={1}>
        <Box gap={1}>
          <Text color={cursor === 1 ? COLORS.accent : COLORS.dim}>{cursor === 1 ? '▶' : ' '}</Text>
          <Text bold color={cursor === 1 ? COLORS.text : COLORS.textSub}>Shell completion</Text>
        </Box>
        <Box paddingLeft={3}>
          <Text color={COLORS.dim}>Tab-complete session IDs and commands in your terminal</Text>
        </Box>
        <Box paddingLeft={3}>
          <Text color={COLORS.dim}>○</Text>
          <Text color={COLORS.muted}> copy and paste this into your terminal to activate:</Text>
        </Box>
        <Box paddingLeft={5}>
          <Text color={cursor === 1 ? COLORS.muted : COLORS.dim}>{COMPLETION_CMD}</Text>
        </Box>
        <Box paddingLeft={5}>
          <Text color={COLORS.dim}>
            {process.platform === 'win32'
              ? 'Add to $PROFILE for permanent setup'
              : 'Add to your shell profile for permanent setup'}
          </Text>
        </Box>
      </Box>
    </Box>
  )
}

function FeaturesTab() {
  return (
    <Box flexDirection="column" gap={1}>
      <Text color={COLORS.muted}>No feature toggles yet.</Text>
      <Text color={COLORS.dim}>Planned: themes, auto-refresh interval, and more.</Text>
    </Box>
  )
}

export function runConfigApp(): Promise<void> {
  return new Promise<void>(resolve => {
    const { waitUntilExit } = render(<ConfigApp />)
    waitUntilExit()
      .then(() => resolve())
      .catch(() => resolve())
  })
}
