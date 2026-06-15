import { useState } from 'react'
import { Box, Text, render, useApp, useInput } from 'ink'

import { COLORS } from '../config/theme.js'
import type { CleanupCandidate } from '../core/cleanup.js'
import { REASON_LABELS } from '../core/cleanup.js'
import { relativeTime } from '../utils/time.js'

interface CleanupPickerProps {
  candidates: CleanupCandidate[]
  onConfirm: (selected: CleanupCandidate[]) => void
  onAbort: () => void
}

function CleanupPicker({ candidates, onConfirm, onAbort }: CleanupPickerProps) {
  const { exit } = useApp()
  const [cursor, setCursor] = useState(0)
  const [selected, setSelected] = useState<Set<number>>(
    // Pre-select everything with score >= 85 (empty, orphaned, expired)
    () => new Set(candidates.map((_, i) => i).filter((i) => (candidates[i]?.score ?? 0) >= 85))
  )
  const [confirmed, setConfirmed] = useState(false)

  useInput((input, key) => {
    if (confirmed) return

    if (key.escape || input === 'q') {
      onAbort()
      exit()
      return
    }

    if (key.upArrow) {
      setCursor((c) => Math.max(0, c - 1))
      return
    }
    if (key.downArrow) {
      setCursor((c) => Math.min(candidates.length - 1, c + 1))
      return
    }

    if (input === ' ') {
      setSelected((prev) => {
        const next = new Set(prev)
        if (next.has(cursor)) next.delete(cursor)
        else next.add(cursor)
        return next
      })
      return
    }

    if (input === 'a') {
      setSelected((prev) =>
        prev.size === candidates.length ? new Set() : new Set(candidates.map((_, i) => i))
      )
      return
    }

    if (key.return) {
      const chosen = [...selected]
        .map((i) => candidates[i])
        .filter((c): c is CleanupCandidate => !!c)
      setConfirmed(true)
      onConfirm(chosen)
      exit()
    }
  })

  const selectedCount = selected.size

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      {/* Header */}
      <Box gap={1} marginBottom={1}>
        <Text bold color={COLORS.accent}>
          ccm cleanup
        </Text>
        <Text color={COLORS.muted}>—</Text>
        <Text color={COLORS.muted}>
          {candidates.length} candidate{candidates.length === 1 ? '' : 's'}
        </Text>
      </Box>

      {/* List */}
      {candidates.map((c, i) => {
        const isFocused = i === cursor
        const isSelected = selected.has(i)
        const sessionLabel = c.session.alias ?? c.session.name
        const shortId = c.session.id.slice(0, 8)

        return (
          <Box key={c.session.id} flexDirection="column" marginBottom={0}>
            <Box gap={1}>
              <Text color={isFocused ? COLORS.accent : COLORS.dim}>{isFocused ? '▶' : ' '}</Text>
              <Text color={isSelected ? COLORS.warn : COLORS.dim}>{isSelected ? '◉' : '○'}</Text>
              <Text bold={isFocused} color={isFocused ? COLORS.text : COLORS.textSub}>
                {sessionLabel}
              </Text>
              <Text color={COLORS.dim}>{shortId}</Text>
              <Text color={COLORS.dim}>·</Text>
              <Text color={COLORS.dim}>{relativeTime(c.session.updated)}</Text>
            </Box>
            <Box paddingLeft={4}>
              <Text color={COLORS.dim}>{c.reasons.map((r) => REASON_LABELS[r]).join('  ·  ')}</Text>
            </Box>
            <Box paddingLeft={4}>
              <Text color={COLORS.dim}>{c.projectPath}</Text>
            </Box>
          </Box>
        )
      })}

      {/* Footer */}
      <Box
        borderBottom={false}
        borderColor={COLORS.border}
        borderLeft={false}
        borderRight={false}
        borderStyle="single"
        borderTop={true}
        gap={2}
        marginTop={1}
        paddingX={1}
      >
        <Text color={COLORS.muted}>
          <Text color={COLORS.text}>↑↓</Text> nav
        </Text>
        <Text color={COLORS.muted}>
          <Text color={COLORS.text}>space</Text> select
        </Text>
        <Text color={COLORS.muted}>
          <Text color={COLORS.text}>a</Text> all/none
        </Text>
        <Text color={COLORS.muted}>
          <Text color={selectedCount > 0 ? COLORS.warn : COLORS.text}>enter</Text>{' '}
          {selectedCount > 0
            ? `archive ${selectedCount} session${selectedCount === 1 ? '' : 's'}`
            : 'confirm (nothing selected)'}
        </Text>
        <Text color={COLORS.muted}>
          <Text color={COLORS.text}>q</Text> cancel
        </Text>
      </Box>
    </Box>
  )
}

export function runCleanupPicker(
  candidates: CleanupCandidate[]
): Promise<CleanupCandidate[] | null> {
  return new Promise((resolve) => {
    const { waitUntilExit } = render(
      <CleanupPicker
        candidates={candidates}
        onAbort={() => resolve(null)}
        onConfirm={(chosen) => resolve(chosen)}
      />
    )
    waitUntilExit().catch(() => resolve(null))
  })
}
