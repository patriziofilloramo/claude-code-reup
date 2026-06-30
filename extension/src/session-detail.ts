import { stat } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'

import * as vscode from 'vscode'

import { readOrgData, recordTagInPalette } from '../../src/core/org/org-prefs.js'
import { validateAndNormalizeTags } from '../../src/core/org/org-validation.js'
import { normalizePathForComparison } from '../../src/core/project/path-comparison.js'
import {
  normalizeSessionAlias,
  setSessionAlias,
  setSessionArchived,
  setSessionTags,
} from '../../src/core/session/session-metadata.js'
import { pathIdentityKey } from '../../src/core/session/session-file-search.js'
import {
  loadSessionPreview,
  sessionTranscriptPath,
  type SessionPreview,
} from '../../src/core/session/session-preview.js'
import { copySessionHandoff } from './handoff.js'
import { formatRelativeTime, statusCodicon } from './formatting.js'
import {
  emptyInspectorHtml,
  isInspectorMessage,
  renderInspectorHtml,
  type InspectorMessage,
  type TouchedOverlap,
} from './inspector-html.js'
import { getReupConfigurationValue } from './configuration.js'
import type { ReupLogger } from './logger.js'
import type { SessionResumeService } from './resume-target.js'
import type { ExtensionSession, ReupDataSource } from './reup-data.js'
import { pickTouchedSession } from './touched-search.js'

const INSPECTOR_VIEW_ID = 'reup.inspector'
const ADD_TAG_BUTTON: vscode.QuickInputButton = {
  iconPath: new vscode.ThemeIcon('add'),
  tooltip: 'Add a new tag',
}

interface PreviewCacheEntry {
  mtimeMs: number
  preview: SessionPreview
}

interface SessionReference {
  projectId: string
  sessionId: string
}

