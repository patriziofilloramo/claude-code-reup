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
  appName: 'reup',
  appTitle: 'Reup — session manager for Claude Code',
  appTagline: 'claude code session manager',
  brandProduct: 'claude code',

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
  usageCommandDesc: 'Show observed usage limits; use --json for tools',
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
  inboxTitle: 'Reup Inbox',

  // ── Doctor command ────────────────────────────────────────────────────────
  doctorTitle: 'Reup Doctor',
  noIssuesFound: 'No issues found.',
  brokenIndices: 'Broken session indices',
  brokenIndicesExplan: 'Claude Code owns these files; Reup falls back to readable transcripts.',
  staleLocks: 'Stale sidecar locks',
  orphanedTranscripts: 'Orphaned transcripts',
  missingPaths: 'Missing session paths',

  // ── Handoff & resume ──────────────────────────────────────────────────────
  handoffUsage: 'usage: reup handoff [session-id-or-prefix]',
  transcriptNotFound: 'transcript not found for session',
  cannotReadTranscript: 'cannot read transcript for session',
  selectorRequired: 'a session selector is required outside an interactive terminal',
  noResumableSessions: 'no resumable sessions found',
  resumeLoadFailed: 'failed to load sessions for interactive resume',
  prefixResolveFailed: 'cannot resolve a session prefix because session discovery failed',
  terminatedBySignal: 'claude terminated by signal',

  // ── Search command ────────────────────────────────────────────────────────
  searchUsage: 'usage: reup search [--deep] <query>',
  searchRequiresTTY: 'reup search requires an interactive terminal',
  searchFailed: 'search failed — run with REUP_DEBUG=1 for details',

  // ── Config command ────────────────────────────────────────────────────────
  configUIDesc: 'Open interactive settings UI',
  configGetDesc: 'Show one or all values',
  configSetDesc: 'Save a setting',
  configResetDesc: 'Reset one or all settings to defaults',
  configPanelTitle: 'config',
  configColorThemeTitle: 'Color theme',
  configColorThemeDesc: 'Takes effect when reup is restarted. The web UI switches live.',
  configLiveUsageTitle: 'Live usage status line',
  configLiveUsageDesc: "Captures rate-limit data from Claude Code's status line",
  configAttentionTitle: 'Attention alerts',
  configAttentionDesc: 'Alerts when a session waits for a permission decision or your input',
  configShellCompletionTitle: 'Shell completion',
  configShellCompletionDesc: 'Tab-complete session IDs for resume and handoff',
  configWorking: 'working...',
  configDetected: 'detected',
  configProjectsTitle: 'Projects',
  configLoading: 'loading...',
  configHintSwitch: 'switch',
  configKeyEnter: 'enter',
  configKeyTabLeftRight: 'tab / left/right',
  configKeyUpDown: 'up/down',
  configSelect: 'select',
  unknownConfigSubcommand: 'unknown config subcommand: ',
  configSetUsage: 'usage: reup config set <key> <value>',
  unknownConfigKey: 'unknown key: ',

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
  hintFocus: 'f focus',
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
  resumePickerTitle: 'Reup RESUME',
  sessionsCountLabel: 'sessions',
  focusLabel: 'Focus:',

  // ── TUI: common words & keys ──────────────────────────────────────────────
  keyEnter: 'enter',
  keyEsc: 'esc',
  keyTab: 'tab',
  keySpace: 'space',
  keyUpDown: '↑↓',
  keyUpDownWords: 'up/down',
  keyLeftRight: '← →',
  keyCommandPalette: '^K',
  keyFiles: 'f',
  keyPreview: 'p',
  keySelect: 's',
  keyQuit: 'q',
  keyArchive: 'A',
  keyDelete: 'D',
  keyAll: 'a',
  keySearch: '/',
  wordActions: 'actions',
  wordArchive: 'archive',
  wordBack: 'back',
  wordCancel: 'cancel',
  wordClear: 'clear',
  wordClose: 'close',
  wordCommands: 'commands',
  wordDelete: 'delete',
  wordFiles: 'files',
  wordFound: 'found',
  wordLink: 'link',
  wordNavigate: 'navigate',
  wordNav: 'nav',
  wordPanels: 'panels',
  wordPreview: 'preview',
  wordProject: 'project',
  wordProjects: 'projects',
  wordQuit: 'quit',
  wordResume: 'resume',
  wordRun: 'run',
  wordSearch: 'search',
  wordSelect: 'select',
  wordSession: 'session',
  wordSessions: 'sessions',
  wordSwitch: 'switch',
  wordSelected: 'selected',
  allNone: 'all/none',
  allProjects: 'all projects',
  confirmNothingSelected: 'confirm (nothing selected)',
  currentLabel: 'current',
  currentDirectoryLabel: 'current directory:',
  unknownLabel: 'unknown',

  // ── TUI: transient states & empty states ──────────────────────────────────
  scanningSessions: 'scanning sessions…',
  loadSessionsFailed: 'failed to load sessions',
  noProjectsFoundInClaude: 'no projects found in ~/.claude/projects/',
  noProjectsOrSessionsMatchSearch: 'no projects or sessions match your search',
  noProjectsMatch: 'No projects match.',
  noSessionsMatchSentence: 'No sessions match.',
  noSessionsMatchSearch: 'No sessions match your search',
  selectProjectHint: 'Select a project with → or enter',

  // ── TUI: picker labels ────────────────────────────────────────────────────
  cleanupTitle: 'reup cleanup',
  cleanupCandidate: 'candidate',
  resumePickerDirectoryTitle: 'Reup RESUME',
  touchedPickerTitle: 'Reup TOUCHED',
  touchedPickerSubtitle: 'files edited in this project',
  touchedFinderSubtitle: 'files edited across your projects',
  touchedSessionsSubtitle: 'sessions that edited this file',
  noTouchedFilesSentence: 'No touched files recorded.',
  noTouchedSessionsSentence: 'No sessions touched this file.',
  wordOpen: 'sessions',
  searchPrefix: 'search:',
  deepSearchTitle: 'DEEP SEARCH',
  deepSearchCta: 'TAB deep search',
  deepSearchScansTranscripts: 'scans transcripts',
  deepSearchQueryLabel: 'query',
  deepSearchScanning: 'scanning',
  deepSearchScanningTranscripts: 'Scanning transcripts…',
  deepSearchNoSessionsContain: 'No sessions contain',

  // ── TUI: resume card labels ───────────────────────────────────────────────
  messageCountSuffix: 'msgs',
  contextSuffix: 'ctx',
  resumeCardPreviewSuffix: '· preview',
  activeSessionWarningTitle: '⚡ another session is already live right now',
  activeSessionWarningIntro: 'resuming here will start a second instance. this means:',
  activeSessionWarningTranscript:
    '  · both processes write to the same transcript — it will get scrambled',
  activeSessionWarningVisibility: '  · neither Claude will see what the other is doing',
  activeSessionWarningFiles: '  · simultaneous file edits can overwrite each other',
  expiringWarning: '⚠ expiring soon — transcript will be removed shortly',
  pathMissingWarning: '⚠ project path not found on this machine',
  interruptedWarningTitle: '⚠ Claude stopped mid-task',
  interruptedWarningBody: ' resuming picks up where it left off — the last step may run again',
  filesInUseLabel: 'files in use · ',
  keyboardShortcutsTitle: 'keyboard shortcuts',
} as const

export type LabelKey = keyof typeof LABELS
