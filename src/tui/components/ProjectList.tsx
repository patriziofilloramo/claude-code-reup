import { Box, Text } from 'ink'

import { LABELS } from '../../config/labels.js'
import { COLORS } from '../../config/theme.js'
import type { Project } from '../../core/session/session-model.js'
import { TUI_LAYOUT, compactProjectLabel, projectSessionCountLabel } from '../layout.js'
import type { ResolvedProjectPanelLayout } from '../layout.js'

interface ProjectListProps {
  isFocused: boolean
  layout: ResolvedProjectPanelLayout
  projects: Project[]
  selectedIndex: number
  totalCount: number
}

export default function ProjectList({
  isFocused,
  layout,
  projects,
  selectedIndex,
  totalCount,
}: ProjectListProps) {
  const labelColor = isFocused ? COLORS.accent : COLORS.dim

  return (
    <Box
      borderBottom={false}
      borderColor={COLORS.border}
      borderLeft={false}
      borderRight={layout.showRightBorder}
      borderStyle="single"
      borderTop={false}
      flexDirection="column"
      flexShrink={0}
      width={layout.width}
    >
      <Box gap={1} paddingX={1}>
        <Text bold color={labelColor}>
          {LABELS.wordProjects}
        </Text>
        <Text color={isFocused ? COLORS.accent : COLORS.dim}>({totalCount})</Text>
      </Box>

      {projects.map((project, index) => {
        const isSelected = index === selectedIndex
        const isFocusedSelected = isSelected && isFocused
        const projectLabel = compactProjectLabel(project.path)
        return (
          <Box key={project.id} paddingX={1}>
            <Box flexShrink={0}>
              <Text color={isFocusedSelected ? COLORS.accent : COLORS.border}>▶ </Text>
            </Box>
            <Box flexGrow={1} flexShrink={1} overflow="hidden">
              <Text color={isSelected ? COLORS.text : COLORS.muted} wrap="truncate">
                {projectLabel}
              </Text>
            </Box>
            {layout.showProjectGroups && project.groupName ? (
              <Box flexShrink={0} paddingLeft={1} width={TUI_LAYOUT.projectPanel.groupColumnWidth}>
                <Text color={COLORS.accent} wrap="truncate">
                  [{project.groupName}]
                </Text>
              </Box>
            ) : null}
            {layout.showSessionCounts ? (
              <Box flexShrink={0} width={layout.countColumnWidth}>
                <Text color={isFocusedSelected ? COLORS.accent : COLORS.dim}>
                  {projectSessionCountLabel(project.sessions.length)}
                </Text>
              </Box>
            ) : null}
          </Box>
        )
      })}
    </Box>
  )
}
