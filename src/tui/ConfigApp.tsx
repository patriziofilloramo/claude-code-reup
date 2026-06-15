import { useEffect, useMemo, useState } from 'react'
import { Box, Text, render, useApp, useInput } from 'ink'

import { COLORS } from '../config/theme.js'
import type { ThemeName } from '../config/theme-tokens.js'
import { linkProjectForTUI, unlinkProjectForTUI } from '../cli/sync-command.js'
import { loadProjects } from '../core/project/project-discovery.js'
import type { Project } from '../core/session/session-model.js'
import type { AutoCleanup } from '../core/user-prefs.js'
import { readUserPrefs, setUserPref } from '../core/user-prefs.js'
import {
  isUsageStatusLineConfigured,
  removeUsageStatusLine,
  setupUsageStatusLine,
} from '../core/usage/usage-statusline-integration.js'

const TABS = ['Interface', 'Integrations', 'Features', 'Sync'] as const
type Tab = (typeof TABS)[number]

// Highest cursor index per tab (-1 = no navigable items)
const TAB_CURSOR_MAX: Record<Tab, number> = {
  Interface: 2, // 0 = dark, 1 = light, 2 = terminal
  Integrations: 1, // 0 = usage statusline, 1 = shell completion
  Features: 0, // 0 = autoCleanupOnStart
  Sync: -1, // info-only
}

const COMPLETION_CMD =
  process.platform === 'win32'
    ? 'ccm completion powershell | Out-String | Invoke-Expression'
    : (process.env['SHELL'] ?? '').includes('zsh')
      ? 'eval "$(ccm completion zsh)"'
      : 'eval "$(ccm completion bash)"'

