import * as vscode from 'vscode'

import { formatContextTokens, formatRelativeTime, statusCodicon } from './formatting.js'
import { copySessionHandoff } from './handoff.js'
import type { SwoopLogger } from './logger.js'
import type { ExtensionSession, SwoopDataSource } from './swoop-data.js'
import { sessionMatchesWorkspace } from './swoop-data.js'
import { resumeSessionInTerminal } from './terminal.js'

interface SessionQuickPickItem extends vscode.QuickPickItem {
  session: ExtensionSession
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
  dataSource: SwoopDataSource,
  logger: SwoopLogger,
  onOpenInspector?: (session: ExtensionSession) => Promise<void>
): Promise<void> {
  await showResumePicker({
    dataSource,
    logger,
    placeHolder: 'Resume any Claude Code session known to Swoop',
    title: 'Swoop: Resume Session',
    onOpenInspector,
  })
}

export async function showWorkspaceResumePicker(
  dataSource: SwoopDataSource,
  logger: SwoopLogger,
  onOpenInspector?: (session: ExtensionSession) => Promise<void>
): Promise<void> {
  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  await showResumePicker({
    dataSource,
    emptyMessage: workspacePath
      ? 'No Swoop sessions match the current workspace.'
      : 'Open a workspace folder to use Resume Here.',
    filter: (session) => sessionMatchesWorkspace(session, workspacePath),
    logger,
    placeHolder: 'Resume a Claude Code session for the current workspace',
    title: 'Swoop: Resume Here',
    workspacePath,
    onOpenInspector,
  })
}

async function showResumePicker(options: {
  dataSource: SwoopDataSource
  emptyMessage?: string
  filter?: (session: ExtensionSession) => boolean
  logger: SwoopLogger
  placeHolder: string
  title: string
  workspacePath?: string
  onOpenInspector?: (session: ExtensionSession) => Promise<void>
}): Promise<void> {
  try {
    const model = await options.dataSource.loadModel({
      includeArchived: includeArchivedSessions(),
      includePreviewHints: true,
      workspacePath: options.workspacePath,
    })
    const sessions = options.filter ? model.sessions.filter(options.filter) : model.sessions
    if (sessions.length === 0) {
      void vscode.window.showInformationMessage(options.emptyMessage ?? 'No Swoop sessions found.')
      return
    }

    await runQuickPick(sessions.map(toQuickPickItem), options)
  } catch (error) {
    options.logger.error('resume picker failed', error)
    void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error))
  }
}

function toQuickPickItem(session: ExtensionSession): SessionQuickPickItem {
  const flags = [
    session.isActive ? 'active' : null,
    session.needsAttention ? session.primaryStatus : null,
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
    label: `${statusCodicon(session.primaryStatus, session.isActive)} ${session.title}`,
    session,
  }
}

async function runQuickPick(
  items: SessionQuickPickItem[],
  options: {
    logger: SwoopLogger
    onOpenInspector?: (session: ExtensionSession) => Promise<void>
    placeHolder: string
    title: string
  }
): Promise<void> {
  const quickPick = vscode.window.createQuickPick<SessionQuickPickItem>()
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
      if (!selected) return
      void resumeSessionInTerminal(selected.session)
        .then(() => options.logger.info('resumed session from picker', selected.session.id))
        .catch((error) =>
          vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error))
        )
        .finally(finish)
    })
    quickPick.onDidTriggerItemButton((event) => {
      if (event.button === OPEN_INSPECTOR_BUTTON && options.onOpenInspector) {
        void options.onOpenInspector(event.item.session).finally(finish)
      } else if (event.button === COPY_HANDOFF_BUTTON) {
        void copySessionHandoff(event.item.session, options.logger)
          .then(() => vscode.window.showInformationMessage('Swoop handoff packet copied.'))
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
  return vscode.workspace.getConfiguration('swoop').get<boolean>('includeArchived', false)
}
