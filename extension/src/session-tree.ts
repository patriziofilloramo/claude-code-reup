import * as vscode from 'vscode'

import { formatRelativeTime, statusThemeIconId } from './formatting.js'
import type { SwoopLogger } from './logger.js'
import type { ExtensionProject, ExtensionSession, SwoopDataSource } from './swoop-data.js'

type TreeNode = ProjectTreeNode | SessionTreeNode

interface ProjectTreeNode {
  kind: 'project'
  project: ExtensionProject
}

interface SessionTreeNode {
  kind: 'session'
  session: ExtensionSession
}

export class SwoopSessionTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly changedEmitter = new vscode.EventEmitter<TreeNode | undefined>()
  private projects: ExtensionProject[] = []
  private sessionsByProject = new Map<string, ExtensionSession[]>()

  readonly onDidChangeTreeData = this.changedEmitter.event

  constructor(
    private readonly dataSource: SwoopDataSource,
    private readonly logger: SwoopLogger
  ) {}

  async refresh(): Promise<void> {
    try {
      const model = await this.dataSource.loadModel({
        includeArchived: vscode.workspace
          .getConfiguration('swoop')
          .get<boolean>('includeArchived', false),
        includePreviewHints: false,
        workspacePath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      })
      this.projects = model.projects
      this.sessionsByProject = groupSessionsByProject(model.sessions)
      this.changedEmitter.fire(undefined)
      this.logger.info('refreshed VS Code tree', {
        projects: this.projects.length,
        sessions: model.sessions.length,
      })
    } catch (error) {
      this.logger.error('tree refresh failed', error)
      void vscode.window.showErrorMessage('Swoop could not refresh sessions. See Output: Swoop.')
    }
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    if (node.kind === 'project') return projectTreeItem(node.project)
    return sessionTreeItem(node.session)
  }

  getChildren(node?: TreeNode): TreeNode[] {
    if (!node) return this.projects.map((project) => ({ kind: 'project', project }))
    if (node.kind === 'project') {
      return (this.sessionsByProject.get(node.project.id) ?? []).map((session) => ({
        kind: 'session',
        session,
      }))
    }
    return []
  }
}

export function asSessionTreeNode(value: unknown): SessionTreeNode | null {
  return isTreeNode(value) && value.kind === 'session' ? value : null
}

export function asProjectTreeNode(value: unknown): ProjectTreeNode | null {
  return isTreeNode(value) && value.kind === 'project' ? value : null
}

function projectTreeItem(project: ExtensionProject): vscode.TreeItem {
  const item = new vscode.TreeItem(project.name, vscode.TreeItemCollapsibleState.Expanded)
  item.contextValue = 'swoopProject'
  item.description = `${project.sessionCount} sessions`
  item.tooltip = `${project.path}\nUpdated: ${formatRelativeTime(project.updated)}`
  item.iconPath = new vscode.ThemeIcon('folder')
  return item
}

function sessionTreeItem(session: ExtensionSession): vscode.TreeItem {
  const item = new vscode.TreeItem(session.title, vscode.TreeItemCollapsibleState.None)
  item.command = {
    arguments: [{ kind: 'session', session } satisfies SessionTreeNode],
    command: 'swoop.tree.resumeSession',
    title: 'Resume Session',
  }
  item.contextValue = 'swoopSession'
  item.description = formatRelativeTime(session.updated)
  item.tooltip = [
    session.projectPath,
    session.branch ? `Branch: ${session.branch}` : null,
    session.currentBranch ? `Current branch: ${session.currentBranch}` : null,
    `${session.messageCount} messages`,
    session.isActive ? 'Active now' : null,
    session.needsAttention ? `Needs attention: ${session.primaryStatus}` : null,
  ]
    .filter(Boolean)
    .join('\n')
  item.iconPath = new vscode.ThemeIcon(statusThemeIconId(session.primaryStatus, session.isActive))
  return item
}

function groupSessionsByProject(sessions: ExtensionSession[]): Map<string, ExtensionSession[]> {
  const groups = new Map<string, ExtensionSession[]>()
  for (const session of sessions) {
    const projectSessions = groups.get(session.projectId) ?? []
    projectSessions.push(session)
    groups.set(session.projectId, projectSessions)
  }
  return groups
}

function isTreeNode(value: unknown): value is TreeNode {
  if (value === null || typeof value !== 'object') return false
  const node = value as Partial<TreeNode>
  return node.kind === 'project' || node.kind === 'session'
}