export function ConfigApp({ onClose }: { onClose?: () => void } = {}) {
  const { exit } = useApp()
  const [tabIndex, setTabIndex] = useState(0)
  const [cursor, setCursor] = useState(0)
  const [theme, setTheme] = useState<ThemeName>('dark')
  const [autoCleanupOnStart, setAutoCleanupOnStart] = useState<AutoCleanup>('off')
  const [usageConfigured, setUsageConfigured] = useState<boolean | null>(null)
  const [statusMsg, setStatusMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [projects, setProjects] = useState<Project[]>([])

  useEffect(() => {
    void readUserPrefs().then((p) => {
      setTheme(p.theme)
      setAutoCleanupOnStart(p.autoCleanupOnStart)
    })
    void isUsageStatusLineConfigured().then(setUsageConfigured)
    void loadProjects().then(setProjects)
  }, [])

  const currentTab = TABS[tabIndex]!

  const syncLinkable = useMemo(() => projects.filter((p) => !p.isShared), [projects])
  const syncLinked = useMemo(() => projects.filter((p) => p.isShared), [projects])
  const syncCursorMax = Math.max(-1, syncLinkable.length + syncLinked.length - 1)

  const maxCursor = currentTab === 'Sync' ? syncCursorMax : TAB_CURSOR_MAX[currentTab]!

  function switchTab(delta: number) {
    setTabIndex((i) => (i + delta + TABS.length) % TABS.length)
    setCursor(0)
    setStatusMsg(null)
  }

  useInput((input, key) => {
    if (input === 'q' || key.escape) {
      if (onClose) onClose()
      else exit()
      return
    }

    if (key.tab || (key.rightArrow && !key.shift)) {
      switchTab(1)
      return
    }
    if (key.leftArrow) {
      switchTab(-1)
      return
    }

    if (key.upArrow) {
      setCursor((c) => Math.max(0, c - 1))
      setStatusMsg(null)
      return
    }
    if (key.downArrow && maxCursor >= 0) {
      setCursor((c) => Math.min(maxCursor, c + 1))
      setStatusMsg(null)
      return
    }

    if ((input === ' ' || key.return) && !busy) void handleActivate()
  })

  async function handleActivate() {
    if (currentTab === 'Interface') {
      const themes: ThemeName[] = ['dark', 'light', 'terminal']
      const next = themes[cursor] ?? 'dark'
      await setUserPref('theme', next)
      setTheme(next)
      setStatusMsg({ text: `Theme set to ${next} — restart ccm to apply`, ok: true })
      return
    }

    if (currentTab === 'Features') {
      if (cursor === 0) {
        const cycle: Record<AutoCleanup, AutoCleanup> = { off: 'on', on: 'auto', auto: 'off' }
        const next = cycle[autoCleanupOnStart]
        await setUserPref('autoCleanupOnStart', next)
        setAutoCleanupOnStart(next)
        setStatusMsg({ text: `Cleanup on start: ${next}`, ok: true })
      }
      return
    }

    if (currentTab === 'Sync') {
      if (syncCursorMax < 0) return
      setBusy(true)
      try {
        let result: { ok: boolean; message: string }
        if (cursor < syncLinkable.length) {
          result = await linkProjectForTUI(syncLinkable[cursor]!.path, projects)
        } else {
          result = await unlinkProjectForTUI(
            syncLinked[cursor - syncLinkable.length]!.path,
            projects
          )
        }
        setStatusMsg({ text: result.message.split('\n')[0]!, ok: result.ok })
        const updated = await loadProjects()
        setProjects(updated)
        const newMax = Math.max(
          -1,
          updated.filter((p) => !p.isShared).length + updated.filter((p) => p.isShared).length - 1
        )
        if (cursor > newMax) setCursor(Math.max(0, newMax))
      } catch (e) {
        setStatusMsg({ text: e instanceof Error ? e.message : 'operation failed', ok: false })
      } finally {
        setBusy(false)
      }
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
                ? 'Integration removed' +
                  (r.restoredPrevious ? ' — previous status line restored' : '')
                : 'Was not configured',
              ok: true,
            })
          } else {
            try {
              await setupUsageStatusLine()
              setUsageConfigured(true)
              setStatusMsg({
                text: 'Integration set up — restart Claude Code to activate',
                ok: true,
              })
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err)
              if (msg.includes('existing') && msg.includes('--replace')) {
                setStatusMsg({
                  text: 'An existing status line is set — run: ccm usage setup --replace',
                  ok: false,
                })
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
        <Text bold color={COLORS.accent}>
          ccm
        </Text>
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
        {currentTab === 'Interface' && <InterfaceTab cursor={cursor} theme={theme} />}
        {currentTab === 'Integrations' && (
          <IntegrationsTab busy={busy} cursor={cursor} usageConfigured={usageConfigured} />
        )}
        {currentTab === 'Features' && (
          <FeaturesTab autoCleanupOnStart={autoCleanupOnStart} cursor={cursor} />
        )}
        {currentTab === 'Sync' && (
          <SyncTab busy={busy} cursor={cursor} linkable={syncLinkable} linked={syncLinked} />
        )}
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
        <Text color={COLORS.muted}>
          <Text color={COLORS.text}>↑↓</Text> nav
        </Text>
        <Text color={COLORS.muted}>
          <Text color={COLORS.text}>enter</Text> select
        </Text>
        <Text color={COLORS.muted}>
          <Text color={COLORS.text}>tab / ←→</Text> switch
        </Text>
        <Text color={COLORS.muted}>
          <Text color={COLORS.text}>{onClose ? 'esc / q' : 'q'}</Text>
          {onClose ? ' back to ccm' : ' quit'}
        </Text>
      </Box>
    </Box>
  )
}

function InterfaceTab({ cursor, theme }: { cursor: number; theme: ThemeName }) {
  const options: { value: ThemeName; label: string; desc: string }[] = [
    { value: 'dark', label: 'dark', desc: 'Dark background — default' },
    { value: 'light', label: 'light', desc: 'Light background — high contrast in bright rooms' },
    { value: 'terminal', label: 'terminal', desc: 'Phosphor green on near-black — CRT aesthetic' },
  ]

  return (
    <Box flexDirection="column">
      <Text bold color={COLORS.text}>
        Color theme
      </Text>
      <Text color={COLORS.dim}>Takes effect when ccm is restarted. The web UI switches live.</Text>
      <Box flexDirection="column" marginTop={1}>
        {options.map((opt, i) => {
          const focused = i === cursor
          const active = opt.value === theme
          return (
            <Box flexDirection="column" key={opt.value} marginBottom={1}>
              <Box gap={1}>
                <Text color={focused ? COLORS.accent : COLORS.dim}>{focused ? '▶' : ' '}</Text>
                <Text color={active ? COLORS.accent : COLORS.muted}>{active ? '◉' : '○'}</Text>
                <Text bold={active} color={focused ? COLORS.text : COLORS.textSub}>
                  {opt.label}
                </Text>
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
          <Text bold color={cursor === 0 ? COLORS.text : COLORS.textSub}>
            Live usage status line
          </Text>
          {usageConfigured === null ? (
            <Text color={COLORS.dim}>…</Text>
          ) : usageConfigured ? (
            <Text color={COLORS.ok}>● on</Text>
          ) : (
            <Text color={COLORS.dim}>○ off</Text>
          )}
          {busy && <Text color={COLORS.muted}> working…</Text>}
        </Box>
        <Box paddingLeft={3}>
          <Text color={COLORS.dim}>
            Captures rate-limit data by hooking Claude Code's status line
          </Text>
        </Box>
        {!busy && usageConfigured !== null && (
          <Box paddingLeft={3}>
            <Text color={COLORS.dim}>
              {usageConfigured ? '— enter to remove' : '— enter to set up'}
            </Text>
          </Box>
        )}
      </Box>

      {/* Shell completion */}
      <Box flexDirection="column" marginTop={1}>
        <Box gap={1}>
          <Text color={cursor === 1 ? COLORS.accent : COLORS.dim}>{cursor === 1 ? '▶' : ' '}</Text>
          <Text bold color={cursor === 1 ? COLORS.text : COLORS.textSub}>
            Shell completion
          </Text>
          <Text color={COLORS.dim}>○ manual setup</Text>
        </Box>
        <Box paddingLeft={3}>
          <Text color={COLORS.dim}>Tab-complete session IDs and commands in your terminal</Text>
        </Box>
        <Box paddingLeft={3}>
          <Text color={cursor === 1 ? COLORS.muted : COLORS.dim}>{COMPLETION_CMD}</Text>
        </Box>
        <Box paddingLeft={3}>
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

function FeaturesTab({
  autoCleanupOnStart,
  cursor,
}: {
  autoCleanupOnStart: AutoCleanup
  cursor: number
}) {
  const stateColor = autoCleanupOnStart !== 'off' ? COLORS.ok : COLORS.dim
  const stateLabel =
    autoCleanupOnStart === 'on' ? '● on' : autoCleanupOnStart === 'auto' ? '● auto' : '○ off'
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Box gap={1}>
          <Text color={cursor === 0 ? COLORS.accent : COLORS.dim}>{cursor === 0 ? '▶' : ' '}</Text>
          <Text bold color={cursor === 0 ? COLORS.text : COLORS.textSub}>
            Cleanup on start
          </Text>
          <Text color={stateColor}>{stateLabel}</Text>
        </Box>
        <Box paddingLeft={3}>
          <Text color={COLORS.dim}>
            {autoCleanupOnStart === 'on' &&
              'Shows cleanup picker before opening ccm — you choose what to archive.'}
            {autoCleanupOnStart === 'auto' &&
              'Archives high-confidence cleanup candidates automatically on startup.'}
            {autoCleanupOnStart === 'off' && 'No automatic cleanup. Run `ccm cleanup` manually.'}
          </Text>
        </Box>
        {autoCleanupOnStart !== 'off' && (
          <Box paddingLeft={3}>
            <Text color={COLORS.dim}>Skipped if no candidates are found.</Text>
          </Box>
        )}
      </Box>
    </Box>
  )
}

function SyncTab({
  busy,
  cursor,
  linkable,
  linked,
}: {
  busy: boolean
  cursor: number
  linkable: Project[]
  linked: Project[]
}) {
  const cursorInLinkable = linkable.length > 0 && cursor < linkable.length
  const cursorInLinked = linked.length > 0 && cursor >= linkable.length

  return (
    <Box flexDirection="column" gap={1}>
      {/* Cloud icon legend */}
      <Box flexDirection="column">
        <Text bold color={COLORS.text}>
          Cloud icon legend
        </Text>
        <Box gap={1} marginTop={1}>
          <Text color={COLORS.ok}>☁</Text>
          <Text color={COLORS.textSub}>online — sessions syncing to cloud</Text>
        </Box>
        <Box gap={1}>
          <Text color={COLORS.orange}>☁</Text>
          <Text color={COLORS.textSub}>partial — linked here, missing on other devices</Text>
        </Box>
        <Box gap={1}>
          <Text color={COLORS.muted}>☁</Text>
          <Text color={COLORS.textSub}>offline — cloud folder temporarily unreachable</Text>
        </Box>
      </Box>

      {/* Unsynced projects */}
      {linkable.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Box gap={2}>
            <Text bold color={COLORS.text}>{`Unsynced projects (${linkable.length})`}</Text>
            {cursorInLinkable && (
              <Text color={COLORS.dim}>{busy ? 'linking…' : 'enter to link →'}</Text>
            )}
          </Box>
          {linkable.map((p, i) => {
            const focused = cursor === i
            return (
              <Box key={p.id} gap={1}>
                <Text color={focused ? COLORS.accent : COLORS.dim}>{focused ? '▶' : ' '}</Text>
                <Text bold={focused} color={focused ? COLORS.text : COLORS.textSub}>
                  {p.path}
                </Text>
              </Box>
            )
          })}
        </Box>
      )}

      {/* Synced projects */}
      {linked.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Box gap={2}>
            <Text bold color={COLORS.text}>{`Synced projects (${linked.length})`}</Text>
            {cursorInLinked && (
              <Text color={COLORS.dim}>{busy ? 'unlinking…' : 'enter to unlink →'}</Text>
            )}
          </Box>
          {linked.map((p, i) => {
            const globalIdx = linkable.length + i
            const focused = cursor === globalIdx
            const iconColor = p.cloudOffline
              ? COLORS.muted
              : p.unlinkedDevices?.length
                ? COLORS.orange
                : COLORS.ok
            const statusLabel = p.cloudOffline
              ? 'offline'
              : p.unlinkedDevices?.length
                ? `${p.unlinkedDevices.length} device(s) not linked`
                : 'online'
            return (
              <Box key={p.id} gap={1}>
                <Text color={focused ? COLORS.accent : COLORS.dim}>{focused ? '▶' : ' '}</Text>
                <Text color={iconColor}>☁</Text>
                <Text bold={focused} color={focused ? COLORS.text : COLORS.textSub}>
                  {p.path}
                </Text>
                <Text color={COLORS.dim}>{statusLabel}</Text>
              </Box>
            )
          })}
        </Box>
      )}

      {/* Empty state */}
      {linkable.length === 0 && linked.length === 0 && (
        <Box marginTop={1}>
          <Text color={COLORS.dim}>loading…</Text>
        </Box>
      )}
    </Box>
  )
}

export function runConfigApp(): Promise<void> {
  return new Promise<void>((resolve) => {
    const { waitUntilExit } = render(<ConfigApp />)
    waitUntilExit()
      .then(() => resolve())
      .catch(() => resolve())
  })
}
