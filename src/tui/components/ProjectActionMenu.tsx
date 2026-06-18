import { useState } from 'react'
import { Box, Text, useInput } from 'ink'

import { COLORS } from '../../config/theme.js'
import type { Project } from '../../core/session/session-model.js'

export type ProjectActionCommand =
  | 'new-session'
  | 'browse-sessions'
  | 'open-directory'
  | 'copy-path'
  | 'forget-project'

interface Action {
  /** Single character pressed to trigger directly, or null for key-only actions. */
  directKey: string | null
  /** Display label for the key column. */
  keyLabel: string
  description: string
  command: ProjectActionCommand
}

const ACTIONS: Action[] = [
  { directKey: 'n', keyLabel: 'n', description: 'New session', command: 'new-session' },
  { directKey: null, keyLabel: '→', description: 'Browse sessions', command: 'browse-sessions' },
  { directKey: 'o', keyLabel: 'o', description: 'Open in file manager', command: 'open-directory' },
  { directKey: 'c', keyLabel: 'c', description: 'Copy path', command: 'copy-path' },
]

const FORGET_ACTION: Action = {
  command: 'forget-project',
  description: 'Forget local copy (recoverable)',
  directKey: 'f',
  keyLabel: 'f',
}

interface ProjectActionMenuProps {
  project: Project
  onExecute: (command: ProjectActionCommand) => void
  onClose: () => void
}

export default function ProjectActionMenu({ project, onExecute, onClose }: ProjectActionMenuProps) {
  const [focusedIndex, setFocusedIndex] = useState(0)
  const actions = project.cloudPath && !project.isShared ? [...ACTIONS, FORGET_ACTION] : ACTIONS

  const projectLabel = project.path.split(/[/\\]/).filter(Boolean).slice(-2).join('/')

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
    if (key.rightArrow) {
      onExecute('browse-sessions')
      return
    }
    if (key.return) {
      const action = actions[focusedIndex]
      if (action) onExecute(action.command)
      return
    }
    // Direct single-key execution
    const direct = actions.find((a) => a.directKey === input)
    if (direct) {
      onExecute(direct.command)
    }
  })

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={2} paddingY={1}>
      {/* Project context */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={COLORS.text}>
          {projectLabel}
        </Text>
        <Text color={COLORS.muted} wrap="truncate">
          {project.path}
        </Text>
      </Box>

      {/* Action list */}
      <Box flexDirection="column" gap={0}>
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
