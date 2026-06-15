/**
 * All user-facing string literals in one place.
 *
 * Philosophy: "extract, don't translate yet."
 * - No i18n library; a plain object keeps types and tree-shaking free.
 * - TUI and CLI code import from here instead of embedding raw strings.
 * - When localisation is needed, swap the export for a locale-aware lookup.
 * - The ESLint rule src/config/eslint-rules/no-raw-ui-strings.js warns
 *   when new raw literals appear in UI rendering paths.
 */

export const LABELS = {
  // ── Application ──────────────────────────────────────────────────────────
  appName: 'ccm',
  appTitle: 'ccm — session manager for Claude Code',
  appTagline: 'claude code session manager',

  // ── CLI help ─────────────────────────────────────────────────────────────
  usagePrefix: 'Usage:',
  terminalUiDesc: 'Open terminal UI (default)',
  webUiDesc: 'Open browser UI',
  listDesc: 'List sessions; use --json for machine-readable output',
  inboxDesc: 'Show sessions needing attention',
  doctorDesc: 'Diagnose local session-data issues',
  handoffDesc: 'Print a compact continuation packet (picker if no session given)',
  resumeCommandDesc: 'Pick a session, or resume by full ID or unambiguous prefix',
  searchCommandDesc: 'Search sessions by metadata; add --deep to search content',
  usageCommandDesc: 'Show observed usage or configure its feed; toggle on/off',
  linkCommandDesc: 'Link a project to shared session storage (picker if no path)',
  unlinkCommandDesc: 'Restore a project to local session storage',
  memoryCommandDesc: 'Manage shared session storage across devices',
  configCommandDesc: 'Read or write user preferences',
  completionCommandDesc: 'Print shell completion setup',
  themeCommandDesc: 'Set the active theme (dark, light, terminal)',
  versionCommandDesc: 'Print version',
  helpCommandDesc: 'Show this help',

  // ── CLI errors & messages ─────────────────────────────────────────────────
  unknownCommandError: 'unknown command: ',
  invalidThemeError: 'invalid or missing theme — valid values: dark, light, terminal',
  themeSetMessage: 'Theme set to: ',
  repairNotImplemented: 'repair is not yet implemented',
  launchError: 'failed to launch claude: ',
  syncingMessage: 'syncing linked projects...',

  // ── List command ──────────────────────────────────────────────────────────
  noSessionsMatch: 'No sessions match.',
  noSessionsFound: 'no sessions found',
  columnIdPrefix: 'ID PREFIX',
  columnProject: 'PROJECT',
  columnSession: 'SESSION',
  columnState: 'STATE',
  columnUpdated: 'UPDATED',
  stateActive: '● active',
  stateIdle: '○ idle',
  projectRequiresValue: '--project requires a value',
  statusInvalidError: '--status must be one of: ',
  limitInvalidError: '--limit requires a positive integer',
  unknownListOption: 'unknown list option: ',

  // ── Inbox command ─────────────────────────────────────────────────────────
  inboxClear: 'Inbox clear. No active sessions or sessions needing attention.',
  inboxTitle: 'CCM Inbox',

  // ── Doctor command ────────────────────────────────────────────────────────
  doctorTitle: 'CCM Doctor',
  noIssuesFound: 'No issues found.',
  brokenIndices: 'Broken session indices',
  brokenIndicesExplan:
    'Claude Code owns these files; CCM falls back to readable transcripts.',
  staleLocks: 'Stale sidecar locks',
  orphanedTranscripts: 'Orphaned transcripts',
  missingPaths: 'Missing session paths',

  // ── Handoff & resume ──────────────────────────────────────────────────────
  handoffUsage: 'usage: ccm handoff [session-id-or-prefix]',
  transcriptNotFound: 'transcript not found for session',
  cannotReadTranscript: 'cannot read transcript for session',
  selectorRequired: 'a session selector is required outside an interactive terminal',
  noResumableSessions: 'no resumable sessions found',
  resumeLoadFailed: 'failed to load sessions for interactive resume',
  prefixResolveFailed:
    'cannot resolve a session prefix because session discovery failed',
  terminatedBySignal: 'claude terminated by signal',

  // ── Search command ────────────────────────────────────────────────────────
  searchUsage: 'usage: ccm search [--deep] <query>',
  searchRequiresTTY: 'ccm search requires an interactive terminal',
  searchFailed: 'search failed — run with CCM_DEBUG=1 for details',

  // ── Config command ────────────────────────────────────────────────────────
  configUIDesc: 'Open interactive settings UI',
  configGetDesc: 'Show one or all values',
  configSetDesc: 'Save a setting',
  configResetDesc: 'Reset one or all settings to defaults',
  unknownConfigSubcommand: 'unknown config subcommand: ',
  configSetUsage: 'usage: ccm config set <key> <value>',
  unknownConfigKey: 'unknown key: ',

  // ── Memory command ────────────────────────────────────────────────────────
  memoryWarning: 'ccm memory is experimental — use at your own risk.',
  memoryUsage: 'usage: ccm memory [link|unlink|status] [path]',
  linkUsage: 'usage: ccm link [project-path]',
  allLinked: 'all projects are already linked to cloud storage',
  pathRequired: 'a project path is required outside an interactive terminal',
  noCloudDetected: 'no cloud storage detected — showing all projects',
  noCloudProjects: 'no projects found in cloud folders — showing all projects',

  // ── TUI: header ──────────────────────────────────────────────────────────
  limitsLabel: 'limits',
  creditsEnabled: 'credits on',
  statusLoading: 'loading',
  limitsUnavailable: 'account limits unavailable',

  // ── TUI: footer key hints ─────────────────────────────────────────────────
  hintNav: '↑↓ nav',
  hintPanels: '← → panels',
  hintEnterResume: 'enter resume',
  hintEnterRun: 'enter run',
  hintEscBack: 'esc back',
  hintEscClear: 'esc clear',
  hintEscClose: 'esc close',
  hintSearch: '/ search',
  hintDeepSearch: 'tab deep search',
  hintFiles: 'f files',
  hintSpace: 'space actions',
  hintSelect: 's select',
  hintQuit: 'q quit',
  hintCommands: '^K commands',
  selectedCount: 'selected',

  // ── TUI: search ───────────────────────────────────────────────────────────
  searchPlaceholder: 'e.g. fix auth, branch:main, is:active',

  // ── TUI: session actions ──────────────────────────────────────────────────
  actionResumeSession: 'Resume session',
  actionSelectForBulk: 'Select for bulk',
  actionDeselect: 'Deselect',
  actionArchive: 'Archive',
  actionUnarchive: 'Unarchive',
  actionCopySessionId: 'Copy session ID',
  labelActive: '● active',
  labelIdle: '○ idle',

  // ── TUI: project actions ──────────────────────────────────────────────────
  actionNewSession: 'New session',
  actionBrowseSessions: 'Browse sessions',
  actionOpenFileManager: 'Open in file manager',
  actionCopyPath: 'Copy path',

  // ── TUI: command palette ──────────────────────────────────────────────────
  searchCommandsPlaceholder: 'search commands…',
  noMatchingCommands: 'no matching commands',

  // ── TUI: command labels ───────────────────────────────────────────────────
  cmdResumeSelected: 'Resume selected session',
  cmdPreviewSession: 'Preview session details',
  cmdNewSession: 'Start new session in this project',
  cmdArchiveSession: 'Archive selected session',
  cmdSelectForBulk: 'Select session for bulk action',
  cmdSessionActions: 'Session actions',
  cmdSearchSessions: 'Search sessions',
  cmdShowArchived: 'Show archived sessions',
  cmdHideArchived: 'Hide archived sessions',
  cmdDensityComfortable: 'Switch to comfortable density',
  cmdDensityCompact: 'Switch to compact density',
  cmdFocusSessions: 'Focus sessions panel',
  cmdFocusProjects: 'Focus projects panel',
  cmdQuit: 'Quit',

  // ── TUI: launch & resume ──────────────────────────────────────────────────
  launchingVerb: 'launching',
  newSessionVerb: 'starting new session in',
  resumePickerTitle: 'CCM RESUME',
  sessionsCountLabel: 'sessions',
} as const

export type LabelKey = keyof typeof LABELS
