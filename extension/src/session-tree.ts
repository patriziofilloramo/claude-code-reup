import * as vscode from 'vscode'

import { formatContextTokens, formatRelativeTime, statusThemeIconId } from './formatting.js'
import type { CockpitProjectGroup, ExtensionCockpitModel } from './cockpit-model.js'
import type { SwoopLogger } from './logger.js'
import type { ExtensionProject, ExtensionSession, SwoopDataSource } from './swoop-data.js'

type SectionId = 'workspace' | 'attention' | 'recent'

interface SectionTreeNode {
  id: SectionId
  kind: 'section'
}

export interface ProjectTreeNode {
  group: CockpitProjectGroup
  kind: 'project'
  parentSection: SectionId
}

export interface SessionTreeNode {
  kind: 'session'
  parentProjectId?: string
  parentSection: SectionId
  session: ExtensionSession
}

export type TreeNode = ProjectTreeNode | SectionTreeNode | SessionTreeNode

const SECTIONS: Record<SectionId, SectionTreeNode> = {
  attention: { id: 'attention', kind: 'section' },
  recent: { id: 'recent', kind: 'section' },
  workspace: { id: 'workspace', kind: 'section' },
}

export class SwoopSessionTreeProvider
  implements vscode.TreeDataProvider<TreeNode>, vscode.Disposable
{
  private readonly changedEmitter = new vscode.EventEmitter<TreeNode | undefined>()
  private readonly modelChangedEmitter = new vscode.EventEmitter<ExtensionCockpitModel>()
  private model: ExtensionCockpitModel | null = null
  private selectedSessionId: string | null = null
  private sessionNodes = new Map<string, SessionTreeNode>()
  private projectNodes = new Map<string, ProjectTreeNode>()
  private treeView: vscode.TreeView<TreeNode> | null = null
  private treeSelectionDisposable: vscode.Disposable | null = null

  readonly onDidChangeTreeData = this.changedEmitter.event
  readonly onDidChangeModel = this.modelChangedEmitter.event

  constructor(
    private readonly dataSource: SwoopDataSource,
    private readonly logger: SwoopLogger
  ) {}

  attachTreeView(treeView: vscode.TreeView<TreeNode>): void {
    this.treeSelectionDisposable?.dispose()
    this.treeView = treeView
    this.treeSelectionDisposable = treeView.onDidChangeSelection((event) => {
      const sessionNode = event.selection.find((node) => node.kind === 'session')
      if (sessionNode?.kind === 'session') this.selectedSessionId = sessionNode.session.id
    })
  }

  async refresh(): Promise<void> {
    try {
      const model = await this.dataSource.loadCockpitModel({
        activeEditorPath: vscode.window.activeTextEditor?.document.uri.fsPath,
        includeArchived: vscode.workspace
          .getConfiguration('swoop')
          .get<boolean>('includeArchived', false),
        workspaceRoots: (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath),
      })
      this.model = model
      this.rebuildNodeCache(model)
      await Promise.all([
        vscode.commands.executeCommand('setContext', 'swoop.hasSessions', model.sessions.length > 0),
        vscode.commands.executeCommand(
          'setContext',
          'swoop.hasWorkspaceSessions',
          model.summary.workspaceSessionCount > 0
        ),
        vscode.commands.executeCommand('setContext', 'swoop.hasLoadError', false),
      ])
      this.changedEmitter.fire(undefined)
      this.modelChangedEmitter.fire(model)
      this.updateViewBadge(model)
      await this.restoreSelection()
      this.logger.info('refreshed VS Code cockpit', {
        active: model.summary.activeCount,
        attention: model.summary.attentionCount,
        projects: model.projects.length,
        sessions: model.sessions.length,
        workspaceSessions: model.summary.workspaceSessionCount,
      })
    } catch (error) {
      await vscode.commands.executeCommand('setContext', 'swoop.hasLoadError', true)
      this.logger.error('cockpit refresh failed', error)
      void vscode.window.showErrorMessage('Swoop could not refresh sessions. See Output: Swoop.')
    }
  }

  getModel(): ExtensionCockpitModel | null {
    return this.model
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    if (node.kind === 'section') return sectionTreeItem(node, this.model)
    if (node.kind === 'project') return projectTreeItem(node.group.project)
    return sessionTreeItem(node.session)
  }

  getChildren(node?: TreeNode): TreeNode[] {
    if (!this.model) return []
    if (!node) {
      return [
        SECTIONS.workspace,
        ...(this.model.attentionElsewhere.length > 0 ? [SECTIONS.attention] : []),
        SECTIONS.recent,
      ]
    }
    if (node.kind === 'section') return this.sectionChildren(node.id)
    if (node.kind === 'project') {
      return node.group.sessions.map(
        (session) => this.sessionNodes.get(session.id) ?? sessionNode(session, node.parentSection)
      )
    }
    return []
  }

  getParent(node: TreeNode): TreeNode | null {
    if (node.kind === 'section') return null
    if (node.kind === 'project') return SECTIONS[node.parentSection]
    if (node.parentProjectId) {
      return this.projectNodes.get(projectNodeKey(node.parentSection, node.parentProjectId)) ?? null
    }
    return SECTIONS[node.parentSection]
  }

  findSession(sessionId: string): ExtensionSession | null {
    return this.model?.sessions.find((session) => session.id === sessionId) ?? null
  }

  dispose(): void {
    this.treeSelectionDisposable?.dispose()
    this.changedEmitter.dispose()
    this.modelChangedEmitter.dispose()
  }

  private rebuildNodeCache(model: ExtensionCockpitModel): void {
    this.projectNodes.clear()
    this.sessionNodes.clear()

    for (const [section, groups] of [
      ['workspace', model.workspaceProjects],
      ['recent', model.recentElsewhere],
    ] as const) {
      for (const group of groups) {
        const projectNode: ProjectTreeNode = { group, kind: 'project', parentSection: section }
        this.projectNodes.set(projectNodeKey(section, group.project.id), projectNode)
        for (const session of group.sessions) {
          this.sessionNodes.set(session.id, {
            kind: 'session',
            parentProjectId: group.project.id,
            parentSection: section,
            session,
          })
        }
      }
    }

    for (const session of model.attentionElsewhere) {
      this.sessionNodes.set(session.id, sessionNode(session, 'attention'))
    }
  }

  private sectionChildren(section: SectionId): TreeNode[] {
    if (!this.model) return []
    if (section === 'attention') {
      return this.model.attentionElsewhere.map(
        (session) => this.sessionNodes.get(session.id) ?? sessionNode(session, section)
      )
    }
    const groups =
      section === 'workspace' ? this.model.workspaceProjects : this.model.recentElsewhere
    return groups.map(
      (group) =>
        this.projectNodes.get(projectNodeKey(section, group.project.id)) ?? {
          group,
          kind: 'project',
          parentSection: section,
        }
    )
  }

  private async restoreSelection(): Promise<void> {
    if (!this.treeView || !this.selectedSessionId) return
    const node = this.sessionNodes.get(this.selectedSessionId)
    if (!node) {
      this.selectedSessionId = null
      return
    }
    await Promise.resolve(
      this.treeView.reveal(node, { expand: true, focus: false, select: true })
    ).catch(() => {})
  }

  private updateViewBadge(model: ExtensionCockpitModel): void {
    if (!this.treeView) return
    this.treeView.badge =
      model.summary.attentionCount > 0
        ? {
            tooltip: `${model.summary.attentionCount} session${model.summary.attentionCount === 1 ? '' : 's'} need attention`,
            value: model.summary.attentionCount,
          }
        : undefined
  }
}

