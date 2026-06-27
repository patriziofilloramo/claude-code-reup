import { Box, Text, useStdout } from 'ink'

import { COLORS } from '../../config/theme.js'
import type { Project } from '../../core/session/session-model.js'
import {
  getProjectSyncStatus,
  isProjectMemorySyncEnabled,
} from '../../core/sync/project-sync-status.js'
import { compactProjectLabel, projectPanelLayoutForTerminal } from '../layout.js'

interface ProjectListProps {
  isFocused: boolean
  projects: Project[]
  selectedIndex: number
  totalCount: number
}

export default function ProjectList({
  isFocused,
  projects,
  selectedIndex,
  totalCount,
}: ProjectListProps) {
  const { stdout } = useStdout()
  const terminalWidth = stdout?.columns ?? 80
  const labelColor = isFocused ? COLORS.accent : COLORS.dim
  const projectMemorySyncEnabled = isProjectMemorySyncEnabled()
  const projectPanelLayout = projectPanelLayoutForTerminal(terminalWidth, projects)

  return (
    <Box
      borderBottom={false}
      borderColor={COLORS.border}
      borderLeft={false}
      borderRight={true}
      borderStyle="single"
      borderTop={false}
      flexDirection="column"
      flexShrink={0}
      width={projectPanelLayout.width}
    >
      <Box gap={1} paddingX={1}>
        <Text bold color={labelColor}>
          projects
        </Text>
        <Text color={isFocused ? COLORS.accent : COLORS.dim}>({totalCount})</Text>
      </Box>

      {projects.map((project, index) => {
        const isSelected = index === selectedIndex
        const isFocusedSelected = isSelected && isFocused
        const projectLabel = compactProjectLabel(project.path)
        const syncStatus = getProjectSyncStatus(project, projectMemorySyncEnabled)
        const cloudColor =
          syncStatus === 'grey' ? COLORS.muted : syncStatus === 'orange' ? COLORS.orange : COLORS.ok

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
            {projectPanelLayout.showProjectGroups && project.groupName ? (
              <Box flexShrink={0} paddingLeft={1} width={14}>
                <Text color={COLORS.accent} wrap="truncate">
                  [{project.groupName}]
                </Text>
              </Box>
            ) : null}
            <Box flexShrink={0} paddingLeft={1} width={4}>
              {syncStatus && syncStatus !== 'none' ? (
                <Text color={cloudColor}>{'☁'}</Text>
              ) : (
                <Text> </Text>
              )}
            </Box>
            <Box flexShrink={0} width={7}>
              <Text color={isFocusedSelected ? COLORS.accent : COLORS.dim}>
                {' (' + project.sessions.length + ')'}
              </Text>
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}
