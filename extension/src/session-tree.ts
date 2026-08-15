import * as vscode from 'vscode'

import {
  formatContextTokens,
  formatRelativeTime,
  statusThemeColorId,
  statusThemeIconId,
} from './formatting.js'
import type { CockpitProjectGroup, ExtensionCockpitModel } from './cockpit-model.js'
import {
  getCountRepositorySessionsSetting,
  getReupConfigurationValue,
  getSessionScopeSetting,
} from './configuration.js'
import type { ReupLogger } from './logger.js'
import type { ExtensionSession, ReupDataSource } from './reup-data.js'

type SectionId = 'workspace' | 'repository' | 'attention' | 'recent'

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
  repository: { id: 'repository', kind: 'section' },
  workspace: { id: 'workspace', kind: 'section' },
}

export class ReupSessionTreeProvider
  implements vscode.TreeDataProvider<TreeNode>, vscode.Disposable
{
  private readonly changedEmitter = new vscode.EventEmitter<TreeNode | undefined>()
  private readonly modelChangedEmitter = new vscode.EventEmitter<ExtensionCockpitModel>()
  private modelFingerprint: string | null = null
  private renderedFingerprint: string | null = null
  private model: ExtensionCockpitModel | null = null
  private hadLoadError = false
  private selectedSessionId: string | null = null
  private sessionNodes = new Map<string, SessionTreeNode>()
  private projectNodes = new Map<string, ProjectTreeNode>()
  private treeView: vscode.TreeView<TreeNode> | null = null
  private treeSelectionDisposable: vscode.Disposable | null = null

  readonly onDidChangeTreeData = this.changedEmitter.event
  readonly onDidChangeModel = this.modelChangedEmitter.event

  constructor(
    private readonly dataSource: ReupDataSource,
    private readonly logger: ReupLogger
  ) {}

  attachTreeView(treeView: vscode.TreeView<TreeNode>): void {
    this.treeSelectionDisposable?.dispose()
    this.treeView = treeView
    this.treeSelectionDisposable = treeView.onDidChangeSelection((event) => {
      const sessionNode = event.selection.find((node) => node.kind === 'session')
      if (sessionNode?.kind === 'session') this.selectedSessionId = sessionNode.session.id
    })
  }

  async refresh(options: { notifyView?: boolean } = {}): Promise<boolean> {
    try {
      const model = await this.dataSource.loadCockpitModel({
        activeEditorPath: vscode.window.activeTextEditor?.document.uri.fsPath,
        countRepositorySessions: getCountRepositorySessionsSetting(),
        includeArchived: getReupConfigurationValue<boolean>('includeArchived', false),
        sessionScope: getSessionScopeSetting(),
        workspaceRoots: (vscode.workspace.workspaceFolders ?? []).map(
          (folder) => folder.uri.fsPath
        ),
      })
      const fingerprint = cockpitModelFingerprint(model)
      const changed = fingerprint !== this.modelFingerprint
      const recoveredFromError = this.hadLoadError
      this.hadLoadError = false
      this.model = model
      if (changed) {
        this.modelFingerprint = fingerprint
        this.rebuildNodeCache(model)
      }
      const shouldNotifyView =
        options.notifyView !== false && this.renderedFingerprint !== fingerprint
      if (changed || recoveredFromError) {
        await Promise.all([
          vscode.commands.executeCommand(
            'setContext',
            'reup.hasSessions',
            model.sessions.length > 0
          ),
          vscode.commands.executeCommand(
            'setContext',
            'reup.hasWorkspaceSessions',
            model.summary.workspaceSessionCount > 0
          ),
          vscode.commands.executeCommand(
            'setContext',
            'reup.hasWorkspaceRoots',
            model.workspaceRoots.length > 0
          ),
          vscode.commands.executeCommand('setContext', 'reup.sessionScope', model.resolvedScope),
          vscode.commands.executeCommand('setContext', 'reup.hasLoadError', false),
        ])
      }
      if (shouldNotifyView) {
        this.renderedFingerprint = fingerprint
        this.changedEmitter.fire(undefined)
        this.modelChangedEmitter.fire(model)
        this.updateViewBadge(model)
      }
      this.logger.info('refreshed VS Code cockpit', {
        active: model.summary.activeCount,
        attention: model.summary.attentionCount,
        changed,
        projects: model.projects.length,
        repositorySessions: model.summary.repositorySessionCount,
        scope: model.resolvedScope,
        sessions: model.sessions.length,
        workspaceSessions: model.summary.workspaceSessionCount,
      })
      return changed
    } catch (error) {
      this.hadLoadError = true
      await vscode.commands.executeCommand('setContext', 'reup.hasLoadError', true)
      this.logger.error('cockpit refresh failed', error)
      void vscode.window.showErrorMessage('Reup could not refresh sessions. See Output: Reup.')
      return false
    }
  }

  getModel(): ExtensionCockpitModel | null {
    return this.model
  }

  /**
   * Publishes the latest in-memory model when the TreeView becomes visible.
   * Returns false only when no model has been loaded yet and disk I/O is needed.
   */
  renderCurrentModel(): boolean {
    if (!this.model || !this.modelFingerprint) return false
    if (this.renderedFingerprint === this.modelFingerprint) return true
    this.renderedFingerprint = this.modelFingerprint
    this.changedEmitter.fire(undefined)
    this.modelChangedEmitter.fire(this.model)
    this.updateViewBadge(this.model)
    return true
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    if (node.kind === 'section') return sectionTreeItem(node, this.model)
    if (node.kind === 'project') return projectTreeItem(node)
    return sessionTreeItem(node)
  }

  getChildren(node?: TreeNode): TreeNode[] {
    if (!this.model) return []
    if (!node) {
      // Workspace scope answers for the open folder only, so the elsewhere
      // sections are absent rather than empty. buildCockpitModel already
      // cleared them; this keeps the tree from drawing two dead headers.
      // The repository section appears only when the open folder sits inside a
      // larger repository. Opening a repository root — the ordinary case —
      // leaves it empty, and an empty header is worse than no header.
      const nearby = [
        SECTIONS.workspace,
        ...(this.model.repositoryProjects.length > 0 ? [SECTIONS.repository] : []),
      ]
      if (this.model.resolvedScope === 'workspace') return nearby
      return [
        ...nearby,
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
    const nextProjectNodes = new Map<string, ProjectTreeNode>()
    const nextSessionNodes = new Map<string, SessionTreeNode>()
    const existingProjectsById = new Map(
      [...this.projectNodes.values()].map((node) => [node.group.project.id, node])
    )

    for (const [section, groups] of [
      ['workspace', model.workspaceProjects],
      ['repository', model.repositoryProjects],
      ['recent', model.recentElsewhere],
    ] as const) {
      for (const group of groups) {
        const key = projectNodeKey(section, group.project.id)
        const projectNode = this.projectNodes.get(key) ??
          existingProjectsById.get(group.project.id) ?? {
            group,
            kind: 'project',
            parentSection: section,
          }
        projectNode.group = group
        projectNode.parentSection = section
        nextProjectNodes.set(key, projectNode)
        for (const session of group.sessions) {
          const node = this.sessionNodes.get(session.id) ?? sessionNode(session, section)
          node.parentProjectId = group.project.id
          node.parentSection = section
          node.session = session
          nextSessionNodes.set(session.id, node)
        }
      }
    }

    for (const session of model.attentionElsewhere) {
      const node = this.sessionNodes.get(session.id) ?? sessionNode(session, 'attention')
      delete node.parentProjectId
      node.parentSection = 'attention'
      node.session = session
      nextSessionNodes.set(session.id, node)
    }

    this.projectNodes = nextProjectNodes
    this.sessionNodes = nextSessionNodes
    if (this.selectedSessionId && !nextSessionNodes.has(this.selectedSessionId)) {
      this.selectedSessionId = null
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
      section === 'workspace'
        ? this.model.workspaceProjects
        : section === 'repository'
          ? this.model.repositoryProjects
          : this.model.recentElsewhere
    return groups.map(
      (group) =>
        this.projectNodes.get(projectNodeKey(section, group.project.id)) ?? {
          group,
          kind: 'project',
          parentSection: section,
        }
    )
  }

  /**
   * Badges the view with the attention count *inside the resolved scope*. A
   * badge on this window must never be about a session in another repository.
   */
  private updateViewBadge(model: ExtensionCockpitModel): void {
    if (!this.treeView) return
    const attention = model.summary.scopedAttentionCount
    this.treeView.badge =
      attention > 0
        ? {
            tooltip: `${attention} session${attention === 1 ? '' : 's'} need attention`,
            value: attention,
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
      state: vscode.TreeItemCollapsibleState.Collapsed,
    },
    recent: {
      icon: 'history',
      label: 'Recent Elsewhere',
      state: vscode.TreeItemCollapsibleState.Collapsed,
    },
    repository: {
      icon: 'repo',
      label: 'Rest of Repository',
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
  item.id = `reup.section.${node.id}`
  item.contextValue = `reupSection.${node.id}`
  item.iconPath = new vscode.ThemeIcon(definition.icon)
  if (model) {
    const count =
      node.id === 'workspace'
        ? model.summary.workspaceSessionCount
        : node.id === 'repository'
          ? model.summary.repositorySessionCount
          : node.id === 'attention'
            ? model.attentionElsewhere.length
            : model.recentElsewhere.reduce((sum, group) => sum + group.sessions.length, 0)
    item.description = String(count)
  }
  return item
}

function projectTreeItem(node: ProjectTreeNode): vscode.TreeItem {
  const { group } = node
  const project = group.project
  const item = new vscode.TreeItem(project.name, vscode.TreeItemCollapsibleState.Expanded)
  item.id = `reup.project.${project.id}`
  item.contextValue = 'reupProject'
  const visibleSessionCount = group.sessions.length
  item.description = `${visibleSessionCount} session${visibleSessionCount === 1 ? '' : 's'}`
  item.tooltip = [project.path, `Updated: ${formatRelativeTime(project.updated)}`]
    .filter(Boolean)
    .join('\n')
  item.iconPath = new vscode.ThemeIcon('folder')
  return item
}

function sessionTreeItem(node: SessionTreeNode): vscode.TreeItem {
  const { session } = node
  const item = new vscode.TreeItem(session.title, vscode.TreeItemCollapsibleState.None)
  item.id = `reup.session.${session.projectId}.${session.id}`
  item.command = {
    arguments: [node],
    command: 'reup.openSessionDetail',
    title: 'Open Session Inspector',
  }
  item.contextValue = session.isActive ? 'reupSessionActive' : 'reupSession'
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
  if (session.currentBranch)
    tooltip.appendMarkdown(`- Current branch: \`${session.currentBranch}\`\n`)
  item.tooltip = tooltip
  item.iconPath = new vscode.ThemeIcon(
    statusThemeIconId(session.primaryStatus, session.liveState),
    themeColor(statusThemeColorId(session.primaryStatus, session.liveState))
  )
  return item
}

function themeColor(id: string | undefined): vscode.ThemeColor | undefined {
  return id ? new vscode.ThemeColor(id) : undefined
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

function cockpitModelFingerprint(model: ExtensionCockpitModel): string {
  return JSON.stringify({ ...model, generatedAt: undefined })
}