export function asSessionTreeNode(value: unknown): SessionTreeNode | null {
  return isTreeNode(value) && value.kind === 'session' ? value : null
}

export function asProjectTreeNode(value: unknown): ProjectTreeNode | null {
  return isTreeNode(value) && value.kind === 'project' ? value : null
}

function sectionTreeItem(
  node: SectionTreeNode,
  model: ExtensionCockpitModel | null
): vscode.TreeItem {
  const definitions: Record<
    SectionId,
    { icon: string; label: string; state: vscode.TreeItemCollapsibleState }
  > = {
    attention: {
      icon: 'warning',
      label: 'Needs Attention Elsewhere',
      state: vscode.TreeItemCollapsibleState.Expanded,
    },
    recent: {
      icon: 'history',
      label: 'Recent Elsewhere',
      state: vscode.TreeItemCollapsibleState.Collapsed,
    },
    workspace: {
      icon: 'window',
      label: 'Current Workspace',
      state: vscode.TreeItemCollapsibleState.Expanded,
    },
  }
  const definition = definitions[node.id]
  const item = new vscode.TreeItem(definition.label, definition.state)
  item.contextValue = `swoopSection.${node.id}`
  item.iconPath = new vscode.ThemeIcon(definition.icon)
  if (model) {
    const count =
      node.id === 'workspace'
        ? model.summary.workspaceSessionCount
        : node.id === 'attention'
          ? model.attentionElsewhere.length
          : model.recentElsewhere.reduce((sum, group) => sum + group.sessions.length, 0)
    item.description = String(count)
  }
  return item
}

