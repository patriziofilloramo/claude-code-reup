// ---------------------------------------------------------------------------
// UI strings — swap this object at runtime to localise the interface
// ---------------------------------------------------------------------------

const STRINGS = {
  // ── Project panel ──────────────────────────────────────────────────────────
  projectsLabel: 'PROJECTS [{n}]',
  projectLastActive: 'last active: {time}',
  projectNewSession: 'New session',
  projectMoreActions: 'More actions',
  projectCtxNewSession: '+ new session',
  projectCtxCopyPath: 'copy path',
  projectPathCopied: 'Path copied',

  // ── Filters ────────────────────────────────────────────────────────────────
  filterAll: 'All',
  filterActive: 'Active',
  filterArchived: 'Archived',
  filterAttention: 'Needs Attention',
  filterScopeLabel: 'SESSIONS',
  filterTooltipAll: 'All non-archived sessions',
  filterTooltipActive: 'Sessions currently running in a terminal',
  filterTooltipArchived: 'Locally archived sessions',
  filterTooltipAttention:
    'Sessions needing attention: interrupted, expiring, or with missing paths',

  // ── Session list ──────────────────────────────────────────────────────────
  sessionBranchTooltip: 'Branch: {branch}',
  sessionTimeTooltip: 'Last active: {date}',
  sessionModelTooltip: 'Model: {model}',
  sessionContextTooltip: 'Context window tokens in the last turn ({tokens})',
  sessionMoreActions: 'More actions',

  sessionDeepHit: '{n} hit',
  sessionDeepHits: '{n} hits',

  sessionActionResume: 'resume',
  sessionActionHandoff: 'copy handoff',
  sessionActionRename: 'rename',
  sessionActionTag: 'tag…',
  sessionActionArchive: 'archive locally',
  sessionActionUnarchive: 'unarchive',
  sessionActionCopyId: 'copy session ID',
  sessionActionDelete: 'delete permanently',

  sessionCopiedId: 'ID copied: {prefix}…',
  sessionHandoffBuilding: 'Building handoff...',
  sessionHandoffCopied: 'Handoff copied',
  sessionHandoffFailed: 'Handoff failed: {error}',
  sessionCannotDeleteActive: 'Cannot delete an active session.',
  sessionDeleteConfirm:
    'Delete “{name}” permanently?\n\nThis removes the transcript file and cannot be undone.',
  sessionDeleted: 'Session deleted.',
  sessionDeleteFailed: 'Delete failed: {error}',
  sessionRenamed: 'Renamed to “{alias}”',
  sessionAliasCleared: 'Alias cleared',
  sessionRenameFailed: 'Rename failed: {error}',
  sessionArchivedNote: 'Archived locally. Claude may still delete the transcript.',
  sessionArchiveFailed: 'Archive failed: {error}',

  // ── Session status badges ─────────────────────────────────────────────────
  statusInterruptedDesc: 'Claude had pending tool calls with no result — resume to continue.',
  statusStoppedByUserDesc: 'You stopped Claude mid-turn and have not given new instructions since.',
  statusExpiringDesc: 'Transcript expires in {days} days (Claude auto-deletes after 30).',
  statusPathMissingDesc: 'Project directory no longer exists on disk.',
  statusHeavilyCompactedDesc: 'Context was compacted {count} times.',

  // ── Clipboard ─────────────────────────────────────────────────────────────
  clipboardCopied: 'Copied',
  clipboardUnavailable: 'Clipboard unavailable',

  // ── Inspector ─────────────────────────────────────────────────────────────
  inspectorTitle: 'Session Details',
  inspectorCopyId: 'Copy full session ID',
  inspExpandDetailsLabel: 'expand',
  inspExpandDetailsTooltip: 'Expand details panel',
  inspCollapseDetailsLabel: 'compact',
  inspCollapseDetailsTooltip: 'Collapse details panel',

  inspBtnResume: 'Resume',
  inspBtnResumeTooltip: 'Open session in terminal (Enter)',
  inspBtnHandoff: 'Handoff',
  inspBtnHandoffTooltip: 'Copy context handoff packet (H)',
  inspBtnRename: 'Rename',
  inspBtnRenameTooltip: 'Rename session (r)',
  inspBtnArchive: 'Archive',
  inspBtnArchiveTooltip: 'Archive session locally (a)',
  inspBtnUnarchive: 'Unarchive',
  inspBtnUnarchiveTooltip: 'Unarchive session (a)',
  inspBtnDelete: 'Delete',
  inspBtnDeleteTooltip: 'Delete session permanently (D)',
  inspBtnDeleteDisabledTooltip: 'Active sessions cannot be deleted',

  inspShortcuts: 'enter resume · H handoff · r rename · a archive · D delete',

  inspRowStatus: 'Status',
  inspRowActivity: 'Activity',
  activityRunning: 'Running',
  activityWaiting: 'Waiting',
  activityIdle: 'Idle',
  activityInterrupted: 'interrupted',
  activityNeedsInput: 'Needs input',
  notifyEnabled: 'Desktop alerts on',
  notifyDisabled: 'Desktop alerts off',
  notifyDenied: 'The browser blocked notifications; allow them in site settings',
  notifyNeedsInputTitle: '{name} needs your input',
  notifyTurnCompleteTitle: '{name} finished',
  footerNotifyTitle: 'Toggle desktop alerts for sessions that need input or finish a turn',
  footerNotifyBtn: 'alerts',
  inspRowActivityTooltip: 'Live state from the running Claude Code process',
  inspRowLastActive: 'Last active',
  inspRowMessages: 'Messages',
  inspRowCompactions: 'Compactions',
  inspRowCompactionsTooltip: 'Number of times Claude compressed the context window to save space',
  inspRowExpiresIn: 'Expires in',
  inspRowExpiresInTooltip: 'Claude auto-deletes transcripts after 30 days of inactivity',
  inspRowExpiresInValue: '{days} days',
  inspRowLatestModel: 'Latest model',
  inspRowLastContext: 'Last context',
  inspRowLastContextTooltip: 'Tokens in the context window during the last turn',
  inspRowLastOutput: 'Last output',
  inspRowLastOutputTooltip: 'Tokens generated in the last response',
  inspRowModelsUsed: 'Models used',
  inspRowModelsUsedTooltip: 'All models used across the lifetime of this session',
  inspRowSessionId: 'Session ID',
  inspRowSessionIdTooltip: 'Click to copy the full session ID',
  inspRowPath: 'Path',
  inspRowTokenValue: '{count} tokens',
  inspStatusOk: 'ok',
  inspCopied: 'Copied: {prefix}…',

  // ── Resume card ────────────────────────────────────────────────────────────
  previewTitle: 'Resume Card',
  previewGoal: 'what you asked for',
  previewLastResponse: 'where Claude left off',
  previewNativePlan: 'native plan',
  previewNativeTodos: 'native todos',
  previewNativeTodosSummary: '{open} open, {done} done',
  previewTodoMore: '+{n} more',
  previewNotFound: 'Not found in transcript.',
  previewPendingTool: 'Pending tool: {name}',
  previewFilesTouched: 'files touched · {count}',
  previewLoading: 'Loading session preview...',
  previewError: 'Preview unavailable: {error}',
  previewResearchTrail: 'research trail · {count}',
  previewReadFiles: 'files read · {count}',
  previewToolHealth: 'tool health',
  previewToolFailed: '{count} failed',
  previewToolInterrupted: '{count} interrupted',

  // ── Resume dialog ──────────────────────────────────────────────────────────
  resumeLaunchingFrames: ['launching', 'launching.', 'launching..', 'launching...'],
  resumeConfirmBtn: 'Resume',
  resumeResumed: 'Session resumed in terminal',
  resumeLaunchFailed: 'Launch failed — {message}',
  resumeCommandCopied: 'Command copied to clipboard',
  resumeFallbackFailed: 'Failed to launch terminal.',
  resumeError: 'Error: {message}',
  resumePathUnavailable: 'Project directory is unavailable. Restore it before resuming.',

  // ── Server link lost ──────────────────────────────────────────────────────
  offlineTitle: 'LINK LOST',
  offlineProbeCommand: '$ curl -sS http://{host}/api/active',
  offlineProbeError: 'curl: (7) failed to connect to {host}: connection refused',
  offlineHeadline: 'The reup server stopped responding.',
  offlineLiveness:
    'Live session state is unknown while the link is down. Nothing on this page is being updated, and no session is shown as active.',
  offlineRetryCountdown: 'retrying in {seconds}s · attempt {n}',
  offlineRetryNow: 'reconnecting…',
  offlineRetryButton: 'Retry now',
  offlineDismissButton: 'Dismiss',
  offlineHint: 'Start it again with `reup web`, then this page reconnects on its own.',
  offlineStatus: 'server offline',
  offlineRestored: 'Link restored — live state is current again.',

  // ── Touched-file cross-session overlap ────────────────────────────────────
  touchedOthersOne: 'touched by 1 other session',
  touchedOthersMany: 'touched by {n} other sessions',
  touchedExpandLoading: 'Loading…',
  touchedExpandFailed: 'Failed to load sessions.',
  touchedExpandEmpty: 'No other sessions touched this file.',

  // ── Diagnostics / Lost & Found ────────────────────────────────────────────
  diagnosticsScanning: 'Scanning…',
  diagnosticsLoadFailed: 'Failed to load diagnostics.',
  diagnosticsNoIssues: 'No issues found.',
  diagnosticsSummary: '{n} issue found',
  diagnosticsSummaryPlural: '{n} issues found',
  diagnosticsSectionExpiring: 'Expiring ({n})',
  diagnosticsSectionMissingPaths: 'Missing paths ({n})',
  diagnosticsSectionOrphaned: 'Orphaned transcripts ({n})',
  diagnosticsSectionBrokenIndices: 'Broken indices ({n})',
  diagnosticsSectionStaleLocks: 'Stale locks ({n})',
  diagnosticsSectionLegacyMemory: 'Legacy Project Memory artifacts ({n})',
  diagnosticsExpiresSoon: 'Expires soon · {path}',
  diagnosticsPathMissing: 'Path missing · {path}',
  diagnosticsLegacyMemoryNote:
    'Read-only warning. This release no longer manages Project Memory; review manually before deleting or moving anything.',

  // ── App chrome ────────────────────────────────────────────────────────────
  usageLoading: 'usage loading…',

  // ── Search ────────────────────────────────────────────────────────────────
  searchPlaceholder: 'project / session / is:attention — tab: search all context',
  searchInputTitle:
    'Search projects and sessions. Try is:attention, is:drift, is:high-context. Tab searches full transcripts.',
  searchDeepTitle: 'Deep search (Tab)',
  searchModeActive: '⌕ deep',

  // ── Navigation chrome ─────────────────────────────────────────────────────
  backBtnAriaLabel: 'Back to projects',
  mdTagTitle: 'Edit project instructions (CLAUDE.md)',
  reviewSignalsAriaLabel: 'Review signals',

  // ── Sort options ──────────────────────────────────────────────────────────
  sortRecent: 'Recent',
  sortName: 'Name',
  sortRisk: 'Risk',
  sortContext: 'Context',

  // ── Focus bar ─────────────────────────────────────────────────────────────
  focusClearTitle: 'Clear focus',

  // ── Footer hints ──────────────────────────────────────────────────────────
  footerHintSelect: 'select',
  footerHintActions: 'actions',
  footerHintResume: 'resume',
  footerHintSearch: 'search',
  footerHintGroup: 'group',
  footerHintTag: 'tag',
  footerHintRename: 'rename',
  footerHintHandoff: 'handoff',
  footerHintDelete: 'delete',
  footerTitleClick: 'Click to select a session',
  footerTitleRightClick: 'Right-click a session or project row for actions',
  footerTitleEnter: 'Resume the selected session in a terminal',
  footerTitleSlash: 'Open the search bar',
  footerTitleG: 'Assign selected project to a group (g)',
  footerTitleT: 'Add/remove tags on the selected session (t)',
  footerTitleR: 'Rename the selected session (r)',
  footerTitleH: 'Copy a handoff packet for the selected session (H)',
  footerTitleD: 'Delete the selected session permanently (D)',
  footerThemeBtn: 'theme',
  footerThemeTitle: 'Switch theme',
  footerStatusLoading: 'loading…',

  // ── Right panel ───────────────────────────────────────────────────────────
  sessionPanelPlaceholder: 'Select a project',
  sessionSearching: 'searching transcripts…',
  sessionDeepFound: '{n} sessions found',
  sessionCountLabel: '{n} sessions',

  // ── Resume dialog ─────────────────────────────────────────────────────────
  resumeDialogTitle: 'Resume Session',
  resumeDialogCancel: 'Cancel',
  resumeAlwaysConfirm: 'Always confirm before resuming',

  // ── Drawers (shared) ──────────────────────────────────────────────────────
  drawerCloseIcon: '✕',

  // ── Drawer titles and chrome ───────────────────────────────────────────────
  claudeMdTitle: 'CLAUDE.md',
  claudeMdEditorPlaceholder: 'No CLAUDE.md found for this project.',
  claudeMdSaveBtn: 'Save',
  claudeMdCloseBtn: 'Close',
  lfTitle: 'Lost & Found',

  // ── Org manager dialog ────────────────────────────────────────────────────
  orgManagerStackTitle: 'Stack: {name}',
  orgManagerGroupTitle: 'Group: {name}',
  orgManagerDone: 'Done',

  // ── Org picker dialog ─────────────────────────────────────────────────────
  orgPickerCancelBtn: 'Cancel',

  // ── Tag picker dialog ─────────────────────────────────────────────────────
  tagPickerDone: 'Done',

  // ── CLAUDE.md drawer (save status) ────────────────────────────────────────
  claudeMdSaved: 'saved',
  claudeMdUnsaved: 'unsaved',
  claudeMdSaveError: 'error: {message}',

  // ── New session ────────────────────────────────────────────────────────────
  newSessionStarted: 'New session started in terminal',
  newSessionLaunchFailedCopied: 'Launch failed — command copied to clipboard',
  newSessionLaunchFailed: 'Launch failed: {message}',
  newSessionError: 'Error: {message}',

  // ── Status bar ─────────────────────────────────────────────────────────────
  statusBarProjects: '{n} projects',
  statusBarLoadError: 'Error loading projects',
  statusBarDiagnostics: '⚠ {n} issue',
  statusBarDiagnosticsPlural: '⚠ {n} issues',

  // ── Empty states ──────────────────────────────────────────────────────────
  // ── Left rail ─────────────────────────────────────────────────────────────
  railStacks: 'STACKS',
  railStacksTooltip:
    'Temporary work sets. A stack can collect sessions or whole projects you want to revisit together.',
  railGroups: 'GROUPS',
  railGroupsTooltip:
    'Project organization. A project can belong to one group, such as work, personal, or client.',
  railInbox: 'INBOX',
  railInboxTooltip: 'Live, attention-first views computed from current session signals.',
  railActivity: 'LIVE ACTIVITY',
  railActivityTooltip: 'Active Claude Code sessions with recent tool activity.',
  // ── Rail: delete / manage ─────────────────────────────────────────────────
  railDeleteStack: 'delete stack',
  railDeleteGroup: 'delete group',
  railManageStack: 'manage items…',
  railManageGroup: 'manage projects…',
  railManagerEmpty: 'No items.',
  railManagerRemove: '×',
  railDeleteStackConfirm:
    'Delete stack "{name}"?\n\nSessions and projects in it will not be affected.',
  railDeleteGroupConfirm: 'Delete group "{name}"?\n\nProjects will be unassigned from this group.',

  // Review bucket labels (keys referenced from REVIEW_BUCKETS[].labelKey)
  inboxBucketActive: 'Active now',
  inboxBucketAttention: 'Needs attention',
  inboxBucketBranchDrift: 'Branch drift',
  inboxBucketPathMissing: 'Path missing',
  inboxBucketHighContext: 'High context',
  inboxBucketExpiring: 'Expiring soon',
  inboxBucketRecent: 'Recently touched',
  reviewSignalTooltip: '{label}: {count}. Click to search {token}.',

  // Focus bar
  focusBar: 'Focus: {name}',
  focusBarCount: '{n} of {total}',
  focusSaveAsStack: 'Save as stack',
  focusSavePrompt: 'Name this stack',
  focusSaveEmpty: 'There are no visible sessions to save.',
  focusSaveSuccess: 'Saved {n} sessions to "{name}".',
  focusSaveFailed: 'Could not save stack: {error}',

  // Tag chips
  tagChipOverflow: '+{n}',

  // Group/stack picker
  orgPickerGroupTitle: 'Move project to group',
  orgPickerStackTitle: 'Add to stack',
  orgPickerNoItems: 'No existing items.',
  orgPickerNewGroup: '+ new group',
  orgPickerNewStack: '+ new stack',
  orgPickerCreateGroupPlaceholder: 'New group name...',
  orgPickerCreateStackPlaceholder: 'New stack name...',
  orgPickerCreateHint: 'Enter to create and apply',
  orgPickerCreateFailed: 'Failed to create: {error}',
  orgPickerGroupFailed: 'Failed to assign group: {error}',
  orgPickerStackFailed: 'Failed to add to stack: {error}',
  orgPickerRemoveGroup: 'Remove from group',
  sessionActionMoveToGroup: 'move to group…',
  sessionActionAddToStack: 'add to stack…',
  projectCtxMoveToGroup: 'move to group…',
  projectCtxAddToStack: 'add to stack…',

  // Inspector org section
  inspOrgTags: 'TAGS',
  inspOrgAddTag: '+ tag',
  inspOrgGroup: 'GROUP',
  inspOrgStacks: 'STACKS',
  inspOrgNoGroup: '—',

  // Tag picker dialog
  tagPickerSessionTitle: 'Tag session',
  tagPickerProjectTitle: 'Tag project',
  tagPickerPlaceholder: 'Add tag… (Enter to add)',
  tagPickerSaveFailed: 'Failed to save tags: {error}',

  emptyNoMatch: 'No projects or sessions match.',
  emptySelectProject: 'Select a project from the left panel.',
  emptyNoSessions: 'No sessions.',
  emptyNoSessionsFilter: 'No sessions in this filter.',
  emptyNoSessionsSearch: 'No sessions match.',
  emptyArchivedHint: '{n} archived.',
  clientUnexpectedStatus: 'UI error',
  clientUnexpectedError: 'Something went wrong in the UI. The view kept running.',
}

/**
 * Substitutes {key} placeholders in a template with values from vars.
 * Use instead of string concatenation so strings remain translatable as
 * complete phrases.
 *
 * Substitution only — the result is NOT escaped. Anything that reaches
 * innerHTML must be wrapped in escapeHtml(), because transcript-derived values
 * such as project paths are attacker-influenceable.
 */
function fmt(template, vars) {
  return template.replace(/\{(\w+)\}/g, function (_, key) {
    return vars[key] !== undefined ? String(vars[key]) : '{' + key + '}'
  })
}

/** Returns the display label for a filter key (all/active/archived/attention). */
function filterLabel(filter) {
  return STRINGS['filter' + filter.charAt(0).toUpperCase() + filter.slice(1)] || filter
}

/** Returns the tooltip for a filter key. */
function filterTooltip(filter) {
  return STRINGS['filterTooltip' + filter.charAt(0).toUpperCase() + filter.slice(1)] || ''
}
