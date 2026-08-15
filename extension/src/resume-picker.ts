import * as vscode from 'vscode'

import { formatContextTokens, formatRelativeTime, statusCodicon } from './formatting.js'
import { copySessionHandoff } from './handoff.js'
import { compareCockpitSessions } from './cockpit-model.js'
import { getReupConfigurationValue } from './configuration.js'
import type { ReupLogger } from './logger.js'
import type { SessionResumeService } from './resume-target.js'
import type { ExtensionSession, ReupDataSource } from './reup-data.js'
import { resolveWorkspaceRepositoryRoots, sessionMatchesWorkspace } from './reup-data.js'

interface SessionQuickPickItem extends vscode.QuickPickItem {
  session: ExtensionSession
}

/** A picker row is either a session or a heading that groups the rows below it. */
type ResumePickItem = SessionQuickPickItem | vscode.QuickPickItem

function isSessionPickItem(item: ResumePickItem | undefined): item is SessionQuickPickItem {
  return item !== undefined && 'session' in item
}

const OPEN_INSPECTOR_BUTTON: vscode.QuickInputButton = {
  iconPath: new vscode.ThemeIcon('preview'),
  tooltip: 'Open Session Inspector',
}
const COPY_HANDOFF_BUTTON: vscode.QuickInputButton = {
  iconPath: new vscode.ThemeIcon('clippy'),
  tooltip: 'Copy Handoff',
}

export async function showGlobalResumePicker(
  dataSource: ReupDataSource,
  logger: ReupLogger,
  resumeService: SessionResumeService,
  onOpenInspector?: (session: ExtensionSession) => Promise<void>
): Promise<void> {
  await showResumePicker({
    dataSource,
    logger,
    placeHolder: 'Resume any Claude Code session known to Reup',
    resumeService,
    title: 'Reup: Resume Session',
    onOpenInspector,
  })
}

export async function showWorkspaceResumePicker(
  dataSource: ReupDataSource,
  logger: ReupLogger,
  resumeService: SessionResumeService,
  onOpenInspector?: (session: ExtensionSession) => Promise<void>
): Promise<void> {
  const workspacePaths = (vscode.workspace.workspaceFolders ?? []).map(
    (folder) => folder.uri.fsPath
  )
  const repositoryPaths = await resolveWorkspaceRepositoryRoots(workspacePaths)
  const activeEditorPath = vscode.window.activeTextEditor?.document.uri.fsPath ?? null
  const inWorkspace = (session: ExtensionSession): boolean =>
    workspacePaths.some((workspacePath) => sessionMatchesWorkspace(session, workspacePath))
  await showResumePicker({
    dataSource,
    emptyMessage:
      workspacePaths.length > 0
        ? 'No Reup sessions match the current workspace.'
        : 'Open a workspace folder to use Resume Here.',
    filter: (session) =>
      inWorkspace(session) ||
      repositoryPaths.some((repositoryPath) => sessionMatchesWorkspace(session, repositoryPath)),
    // Sessions from the rest of the repository are offered, but never silently
    // mixed in: they sit below a heading that says where they come from.
    group: (session) => (inWorkspace(session) ? null : 'Rest of Repository'),
    logger,
    placeHolder: 'Resume a Claude Code session for the current workspace',
    resumeService,
    sort: (left, right) => compareCockpitSessions(left, right, activeEditorPath),
    title: 'Reup: Resume Here',
    workspacePath: workspacePaths[0],
    onOpenInspector,
  })
}

async function showResumePicker(options: {
  dataSource: ReupDataSource
  emptyMessage?: string
  filter?: (session: ExtensionSession) => boolean
  /** Heading a session belongs under, or null for the ungrouped rows on top. */
  group?: (session: ExtensionSession) => string | null
  logger: ReupLogger
  placeHolder: string
  resumeService: SessionResumeService
  title: string
  workspacePath?: string
  onOpenInspector?: (session: ExtensionSession) => Promise<void>
  sort?: (left: ExtensionSession, right: ExtensionSession) => number
}): Promise<void> {
  try {
    const model = await options.dataSource.loadModel({
      includeArchived: includeArchivedSessions(),
      includePreviewHints: true,
      workspacePath: options.workspacePath,
    })
    const filteredSessions = options.filter ? model.sessions.filter(options.filter) : model.sessions
    const sessions = options.sort ? [...filteredSessions].sort(options.sort) : filteredSessions
    if (sessions.length === 0) {
      void vscode.window.showInformationMessage(options.emptyMessage ?? 'No Reup sessions found.')
      return
    }

    await runQuickPick(buildPickItems(sessions, options.group), options)
  } catch (error) {
    options.logger.error('resume picker failed', error)
    void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error))
  }
}

