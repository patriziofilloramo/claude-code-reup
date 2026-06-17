// ---------------------------------------------------------------------------
// UI strings — swap this object at runtime to localise the interface
// ---------------------------------------------------------------------------

const STRINGS = {
  // ── Project panel ──────────────────────────────────────────────────────────
  projectsLabel: 'PROJECTS [{n}]',
  projectLastActive: 'last active: {time}',
  projectNewSession: 'New session',
  projectMoreActions: 'More actions',
  projectCloudOk: 'Shared storage — writes directly to cloud',
  projectCloudOffline:
    'Cloud offline — sessions saved locally, new sessions paused until sync resumes',
  projectCloudUnlinked: 'Device(s) not linked: {devices} — run swoop sync link on those devices',
  projectCtxNewSession: '+ new session',
  projectCtxCopyPath: 'copy path',
  projectPathCopied: 'Path copied',

  // ── Filters ────────────────────────────────────────────────────────────────
  filterAll: 'All',
  filterActive: 'Active',
  filterArchived: 'Archived',
  filterAttention: 'Needs Attention',
  filterTooltipAll: 'All non-archived sessions',
  filterTooltipActive: 'Sessions currently running in a terminal',
  filterTooltipArchived: 'Locally archived sessions',
  filterTooltipAttention:
    'Sessions needing attention: interrupted, expiring, or with missing paths',

  // ── Session list ──────────────────────────────────────────────────────────
  sessionLiveTooltip: 'Active — this session is currently running',
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
  diagnosticsExpiresSoon: 'Expires soon · {path}',
  diagnosticsPathMissing: 'Path missing · {path}',

  // ── CLAUDE.md drawer ───────────────────────────────────────────────────────
  claudeMdSaved: 'saved',
  claudeMdUnsaved: 'unsaved',
  claudeMdSaveError: 'error: {message}',
  syncLoading: 'Loading sync status...',
  syncLoadFailed: 'Failed to load sync status.',
  syncWarning:
    'Alpha. Syncs Claude session storage between your own devices through a cloud-synced project folder. It does not share sessions with other users. Link actions may manage CLAUDE.md, .gitignore, .claude/settings.local.json, and .claude-memory/.',
  syncEnabled: 'Cross-device Session Storage is on',
  syncDisabled: 'Cross-device Session Storage is off',
  syncEnable: 'Enable Cross-device Storage',
  syncDisable: 'Disable Cross-device Storage',
  syncLinkSelected: 'Link selected project',
  syncUnlinkSelected: 'Unlink selected project',
  syncLinkAllCloud: 'Link all cloud projects',
  syncUnlinkAll: 'Unlink all synced projects',
  syncNoSelectedProject: 'Select a project to link or unlink it.',
  syncNoCloudProjects: 'No cloud projects found under detected cloud folders.',
  syncConfirmManaged: 'Swoop will patch managed sync files for this project. Continue?',
  syncConfirmBulk: 'Run this bulk sync operation sequentially?',
  syncOperationDone: 'Sync operation complete',
  syncOperationFailed: 'Sync failed: {error}',

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
  railInbox: 'INBOX',
  railInboxEmpty: 'Nothing to triage.',
  railStacks: 'STACKS',
  railGroups: 'GROUPS',
  railNewStack: '+ new stack',
  railNewGroup: '+ new group',
  railStackNamePlaceholder: 'Stack name…',
  railGroupNamePlaceholder: 'Group name…',
  railCreateError: 'Failed to create: {message}',

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

  // Inbox bucket labels (keys referenced from INBOX_BUCKETS[].labelKey)
  inboxBucketActive: 'Active now',
  inboxBucketAttention: 'Needs attention',
  inboxBucketBranchDrift: 'Branch drift',
  inboxBucketPathMissing: 'Path missing',
  inboxBucketHighContext: 'High context',
  inboxBucketExpiring: 'Expiring soon',
  inboxBucketRecent: 'Recently touched',

  // Focus bar
  focusBar: 'Focus: {name}',
  focusBarCount: '{n} of {total}',

  // Tag chips
  tagChipOverflow: '+{n}',

  // Group/stack picker
  orgPickerGroupTitle: 'Move project to group',
  orgPickerStackTitle: 'Add to stack',
  orgPickerNoItems: 'No items — create one in the rail first.',
  orgPickerGroupFailed: 'Failed to assign group: {error}',
  orgPickerStackFailed: 'Failed to add to stack: {error}',
  orgPickerRemoveGroup: 'Remove from group',
  sessionActionMoveToGroup: 'move to group…',
  sessionActionAddToStack: 'add to stack…',
  projectCtxMoveToGroup: 'move to group…',

  // Inspector org section
  inspOrgTags: 'TAGS',
  inspOrgAddTag: '+ tag',
  inspOrgGroup: 'GROUP',
  inspOrgStacks: 'STACKS',
  inspOrgNoGroup: '—',

  // Tag picker dialog
  tagPickerSessionTitle: 'Tag session',
  tagPickerPlaceholder: 'Add tag… (Enter to add)',
  tagPickerSaveFailed: 'Failed to save tags: {error}',

  emptyNoMatch: 'No projects or sessions match.',
  emptySelectProject: 'Select a project from the left panel.',
  emptyNoSessions: 'No sessions.',
  emptyNoSessionsFilter: 'No sessions in this filter.',
  emptyNoSessionsSearch: 'No sessions match.',
  emptyArchivedHint: '{n} archived.',
}

/**
 * Substitutes {key} placeholders in a template with values from vars.
 * Use instead of string concatenation so strings remain translatable as
 * complete phrases.
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
