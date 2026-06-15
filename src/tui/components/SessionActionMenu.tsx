import { useState } from 'react'
import { Box, Text, useInput } from 'ink'

import { COLORS } from '../../config/theme.js'
import type { Session } from '../../core/session-model.js'
import { primaryStatus } from '../../core/session-signals.js'

export type SessionActionCommand =
  | 'resume'
  | 'select'
  | 'archive'
  | 'copy-id'
  | 'handoff'
  | 'delete'

interface Action {
  directKey: string | null
  keyLabel: string
  description: string
  command: SessionActionCommand
}

function buildActions(session: Session, isBulkSelected: boolean): Action[] {
  return [
    { directKey: null, keyLabel: '↵', description: 'Resume session', command: 'resume' },
    {
      directKey: 's',
      keyLabel: 's',
      description: isBulkSelected ? 'Deselect' : 'Select for bulk',
      command: 'select',
    },
    {
      directKey: 'A',
      keyLabel: 'A',
      description: session.signals.archived ? 'Unarchive' : 'Archive',
      command: 'archive',
    },
    { directKey: 'h', keyLabel: 'h', description: 'Copy handoff packet', command: 'handoff' },
    { directKey: 'c', keyLabel: 'c', description: 'Copy session ID', command: 'copy-id' },
    { directKey: 'D', keyLabel: 'D', description: 'Delete permanently', command: 'delete' },
  ]
}

interface SessionActionMenuProps {
  isActive: boolean
  isBulkSelected: boolean
  session: Session
  onExecute: (command: SessionActionCommand) => void
  onClose: () => void
}

export default function SessionActionMenu({
  isActive,
  isBulkSelected,
  session,
  onExecute,
  onClose,
}: SessionActionMenuProps) {
  const [focusedIndex, setFocusedIndex] = useState(0)

  const actions = buildActions(session, isBulkSelected)
  const displayName = session.alias ?? session.name
  const branch = session.currentBranch ?? session.gitBranch ?? null
  const status = primaryStatus(session.signals)
  const needsAttention = status !== 'ok' && status !== 'heavily-compacted'

  useInput((input, key) => {
    if (key.escape || input === '\x1b') {
      onClose()
      return
    }

    if (key.upArrow) {
      setFocusedIndex((i) => Math.max(0, i - 1))
      return
    }
    if (key.downArrow) {
      setFocusedIndex((i) => Math.min(actions.length - 1, i + 1))
      return
    }
    if (key.return) {
      const action = actions[focusedIndex]
      if (action) onExecute(action.command)
      return
    }

    const direct = actions.find((a) => a.directKey === input)
    if (direct) {
      onExecute(direct.command)
    }
  })

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={2} paddingY={1}>
      {/* Session context */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={COLORS.text} wrap="truncate">
          {displayName}
        </Text>
        <Box gap={2}>
          {branch ? (
            <Text color={COLORS.dim} wrap="truncate">
              {branch}
            </Text>
          ) : null}
          {isActive ? <Text color={COLORS.ok}>● active</Text> : null}
          {needsAttention ? (
            <Text
              color={
                status === 'expiring' || status === 'path-missing' ? COLORS.danger : COLORS.warn
              }
            >
              {'! ' + status.replace('-', ' ')}
            </Text>
          ) : null}
        </Box>
      </Box>

      {/* Action list */}
      <Box flexDirection="column">
        {actions.map((action, index) => {
          const isFocused = index === focusedIndex
          return (
            <Box key={action.command} gap={2}>
              <Box flexShrink={0}>
                <Text color={isFocused ? COLORS.accent : COLORS.border}>
                  {isFocused ? '▶' : ' '}
                </Text>
              </Box>
              <Box flexShrink={0} width={3}>
                <Text color={isFocused ? COLORS.accent : COLORS.dim}>{action.keyLabel}</Text>
              </Box>
              <Text color={isFocused ? COLORS.text : COLORS.textSub}>{action.description}</Text>
            </Box>
          )
        })}
      </Box>

      {/* Footer hint */}
      <Box marginTop={1}>
        <Text color={COLORS.muted}>
          <Text color={COLORS.dim}>↑↓</Text>
          {' nav  '}
          <Text color={COLORS.dim}>enter</Text>
          {' run  '}
          <Text color={COLORS.dim}>esc</Text>
          {' close'}
        </Text>
      </Box>
    </Box>
  )
}
