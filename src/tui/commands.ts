/**
 * Single source of truth for all TUI keyboard commands.
 *
 * HelpOverlay renders from this list directly — add a command here and it
 * appears in the help screen automatically. App.tsx derives paletteCommands
 * from this list using resolveVisibility(); label overrides for dynamic text
 * (e.g. "Archive 3 selected") are still applied at render time in App.tsx.
 *
 * To add a new command:
 *   1. Add an entry here (id, label, keybinding, group, visibleWhen)
 *   2. Handle it in App.tsx executePaletteCommand() + useInput()
 *   3. It appears in HelpOverlay and CommandPalette automatically
 */

export const GROUP_ORDER = ['session', 'project', 'navigation', 'app'] as const
export type CommandGroup = (typeof GROUP_ORDER)[number]

export const GROUP_LABELS: Record<CommandGroup, string> = {
  session: 'Sessions',
  project: 'Project',
  navigation: 'Navigation',
  app: 'App',
}

/**
 * Named visibility conditions evaluated by resolveVisibility() in App.tsx.
 * Add a new condition here when no existing one fits, then handle it there.
 */
export type VisibleWhen =
  | 'always' // always shown in palette
  | 'session-focused' // sessions panel active AND a session is highlighted
  | 'project-selected' // at least one project exists and is selected
  | 'in-projects-panel' // keyboard focus is on the projects panel
  | 'in-sessions-panel' // keyboard focus is on the sessions panel

export interface CommandDef {
  id: string
  label: string
  keybinding: string
  group: CommandGroup
  visibleWhen: VisibleWhen
}

export const COMMANDS: readonly CommandDef[] = [
  {
    id: 'resume',
    group: 'session',
    keybinding: 'enter',
    visibleWhen: 'session-focused',
    label: 'Resume selected session',
  },
  {
    id: 'preview',
    group: 'session',
    keybinding: 'p',
    visibleWhen: 'session-focused',
    label: 'Preview session details',
  },
  {
    id: 'session-actions',
    group: 'session',
    keybinding: 'space',
    visibleWhen: 'session-focused',
    label: 'Session actions…',
  },
  {
    id: 'archive',
    group: 'session',
    keybinding: 'A',
    visibleWhen: 'session-focused',
    label: 'Archive / unarchive',
  },
  {
    id: 'delete',
    group: 'session',
    keybinding: 'D',
    visibleWhen: 'session-focused',
    label: 'Delete permanently (D again to confirm)',
  },
  {
    id: 'bulk-select',
    group: 'session',
    keybinding: 's',
    visibleWhen: 'session-focused',
    label: 'Select for bulk action',
  },
  {
    id: 'new-session',
    group: 'project',
    keybinding: 'n',
    visibleWhen: 'project-selected',
    label: 'New session in project',
  },
  {
    id: 'search',
    group: 'navigation',
    keybinding: '/',
    visibleWhen: 'always',
    label: 'Search sessions',
  },
  {
    id: 'toggle-archived',
    group: 'navigation',
    keybinding: 'a',
    visibleWhen: 'always',
    label: 'Toggle archived sessions',
  },
  {
    id: 'focus-sessions',
    group: 'navigation',
    keybinding: 'tab / →',
    visibleWhen: 'in-projects-panel',
    label: 'Focus sessions panel',
  },
  {
    id: 'focus-projects',
    group: 'navigation',
    keybinding: '←',
    visibleWhen: 'in-sessions-panel',
    label: 'Focus projects panel',
  },
  { id: 'config', group: 'app', keybinding: 'C', visibleWhen: 'always', label: 'Configure ccm' },
  { id: 'help', group: 'app', keybinding: '?', visibleWhen: 'always', label: 'Keyboard shortcuts' },
  { id: 'quit', group: 'app', keybinding: 'q', visibleWhen: 'always', label: 'Quit' },
]
