import * as vscode from 'vscode'

import { createLogger } from './logger.js'
import { SwoopRefreshController } from './refresh-controller.js'
import { showGlobalResumePicker, showWorkspaceResumePicker } from './resume-picker.js'
import {
  openSessionDetail,
  showSessionDetailPicker,
  SwoopSessionDetailProvider,
} from './session-detail.js'
import { asProjectTreeNode, asSessionTreeNode, SwoopSessionTreeProvider } from './session-tree.js'
import { SwoopDataSource } from './swoop-data.js'
import { resumeSessionInTerminal } from './terminal.js'

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const logger = createLogger()
  const dataSource = new SwoopDataSource(logger)
  const detailProvider = new SwoopSessionDetailProvider(logger)
  const treeProvider = new SwoopSessionTreeProvider(dataSource, logger)
  const refreshController = new SwoopRefreshController(logger, treeProvider)

  logger.info('Swoop extension activated')

  context.subscriptions.push(
    logger,
    detailProvider,
    refreshController,
    treeProvider,
    vscode.window.createTreeView('swoop.sessions', {
      showCollapseAll: true,
      treeDataProvider: treeProvider,
    }),
    vscode.workspace.registerTextDocumentContentProvider('swoop', detailProvider),
    vscode.commands.registerCommand('swoop.diagnostics', async () => {
      await runDiagnostics(dataSource, logger)
    }),
    vscode.commands.registerCommand('swoop.refreshSessions', async () => {
      await treeProvider.refresh()
    }),
    vscode.commands.registerCommand('swoop.resumeHere', async () => {
      await showWorkspaceResumePicker(dataSource, logger)
    }),
    vscode.commands.registerCommand('swoop.resumeSession', async () => {
      await showGlobalResumePicker(dataSource, logger)
    }),
    vscode.commands.registerCommand('swoop.openSessionDetail', async (node: unknown) => {
      const sessionNode = asSessionTreeNode(node)
      if (!sessionNode) {
        await showSessionDetailPicker(detailProvider, dataSource, logger)
        return
      }
      try {
        await openSessionDetail(detailProvider, sessionNode.session)
      } catch (error) {
        logger.error('open session detail failed', error)
        void vscode.window.showErrorMessage(
          error instanceof Error ? error.message : 'Could not open Swoop Resume Card.'
        )
      }
    }),
    vscode.commands.registerCommand('swoop.tree.resumeSession', async (node: unknown) => {
      const sessionNode = asSessionTreeNode(node)
      if (!sessionNode) return
      try {
        await resumeSessionInTerminal(sessionNode.session)
        logger.info('resumed session from tree', sessionNode.session.id)
      } catch (error) {
        logger.error('tree resume failed', error)
        void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error))
      }
    }),
    vscode.commands.registerCommand('swoop.tree.copySessionId', async (node: unknown) => {
      const sessionNode = asSessionTreeNode(node)
      if (!sessionNode) return
      await vscode.env.clipboard.writeText(sessionNode.session.id)
      void vscode.window.showInformationMessage('Swoop session ID copied.')
    }),
    vscode.commands.registerCommand('swoop.tree.revealProjectFolder', async (node: unknown) => {
      const projectNode = asProjectTreeNode(node)
      if (!projectNode) return
      await vscode.commands.executeCommand(
        'revealFileInOS',
        vscode.Uri.file(projectNode.project.path)
      )
    })
  )

  await treeProvider.refresh()
}

export function deactivate(): void {
  // VS Code disposes registered subscriptions for us.
}

async function runDiagnostics(
  dataSource: SwoopDataSource,
  logger: ReturnType<typeof createLogger>
): Promise<void> {
  try {
    const model = await dataSource.loadModel({
      includeArchived: vscode.workspace
        .getConfiguration('swoop')
        .get<boolean>('includeArchived', false),
      includePreviewHints: false,
      workspacePath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    })
    logger.info('diagnostics completed', {
      generatedAt: model.generatedAt,
      projects: model.projects.length,
      sessions: model.sessions.length,
    })
    logger.show()
    void vscode.window.showInformationMessage(
      `Swoop found ${model.sessions.length} sessions across ${model.projects.length} projects.`
    )
  } catch (error) {
    logger.error('diagnostics failed', error)
    logger.show()
    void vscode.window.showErrorMessage('Swoop diagnostics failed. See Output: Swoop.')
  }
}
