import { useEffect, useState } from 'react'
import { Box, Text, render, useApp, useInput, useStdout } from 'ink'

import { COLORS } from '../config/theme.js'
import type { Project } from '../core/session/session-model.js'
import { createVisibleWindow } from './session-view.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PickerItem = { kind: 'all' } | { kind: 'project'; project: Project }

const PICKER_CHROME_ROWS = 6

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function ProjectPicker({
  projects,
  note,
  title = 'CCM SYNC LINK',
  subtitle = 'select a project to link',
  onSelect,
}: {
  projects: Project[]
  note?: string
  title?: string
  subtitle?: string
  onSelect: (selected: Project[]) => void
}) {
  const { exit } = useApp()
  const { stdout } = useStdout()
  const [query, setQuery] = useState('')
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)

  const filtered = query
    ? projects.filter((p) => p.path.toLowerCase().includes(query.toLowerCase()))
    : projects

  const showAll = filtered.length > 1

  const items: PickerItem[] = [
    ...(showAll ? [{ kind: 'all' as const }] : []),
    ...filtered.map((p) => ({ kind: 'project' as const, project: p })),
  ]

  const maximumVisibleRows = Math.max(4, (stdout?.rows ?? 20) - PICKER_CHROME_ROWS)
  const [visibleItems, visibleSelectedIndex] = createVisibleWindow(
    items,
    selectedIndex,
    maximumVisibleRows
  )

  useEffect(() => setSelectedIndex(0), [query])

  useInput((input, key) => {
    const esc = key.escape || input === '\x1b'

    if (isSearchOpen) {
      if (esc) {
        setIsSearchOpen(false)
        setQuery('')
        return
      }
      if (key.backspace || key.delete) {
        setQuery((q) => q.slice(0, -1))
        return
      }
      if (!key.upArrow && !key.downArrow && !key.return && input && !key.ctrl && !key.meta) {
        setQuery((q) => q + input)
        return
      }
    }

    if (esc || input === 'q') {
      exit()
      return
    }
    if (input === '/') {
      setIsSearchOpen(true)
      return
    }
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1))
      return
    }
    if (key.downArrow) {
      setSelectedIndex((i) => Math.min(Math.max(0, items.length - 1), i + 1))
      return
    }
    if (!key.return) return

    const item = items[selectedIndex]
    if (!item) return

    if (item.kind === 'all') {
      onSelect(filtered)
    } else {
      onSelect([item.project])
    }
    exit()
  })

  return (
    <Box flexDirection="column">
      <Box gap={1} paddingX={1}>
        <Text bold color={COLORS.accent}>
          {title}
        </Text>
        <Text color={COLORS.dim}>
          {filtered.length} project{filtered.length !== 1 ? 's' : ''}
        </Text>
      </Box>
      <Box paddingX={1}>
        <Text color={note ? COLORS.warn : COLORS.muted} wrap="truncate">
          {isSearchOpen ? `search: ${query}` : (note ?? subtitle)}
        </Text>
      </Box>
      <Box flexDirection="column" marginY={1}>
        {items.length === 0 ? (
          <Box paddingX={1}>
            <Text color={COLORS.muted}>No projects match.</Text>
          </Box>
        ) : (
          visibleItems.map((item, index) =>
            item.kind === 'all' ? (
              <AllRow
                key="all"
                isSelected={index === visibleSelectedIndex}
                count={filtered.length}
              />
            ) : (
              <ProjectPickerRow
                key={item.project.id}
                isSelected={index === visibleSelectedIndex}
                project={item.project}
              />
            )
          )
        )}
      </Box>
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
          <Text color={COLORS.ok}>▶ enter</Text> link
        </Text>
        <Text color={COLORS.muted}>
          <Text color={COLORS.text}>/</Text> search
        </Text>
        <Text color={COLORS.muted}>
          <Text color={COLORS.text}>↑↓</Text> navigate
        </Text>
        <Text color={COLORS.muted}>
          <Text color={COLORS.text}>esc</Text> cancel
        </Text>
      </Box>
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

function AllRow({ isSelected, count }: { isSelected: boolean; count: number }) {
  return (
    <Box gap={1} paddingX={1}>
      <Text color={isSelected ? COLORS.accent : COLORS.dim}>{isSelected ? '>' : ' '}</Text>
      <Text bold={isSelected} color={COLORS.ok}>
        all projects
      </Text>
      <Text color={COLORS.dim}>({count})</Text>
    </Box>
  )
}

function ProjectPickerRow({ project, isSelected }: { project: Project; isSelected: boolean }) {
  const label = project.path.split(/[/\\]/).filter(Boolean).slice(-2).join('/')
  return (
    <Box gap={1} paddingX={1}>
      <Text color={isSelected ? COLORS.accent : COLORS.dim}>{isSelected ? '>' : ' '}</Text>
      <Text bold={isSelected} color={COLORS.text} wrap="truncate">
        {label}
      </Text>
      <Text color={COLORS.dim}>({project.sessions.length})</Text>
      <Text color={COLORS.border} wrap="truncate">
        {project.path}
      </Text>
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Opens an interactive project picker.
 * Returns the selected project(s), or null if the user cancelled.
 * Returns all projects when the user picks the "all" row.
 */
export function runProjectPicker(
  projects: Project[],
  note?: string,
  title?: string,
  subtitle?: string
): Promise<Project[] | null> {
  return new Promise((resolve) => {
    let selection: Project[] | null = null
    const { waitUntilExit } = render(
      <ProjectPicker
        projects={projects}
        note={note}
        title={title}
        subtitle={subtitle}
        onSelect={(p) => {
          selection = p
        }}
      />
    )
    waitUntilExit()
      .then(() => resolve(selection))
      .catch(() => resolve(null))
  })
}
