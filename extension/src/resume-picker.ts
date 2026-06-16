import * as vscode from 'vscode'

import { formatContextTokens, formatRelativeTime, statusCodicon } from './formatting.js'
import type { SwoopLogger } from './logger.js'
import type { ExtensionSession, SwoopDataSource } from './swoop-data.js'
import { sessionMatchesWorkspace } from './swoop-data.js'
import { resumeSessionInTerminal } from './terminal.js'

interface SessionQuickPickItem extends vscode.QuickPickItem {
  session: ExtensionSession
}

export async function showGlobalResumePicker(
  dataSource: SwoopDataSource,
  logger: SwoopLogger
): Promise<void> {
  await showResumePicker({
    dataSource,
    logger,
    placeHolder: 'Resume any Claude Code session known to Swoop',
    title: 'Swoop: Resume Session',
  })
}

export async function showWorkspaceResumePicker(
  dataSource: SwoopDataSource,
  logger: SwoopLogger
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

    const selected = await vscode.window.showQuickPick(sessions.map(toQuickPickItem), {
      matchOnDescription: true,
      matchOnDetail: true,
      placeHolder: options.placeHolder,
      title: options.title,
    })
    if (!selected) return

    await resumeSessionInTerminal(selected.session)
    options.logger.info('resumed session from picker', selected.session.id)
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

function includeArchivedSessions(): boolean {
  return vscode.workspace.getConfiguration('swoop').get<boolean>('includeArchived', false)
}
