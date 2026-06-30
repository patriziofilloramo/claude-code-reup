import * as vscode from 'vscode'

import { copySessionHandoff } from './handoff.js'
import { ReupDashboard } from './dashboard.js'
import { createLogger } from './logger.js'
import { ReupRefreshController } from './refresh-controller.js'
import { showGlobalResumePicker, showWorkspaceResumePicker } from './resume-picker.js'
import { SessionResumeService } from './resume-target.js'
import { showSessionSearch } from './session-search.js'
import { showTouchedFileSearch } from './touched-search.js'
import {
  openSessionDetail,
  showSessionDetailPicker,
  ReupInspectorProvider,
} from './session-detail.js'
import { asProjectTreeNode, asSessionTreeNode, ReupSessionTreeProvider } from './session-tree.js'
import { ReupDataSource } from './reup-data.js'
import { CockpitStatusBar } from './status-bar.js'
import { getMigratedGlobalState, getReupConfigurationValue } from './configuration.js'

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const logger = createLogger()
  const dataSource = new ReupDataSource(logger)
  const resumeService = new SessionResumeService(context, logger)
  const treeProvider = new ReupSessionTreeProvider(dataSource, logger)
  let dashboard: ReupDashboard | null = null
  let dashboardVisible = false
  let treeVisible = false
  let refreshController: ReupRefreshController | null = null
  const updateRefreshVisibility = (): void => {
    // Continuous filesystem watching is reserved for the dashboard. Keeping
    // it attached to a contributed TreeView can make the shared VS Code
    // sidebar appear perpetually busy while Claude is writing transcripts.
    // The tree receives one-shot refreshes when opened and after Reup actions.
    refreshController?.setVisible(dashboardVisible)
  }
  const refreshAll = async (): Promise<void> => {
    const changed = await treeProvider.refresh({ notifyView: treeVisible })
    if (changed) await dashboard?.refresh(treeProvider.getModel() ?? undefined)
  }
  const inspectorProvider = new ReupInspectorProvider(dataSource, logger, refreshAll, resumeService)
  dashboard = new ReupDashboard(
    context,
    dataSource,
    inspectorProvider,
    logger,
    refreshAll,
    resumeService,
    (visible) => {
      dashboardVisible = visible
      updateRefreshVisibility()
    },
    () => treeProvider.getModel()
  )
  const treeView = vscode.window.createTreeView('reup.sessions', {
    showCollapseAll: true,
    treeDataProvider: treeProvider,
  })
  treeProvider.attachTreeView(treeView)
  refreshController = new ReupRefreshController(logger, { refresh: refreshAll })
  const statusBar = new CockpitStatusBar()

  logger.info('Reup extension activated')

  context.subscriptions.push(
    logger,
    dashboard,
    inspectorProvider,
    refreshController,
    statusBar,
    treeProvider,
    treeView,
    treeView.onDidChangeVisibility((event) => {
      treeVisible = event.visible
      statusBar.setVisible(event.visible)
      if (event.visible && !treeProvider.renderCurrentModel()) void refreshAll()
    }),
    treeView.onDidChangeSelection((event) => {
      const sessionNode = asSessionTreeNode(event.selection[0])
      if (sessionNode) void inspectorProvider.showSession(sessionNode.session, false)
    }),
    treeProvider.onDidChangeModel((model) => {
      statusBar.update(model)
      void inspectorProvider.refreshSelected(model.sessions)
    }),
    vscode.window.registerWebviewViewProvider('reup.inspector', inspectorProvider, {
      webviewOptions: { retainContextWhenHidden: false },
    }),
    vscode.commands.registerCommand('reup.diagnostics', async () => {
      await runDiagnostics(dataSource, logger)
    }),
    vscode.commands.registerCommand('reup.refreshSessions', async () => {
      await refreshAll()
    }),
    vscode.commands.registerCommand('reup.openDashboard', async () => {
      await dashboard?.open()
    }),
    vscode.commands.registerCommand('reup.focusCockpit', async () => {
      await vscode.commands.executeCommand('reup.sessions.focus')
    }),
    vscode.commands.registerCommand('reup.resumeHere', async () => {
      await showWorkspaceResumePicker(dataSource, logger, resumeService, (session) =>
        inspectorProvider.showSession(session)
      )
    }),
    vscode.commands.registerCommand('reup.resumeSession', async () => {
      await showGlobalResumePicker(dataSource, logger, resumeService, (session) =>
        inspectorProvider.showSession(session)
      )
    }),
    vscode.commands.registerCommand('reup.searchSessions', async () => {
      await showSessionSearch(dataSource, logger, resumeService, (session) =>
        inspectorProvider.showSession(session)
      )
    }),
    vscode.commands.registerCommand('reup.findTouchedFile', async () => {
      await showTouchedFileSearch(dataSource, logger, resumeService, (session) =>
        inspectorProvider.showSession(session)
      )
    }),
    vscode.commands.registerCommand('reup.openSessionDetail', async (node: unknown) => {
      const sessionNode = asSessionTreeNode(node)
      if (!sessionNode) {
        await showSessionDetailPicker(inspectorProvider, dataSource, logger)
        return
      }
      try {
        await openSessionDetail(inspectorProvider, sessionNode.session)
      } catch (error) {
        logger.error('open session detail failed', error)
        void vscode.window.showErrorMessage(
          error instanceof Error ? error.message : 'Could not open Reup Session Inspector.'
        )
      }
    }),
    vscode.commands.registerCommand('reup.tree.resumeSession', async (node: unknown) => {
      const sessionNode = asSessionTreeNode(node)
      if (!sessionNode) return
      try {
        const target = await resumeService.resume(sessionNode.session)
        if (target) logger.info('resumed session from tree', sessionNode.session.id)
      } catch (error) {
        logger.error('tree resume failed', error)
        void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error))
      }
    }),
    vscode.commands.registerCommand('reup.tree.copySessionId', async (node: unknown) => {
      const sessionNode = asSessionTreeNode(node)
      if (!sessionNode) return
      await vscode.env.clipboard.writeText(sessionNode.session.id)
      void vscode.window.showInformationMessage('Reup session ID copied.')
    }),
    vscode.commands.registerCommand('reup.tree.copyHandoff', async (node: unknown) => {
      const sessionNode = asSessionTreeNode(node)
      if (!sessionNode) return
      try {
        await copySessionHandoff(sessionNode.session, logger)
        void vscode.window.showInformationMessage('Reup handoff packet copied.')
      } catch (error) {
        logger.error('copy handoff failed', error)
        void vscode.window.showErrorMessage(
          error instanceof Error ? error.message : 'Could not copy Reup handoff packet.'
        )
      }
    }),
    vscode.commands.registerCommand('reup.tree.editAlias', async (node: unknown) => {
      const sessionNode = asSessionTreeNode(node)
      if (sessionNode) await inspectorProvider.editAlias(sessionNode.session)
    }),
    vscode.commands.registerCommand('reup.tree.toggleArchive', async (node: unknown) => {
      const sessionNode = asSessionTreeNode(node)
      if (sessionNode) await inspectorProvider.toggleArchive(sessionNode.session)
    }),
    vscode.commands.registerCommand('reup.tree.editTags', async (node: unknown) => {
      const sessionNode = asSessionTreeNode(node)
      if (sessionNode) await inspectorProvider.editTags(sessionNode.session)
    }),
    vscode.commands.registerCommand('reup.tree.revealProjectFolder', async (node: unknown) => {
      const projectNode = asProjectTreeNode(node)
      if (!projectNode) return
      await vscode.commands.executeCommand(
        'revealFileInOS',
        vscode.Uri.file(projectNode.group.project.path)
      )
    })
  )

  treeVisible = treeView.visible
  updateRefreshVisibility()
  statusBar.setVisible(treeView.visible)
  await openDashboardOnFirstUse(context, dashboard)
  if (treeVisible && !treeProvider.renderCurrentModel()) void refreshAll()
}

async function openDashboardOnFirstUse(
  context: vscode.ExtensionContext,
  dashboard: ReupDashboard
): Promise<void> {
  const onboardingGeneration = 1
  const key = 'reup.dashboard.onboardingGeneration'
  if ((await getMigratedGlobalState<number>(context, key)) === onboardingGeneration) return
  await context.globalState.update(key, onboardingGeneration)
  await dashboard.open()
}

export function deactivate(): void {
  // VS Code disposes registered subscriptions for us.
}

async function runDiagnostics(
  dataSource: ReupDataSource,
  logger: ReturnType<typeof createLogger>
): Promise<void> {
  try {
    const model = await dataSource.loadModel({
      includeArchived: getReupConfigurationValue('includeArchived', false),
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
      `Reup found ${model.sessions.length} sessions across ${model.projects.length} projects.`
    )
  } catch (error) {
    logger.error('diagnostics failed', error)
    logger.show()
    void vscode.window.showErrorMessage('Reup diagnostics failed. See Output: Reup.')
  }
}