function projectTreeItem(project: ExtensionProject): vscode.TreeItem {
  const item = new vscode.TreeItem(project.name, vscode.TreeItemCollapsibleState.Expanded)
  item.contextValue = 'swoopProject'
  item.description = `${project.sessionCount} session${project.sessionCount === 1 ? '' : 's'}`
  item.tooltip = [
    project.path,
    `Updated: ${formatRelativeTime(project.updated)}`,
    project.memoryStatus && project.memoryStatus !== 'none'
      ? `Project Memory: ${project.memoryStatus}`
      : null,
  ]
    .filter(Boolean)
    .join('\n')
  item.iconPath = new vscode.ThemeIcon(project.memoryStatus === 'orange' ? 'cloud-upload' : 'folder')
  return item
}

function sessionTreeItem(session: ExtensionSession): vscode.TreeItem {
  const item = new vscode.TreeItem(session.title, vscode.TreeItemCollapsibleState.None)
  item.command = {
    arguments: [{ kind: 'session', parentSection: 'workspace', session } satisfies SessionTreeNode],
    command: 'swoop.openSessionDetail',
    title: 'Open Session Inspector',
  }
  item.contextValue = session.isActive ? 'swoopSessionActive' : 'swoopSession'
  item.description = [session.branch ?? session.currentBranch, formatRelativeTime(session.updated)]
    .filter(Boolean)
    .join(' · ')
  const tooltip = new vscode.MarkdownString(undefined, true)
  tooltip.appendMarkdown(`**${session.advice.title}**\n\n${session.advice.explanation}\n\n`)
  tooltip.appendMarkdown(`- Project: \`${escapeMarkdownCode(session.projectPath)}\`\n`)
  tooltip.appendMarkdown(`- Messages: ${session.messageCount}\n`)
  const context = formatContextTokens(session.contextTokens)
  if (context) tooltip.appendMarkdown(`- Context: ${context}\n`)
  if (session.branch) tooltip.appendMarkdown(`- Recorded branch: \`${session.branch}\`\n`)
  if (session.currentBranch) tooltip.appendMarkdown(`- Current branch: \`${session.currentBranch}\`\n`)
  item.tooltip = tooltip
  item.iconPath = new vscode.ThemeIcon(
    statusThemeIconId(session.primaryStatus, session.isActive),
    session.advice.severity === 'blocked'
      ? new vscode.ThemeColor('problemsErrorIcon.foreground')
      : session.advice.severity === 'warning'
        ? new vscode.ThemeColor('problemsWarningIcon.foreground')
        : undefined
  )
  return item
}

function sessionNode(session: ExtensionSession, section: SectionId): SessionTreeNode {
  return { kind: 'session', parentSection: section, session }
}

function projectNodeKey(section: SectionId, projectId: string): string {
  return `${section}:${projectId}`
}

function isTreeNode(value: unknown): value is TreeNode {
  if (value === null || typeof value !== 'object') return false
  const node = value as Partial<TreeNode>
  return node.kind === 'project' || node.kind === 'section' || node.kind === 'session'
}

function escapeMarkdownCode(value: string): string {
  return value.replace(/`/g, '\\`')
}