export class ReupInspectorProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private readonly viewDisposables: vscode.Disposable[] = []
  private readonly previewCache = new Map<string, PreviewCacheEntry>()
  private selectedReference: SessionReference | null = null
  private selectedSession: ExtensionSession | null = null
  private selectedPreview: SessionPreview | null = null
  private lastRenderKey: string | null = null
  private renderRequestId = 0
  private view: vscode.WebviewView | null = null

  constructor(
    private readonly dataSource: ReupDataSource,
    private readonly logger: ReupLogger,
    private readonly onDidMutate: () => Promise<void>,
    private readonly resumeService: SessionResumeService
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view
    this.lastRenderKey = null
    view.webview.options = { enableScripts: true, localResourceRoots: [] }
    this.viewDisposables.push(
      view.webview.onDidReceiveMessage((message: unknown) => {
        if (!isInspectorMessage(message)) {
          this.logger.error('rejected invalid inspector message', message)
          return
        }
        void this.handleMessage(message)
      }),
      view.onDidDispose(() => {
        if (this.view === view) {
          this.view = null
          for (const disposable of this.viewDisposables.splice(0)) disposable.dispose()
        }
      })
    )
    void this.render()
  }

  async showSession(session: ExtensionSession, reveal = true): Promise<void> {
    this.selectedReference = { projectId: session.projectId, sessionId: session.id }
    this.selectedSession = session
    this.selectedPreview = null
    if (reveal) await vscode.commands.executeCommand(`${INSPECTOR_VIEW_ID}.focus`)
    await this.render()
  }

  async refreshSelected(sessions?: readonly ExtensionSession[]): Promise<void> {
    if (!this.selectedReference) return
    const session = sessions
      ? (sessions.find(
          (candidate) =>
            candidate.projectId === this.selectedReference?.projectId &&
            candidate.id === this.selectedReference.sessionId
        ) ?? null)
      : await this.dataSource.resolveSession(
          this.selectedReference.projectId,
          this.selectedReference.sessionId
        )
    this.selectedSession = session
    if (!session) this.selectedReference = null
    await this.render()
  }

  async editAlias(session = this.selectedSession): Promise<void> {
    const current = await this.resolveCurrent(session)
    if (!current) return
    const alias = await vscode.window.showInputBox({
      ignoreFocusOut: true,
      placeHolder: 'Leave empty to restore the transcript title',
      prompt: 'Set a local Reup alias for this session',
      value: current.title,
      validateInput: (value) => {
        try {
          normalizeSessionAlias(value)
          return null
        } catch (error) {
          return error instanceof Error ? error.message : String(error)
        }
      },
    })
    if (alias === undefined) return
    await setSessionAlias(current.projectId, current.id, normalizeSessionAlias(alias))
    await this.afterMutation('Session alias updated.')
  }

  async toggleArchive(session = this.selectedSession): Promise<void> {
    const current = await this.resolveCurrent(session)
    if (!current) return
    if (current.isActive) {
      void vscode.window.showWarningMessage('Active sessions cannot be archived.')
      return
    }

    const nextArchived = !current.archived
    await setSessionArchived(current.projectId, current.id, nextArchived)
    await this.onDidMutate()
    await this.refreshSelected()
    const undo = await vscode.window.showInformationMessage(
      nextArchived ? 'Session archived.' : 'Session restored.',
      'Undo'
    )
    if (undo === 'Undo') {
      await setSessionArchived(current.projectId, current.id, !nextArchived)
      await this.afterMutation('Archive change undone.')
    }
  }

  async editTags(session = this.selectedSession): Promise<void> {
    const current = await this.resolveCurrent(session)
    if (!current) return
    const tags = await pickTags(current.tags)
    if (!tags) return
    const normalizedTags = validateAndNormalizeTags(tags)
    await setSessionTags(current.projectId, current.id, normalizedTags)
    await Promise.all(normalizedTags.map((tag) => recordTagInPalette(tag)))
    await this.afterMutation('Session tags updated.')
  }

  dispose(): void {
    for (const disposable of this.viewDisposables.splice(0)) disposable.dispose()
    this.previewCache.clear()
    this.lastRenderKey = null
    this.renderRequestId += 1
    this.view = null
  }

  private async handleMessage(message: InspectorMessage): Promise<void> {
    const current = await this.resolveCurrent()
    if (!current) return

    try {
      switch (message.type) {
        case 'resume':
          await this.resumeService.resume(current)
          break
        case 'copyHandoff':
          await copySessionHandoff(current, this.logger)
          void vscode.window.showInformationMessage('Reup handoff packet copied.')
          break
        case 'editAlias':
          await this.editAlias(current)
          break
        case 'archive':
          await this.toggleArchive(current)
          break
        case 'editTags':
          await this.editTags(current)
          break
        case 'revealProject':
          await vscode.commands.executeCommand(
            'revealFileInOS',
            vscode.Uri.file(current.projectPath)
          )
          break
        case 'openFile':
          await this.openPreviewFile(current, message.path)
          break
        case 'touchedSessions':
          await this.showTouchedSessions(current, message.path)
          break
      }
    } catch (error) {
      this.logger.error(`inspector action failed: ${message.type}`, error)
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error))
    }
  }

  private async resolveCurrent(
    candidate: ExtensionSession | null = this.selectedSession
  ): Promise<ExtensionSession | null> {
    if (!candidate) {
      void vscode.window.showInformationMessage('Select a Reup session first.')
      return null
    }
    const current = await this.dataSource.resolveSession(candidate.projectId, candidate.id)
    if (!current) {
      void vscode.window.showWarningMessage('This session is no longer available locally.')
      await this.refreshSelected()
      return null
    }
    this.selectedReference = { projectId: current.projectId, sessionId: current.id }
    this.selectedSession = current
    return current
  }

  private async afterMutation(message: string): Promise<void> {
    await this.onDidMutate()
    await this.refreshSelected()
    void vscode.window.showInformationMessage(message)
  }

  private async render(): Promise<void> {
    if (!this.view) return
    const requestId = ++this.renderRequestId
    if (!this.selectedSession) {
      if (this.lastRenderKey === 'empty') return
      this.lastRenderKey = 'empty'
      this.view.webview.html = emptyInspectorHtml()
      return
    }
    const session = this.selectedSession
    const preview = await this.loadPreview(session)
    if (requestId !== this.renderRequestId || this.selectedSession !== session || !this.view) return
    const overlap = await this.computeTouchedOverlap(preview)
    if (requestId !== this.renderRequestId || this.selectedSession !== session || !this.view) return
    this.selectedPreview = preview
    const renderKey = JSON.stringify([session, preview, overlap])
    if (this.lastRenderKey === renderKey) return
    this.lastRenderKey = renderKey
    this.view.webview.html = renderInspectorHtml(session, preview, overlap)
  }

  /** Maps each touched file to how many *other* sessions also edited it. */
  private async computeTouchedOverlap(preview: SessionPreview): Promise<TouchedOverlap> {
    const includeArchived = getReupConfigurationValue<boolean>('includeArchived', false)
    const counts = await this.dataSource.touchedFileCounts(includeArchived)
    const overlap: TouchedOverlap = {}
    for (const path of preview.touchedFiles) {
      const total = counts.get(pathIdentityKey(path)) ?? 1
      if (total > 1) overlap[path] = total - 1
    }
    return overlap
  }

  /** Opens a picker of the other sessions that edited the given file. */
  private async showTouchedSessions(current: ExtensionSession, path: string): Promise<void> {
    const session = await pickTouchedSession(this.dataSource, current.id, path)
    if (session) await this.showSession(session)
  }

  private async loadPreview(session: ExtensionSession): Promise<SessionPreview> {
    const transcriptPath = sessionTranscriptPath(session.projectId, session.id)
    const mtimeMs = await stat(transcriptPath)
      .then((value) => value.mtimeMs)
      .catch(() => -1)
    const cached = this.previewCache.get(transcriptPath)
    if (cached?.mtimeMs === mtimeMs) return cached.preview
    const preview = await loadSessionPreview(transcriptPath)
    this.previewCache.set(transcriptPath, { mtimeMs, preview })
    return preview
  }

  private async openPreviewFile(session: ExtensionSession, requestedPath: string): Promise<void> {
    const preview = this.selectedPreview ?? (await this.loadPreview(session))
    const allowedPaths = [...preview.touchedFiles, ...preview.automaticContext.readFiles].map(
      (path) =>
        normalizePathForComparison(isAbsolute(path) ? path : resolve(session.projectPath, path))
    )
    const absolutePath = isAbsolute(requestedPath)
      ? requestedPath
      : resolve(session.projectPath, requestedPath)
    if (!allowedPaths.includes(normalizePathForComparison(absolutePath))) {
      throw new Error('The requested file is not part of the current session preview.')
    }
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(absolutePath))
    await vscode.window.showTextDocument(document, { preview: true })
  }
}

