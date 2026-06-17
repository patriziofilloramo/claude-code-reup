import { Box, Text } from 'ink'

import { COLORS, SIZES } from '../../config/theme.js'
import type { Project } from '../../core/session/session-model.js'

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
  const labelColor = isFocused ? COLORS.accent : COLORS.dim

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
      width={SIZES.projectPanelWidth}
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
        const projectLabel = project.path.split(/[/\\]/).filter(Boolean).slice(-2).join('/')

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
            {project.isShared ? (
              <Box flexShrink={0} paddingLeft={1}>
                <Text
                  color={
                    project.cloudOffline
                      ? COLORS.muted
                      : project.unlinkedDevices?.length
                        ? COLORS.orange
                        : COLORS.ok
                  }
                >
                  {'☁'}
                </Text>
              </Box>
            ) : null}
            <Box flexShrink={0}>
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
