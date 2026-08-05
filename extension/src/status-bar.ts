import * as vscode from 'vscode'

import { formatContextTokens, formatRelativeTime } from './formatting.js'
import { affectsReupConfiguration, getReupConfigurationValue } from './configuration.js'
import type { ExtensionCockpitModel } from './cockpit-model.js'

export class CockpitStatusBar implements vscode.Disposable {
  private readonly configurationListener = vscode.workspace.onDidChangeConfiguration((event) => {
    if (affectsReupConfiguration(event, 'showStatusBar')) this.render()
  })
  private model: ExtensionCockpitModel | null = null
  private readonly statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 90)
  private visible = false

  constructor() {
    this.statusBar.command = 'reup.focusCockpit'
    this.statusBar.name = 'Reup Cockpit'
  }

  setVisible(visible: boolean): void {
    this.visible = visible
    this.render()
  }

  update(model: ExtensionCockpitModel): void {
    this.model = model
    this.render()
  }

  dispose(): void {
    this.configurationListener.dispose()
    this.statusBar.dispose()
  }

  /**
   * Draws the counts for the resolved scope, never the device-wide totals. An
   * indicator in this window that counts another repository's sessions reads
   * as a demand for attention the user cannot act on from here.
   */
  private render(): void {
    const enabled = getReupConfigurationValue<boolean>('showStatusBar', true)
    const summary = this.model?.summary
    if (
      !enabled ||
      !this.visible ||
      !summary ||
      (summary.scopedActiveCount === 0 && summary.scopedAttentionCount === 0)
    ) {
      this.statusBar.hide()
      return
    }

    const parts = [
      summary.scopedActiveCount > 0 ? `$(pulse) ${summary.scopedActiveCount}` : null,
      summary.scopedAttentionCount > 0 ? `$(warning) ${summary.scopedAttentionCount}` : null,
    ].filter(Boolean)
    this.statusBar.text = `Reup ${parts.join(' · ')}`
    this.statusBar.tooltip = statusTooltip(this.model!)
    this.statusBar.show()
  }
}

function statusTooltip(model: ExtensionCockpitModel): vscode.MarkdownString {
  const workspaceScoped = model.resolvedScope === 'workspace'
  const tooltip = new vscode.MarkdownString(undefined, true)
  tooltip.appendMarkdown('**Reup Workspace Cockpit**\n\n')
  tooltip.appendMarkdown(
    `- Showing: ${workspaceScoped ? 'this workspace only' : 'all local projects'}\n`
  )
  tooltip.appendMarkdown(`- Active sessions: ${model.summary.scopedActiveCount}\n`)
  tooltip.appendMarkdown(`- Need attention: ${model.summary.scopedAttentionCount}\n`)
  tooltip.appendMarkdown(`- In current workspace: ${model.summary.workspaceSessionCount}\n`)
  if (workspaceScoped && model.summary.elsewhereSessionCount > 0) {
    tooltip.appendMarkdown(`- Hidden in other projects: ${model.summary.elsewhereSessionCount}\n`)
  }
  const scopedSessions = workspaceScoped
    ? model.workspaceProjects.flatMap((group) => group.sessions)
    : model.sessions
  const largestContext = scopedSessions.reduce<number | null>((largest, session) => {
    if (session.contextTokens === null) return largest
    return largest === null ? session.contextTokens : Math.max(largest, session.contextTokens)
  }, null)
  if (largestContext !== null) {
    tooltip.appendMarkdown(`- Largest analysed context: ${formatContextTokens(largestContext)}\n`)
  }
  tooltip.appendMarkdown(`\nUpdated ${formatRelativeTime(model.generatedAt)}. Click to focus Reup.`)
  return tooltip
}