export async function openSessionDetail(
  provider: ReupInspectorProvider,
  session: ExtensionSession
): Promise<void> {
  await provider.showSession(session)
}

export async function showSessionDetailPicker(
  provider: ReupInspectorProvider,
  dataSource: ReupDataSource,
  logger: ReupLogger
): Promise<void> {
  try {
    const model = await dataSource.loadModel({
      includeArchived: getReupConfigurationValue<boolean>('includeArchived', false),
      includePreviewHints: false,
      workspacePath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    })
    if (model.sessions.length === 0) {
      void vscode.window.showInformationMessage('No Reup sessions found.')
      return
    }
    const selected = await vscode.window.showQuickPick(
      model.sessions.map((session) => ({
        description: `${session.projectName} · ${formatRelativeTime(session.updated)}`,
        detail: session.advice.explanation,
        label: `${statusCodicon(session.primaryStatus, session.isActive)} ${session.title}`,
        session,
      })),
      {
        matchOnDescription: true,
        matchOnDetail: true,
        placeHolder: 'Open a Reup Session Inspector',
        title: 'Reup: Open Session Inspector',
      }
    )
    if (selected) await provider.showSession(selected.session)
  } catch (error) {
    logger.error('session inspector picker failed', error)
    void vscode.window.showErrorMessage(
      error instanceof Error ? error.message : 'Could not open Reup Session Inspector.'
    )
  }
}

async function pickTags(currentTags: string[]): Promise<string[] | null> {
  const orgData = await readOrgData()
  const quickPick = vscode.window.createQuickPick<vscode.QuickPickItem>()
  quickPick.canSelectMany = true
  quickPick.ignoreFocusOut = true
  quickPick.matchOnDescription = true
  quickPick.placeholder = 'Select up to 8 tags'
  quickPick.title = 'Reup: Edit Session Tags'
  quickPick.buttons = [ADD_TAG_BUTTON]

  let values = [...new Set([...currentTags, ...orgData.tagPalette])].sort()
  const rebuild = (): void => {
    quickPick.items = values.map((tag) => ({ label: tag }))
    quickPick.selectedItems = quickPick.items.filter((item) => currentTags.includes(item.label))
  }
  rebuild()

  return new Promise<string[] | null>((resolvePromise) => {
    let resolved = false
    const finish = (value: string[] | null): void => {
      if (resolved) return
      resolved = true
      quickPick.dispose()
      resolvePromise(value)
    }
    quickPick.onDidAccept(() => finish(quickPick.selectedItems.map((item) => item.label)))
    quickPick.onDidHide(() => finish(null))
    quickPick.onDidTriggerButton(async (button) => {
      if (button !== ADD_TAG_BUTTON) return
      const rawTag = await vscode.window.showInputBox({
        prompt: 'Add a lowercase tag (letters, numbers, and hyphens)',
        validateInput: (value) => {
          try {
            validateAndNormalizeTags([value])
            return null
          } catch (error) {
            return error instanceof Error ? error.message : String(error)
          }
        },
      })
      if (rawTag === undefined) return
      const [tag] = validateAndNormalizeTags([rawTag])
      if (!tag) return
      const selectedTags = new Set(quickPick.selectedItems.map((item) => item.label))
      selectedTags.add(tag)
      values = [...new Set([...values, tag])].sort()
      rebuild()
      quickPick.selectedItems = quickPick.items.filter((item) => selectedTags.has(item.label))
    })
    quickPick.show()
  })
}