/**
 * Lays out the rows, inserting a separator each time the heading changes. The
 * sessions are already in relevance order, so grouping preserves it within
 * each heading instead of re-sorting.
 */
function buildPickItems(
  sessions: ExtensionSession[],
  group?: (session: ExtensionSession) => string | null
): ResumePickItem[] {
  if (!group) return sessions.map(toQuickPickItem)

  const items: ResumePickItem[] = []
  let openHeading: string | null = null
  for (const heading of [null, ...new Set(sessions.map(group).filter((value) => value !== null))]) {
    for (const session of sessions.filter((candidate) => group(candidate) === heading)) {
      if (heading !== null && heading !== openHeading) {
        items.push({ kind: vscode.QuickPickItemKind.Separator, label: heading })
        openHeading = heading
      }
      items.push(toQuickPickItem(session))
    }
  }
  return items
}

function toQuickPickItem(session: ExtensionSession): SessionQuickPickItem {
  const flags = [
    session.needsInput ? 'needs input' : null,
    session.isActive ? 'active' : null,
    session.needsAttention && !session.needsInput ? session.primaryStatus : null,
    session.todoSummary ? `todos ${session.todoSummary}` : null,
    session.planSummary ? 'plan' : null,
    formatContextTokens(session.contextTokens),
  ].filter((value): value is string => value !== null)

  return {
    buttons: [OPEN_INSPECTOR_BUTTON, COPY_HANDOFF_BUTTON],
    description: `${session.projectName} - ${formatRelativeTime(session.updated)}`,
    detail: [
      [session.branch, session.currentBranch].filter(Boolean).join(' -> '),
      `${session.messageCount} msgs`,
      ...flags,
      session.planSummary ? `plan: ${session.planSummary}` : null,
    ]
      .filter(Boolean)
      .join(' - '),
    label: `${statusCodicon(session.primaryStatus, session.liveState)} ${session.title}`,
    session,
  }
}

async function runQuickPick(
  items: ResumePickItem[],
  options: {
    logger: ReupLogger
    onOpenInspector?: (session: ExtensionSession) => Promise<void>
    placeHolder: string
    resumeService: SessionResumeService
    title: string
  }
): Promise<void> {
  // Typed over the union: separators carry no session, and VS Code never
  // selects them, so every read of `.session` goes through isSessionPickItem.
  const quickPick = vscode.window.createQuickPick<ResumePickItem>()
  quickPick.items = items
  quickPick.matchOnDescription = true
  quickPick.matchOnDetail = true
  quickPick.placeholder = options.placeHolder
  quickPick.title = options.title

  await new Promise<void>((resolvePromise) => {
    let finished = false
    const finish = (): void => {
      if (finished) return
      finished = true
      quickPick.dispose()
      resolvePromise()
    }
    quickPick.onDidAccept(() => {
      const selected = quickPick.selectedItems[0]
      if (!isSessionPickItem(selected)) return
      finish()
      void options.resumeService
        .resume(selected.session)
        .then((target) => {
          if (target) options.logger.info('resumed session from picker', selected.session.id)
        })
        .catch((error) =>
          vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error))
        )
    })
    quickPick.onDidTriggerItemButton((event) => {
      if (!isSessionPickItem(event.item)) return
      if (event.button === OPEN_INSPECTOR_BUTTON && options.onOpenInspector) {
        void options.onOpenInspector(event.item.session).finally(finish)
      } else if (event.button === COPY_HANDOFF_BUTTON) {
        void copySessionHandoff(event.item.session, options.logger)
          .then(() => vscode.window.showInformationMessage('Reup handoff packet copied.'))
          .catch((error) =>
            vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error))
          )
      }
    })
    quickPick.onDidHide(finish)
    quickPick.show()
  })
}

function includeArchivedSessions(): boolean {
  return getReupConfigurationValue<boolean>('includeArchived', false)
}
