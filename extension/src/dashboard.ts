import { randomBytes } from 'node:crypto'
import { isAbsolute, resolve } from 'node:path'

import * as vscode from 'vscode'

import { BRAND_COLOR_MID, renderReupMarkSvg } from '../../src/brand.js'
import { APP } from '../../src/config/app.js'
import { resolveTheme } from '../../src/config/themes/index.js'
import { normalizePathForComparison } from '../../src/core/project/path-comparison.js'
import { pathIdentityKey } from '../../src/core/session/session-file-search.js'
import type { SessionPreview } from '../../src/core/session/session-preview.js'
import { getStoredThemeName } from '../../src/core/theme-preference.js'
import { readLiveUsageSummary } from '../../src/core/usage/live-usage.js'
import {
  buildDashboardModel,
  filterDashboardSessions,
  type DashboardFilter,
  type DashboardModel,
} from './dashboard-model.js'
import type { ExtensionCockpitModel } from './cockpit-model.js'
import { getReupConfigurationValue } from './configuration.js'
import { copySessionHandoff } from './handoff.js'
import type { ReupInspectorProvider } from './session-detail.js'
import { pickTouchedSession } from './touched-search.js'
import type { ReupLogger } from './logger.js'
import type { ResumeTarget, SessionResumeService } from './resume-target.js'
import type { ExtensionSession, ReupDataSource } from './reup-data.js'

const VIEW_TYPE = 'reup.dashboard'

type DashboardMessage =
  | { type: 'archive'; projectId: string; sessionId: string }
  | { type: 'copyHandoff'; projectId: string; sessionId: string }
  | { type: 'deepSearch'; query: string; requestId: number }
  | { type: 'editAlias'; projectId: string; sessionId: string }
  | { type: 'editTags'; projectId: string; sessionId: string }
  | {
      filter: DashboardFilter
      projectId: string | null
      query: string
      requestId: number
      type: 'metadataSearch'
    }
  | { path: string; projectId: string; sessionId: string; type: 'openFile' }
  | { path: string; projectId: string; sessionId: string; type: 'touchedSessions' }
  | { type: 'refresh' }
  | { type: 'copyProjectPath'; projectId: string }
  | { type: 'openProject'; projectId: string }
  | { type: 'revealProjectById'; projectId: string }
  | {
      remember?: boolean
      target?: ResumeTarget
      type: 'resume'
      projectId: string
      sessionId: string
    }
  | { type: 'revealProject'; projectId: string; sessionId: string }
  | { type: 'selectSession'; projectId: string; requestId: number; sessionId: string }

export class ReupDashboard implements vscode.Disposable {
  private readonly panelDisposables: vscode.Disposable[] = []
  private panel: vscode.WebviewPanel | null = null
  private readonly previewCache = new Map<string, SessionPreview>()
  private dashboardModel: DashboardModel | null = null
  private workspaceProjectIds = new Set<string>()
  private previewRequestId = 0
  private searchRequestId = 0
  private usageTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly dataSource: ReupDataSource,
    private readonly inspector: ReupInspectorProvider,
    private readonly logger: ReupLogger,
    private readonly onDidMutate: () => Promise<void>,
    private readonly resumeService: SessionResumeService,
    private readonly onDidChangeVisibility: (visible: boolean) => void,
    private readonly getCurrentModel: () => ExtensionCockpitModel | null
  ) {}

  async open(): Promise<void> {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One)
      return
    }
    const panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      'Reup Dashboard',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    )
    this.panel = panel
    panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'reup.svg')
    this.panelDisposables.push(
      panel.webview.onDidReceiveMessage((message: unknown) => {
        if (!isDashboardMessage(message)) {
          this.logger.error('rejected invalid dashboard message', message)
          return
        }
        void this.handleMessage(message)
      }),
      panel.onDidDispose(() => {
        if (this.panel === panel) {
          this.panel = null
          this.stopUsagePolling()
          this.onDidChangeVisibility(false)
          for (const disposable of this.panelDisposables.splice(0)) disposable.dispose()
        }
      }),
      panel.onDidChangeViewState((event) => {
        if (event.webviewPanel.visible) {
          this.startUsagePolling()
        } else {
          this.stopUsagePolling()
        }
        this.onDidChangeVisibility(event.webviewPanel.visible)
      })
    )
    panel.webview.html = renderDashboardHtml()
    this.startUsagePolling()
    this.onDidChangeVisibility(true)
    const currentModel = this.getCurrentModel()
    await Promise.all([
      currentModel ? this.refresh(currentModel) : Promise.resolve(),
      this.refreshUsage(),
    ])
  }

  async refresh(cockpitModel?: ExtensionCockpitModel): Promise<void> {
    if (!this.panel) return
    this.previewCache.clear()
    try {
      const model =
        cockpitModel ??
        (await this.dataSource.loadCockpitModel({
          activeEditorPath: vscode.window.activeTextEditor?.document.uri.fsPath,
          includeArchived: true,
          workspaceRoots: (vscode.workspace.workspaceFolders ?? []).map(
            (folder) => folder.uri.fsPath
          ),
        }))
      this.dashboardModel = buildDashboardModel(
        model.projects,
        model.sessions,
        model.activeEditorPath
      )
      this.workspaceProjectIds = new Set(model.workspaceProjects.map((group) => group.project.id))
      await this.panel.webview.postMessage({
        model: this.dashboardModel,
        resumeCapabilities: await this.resumeService.getCapabilities(),
        type: 'model',
        workspaceProjectIds: [...this.workspaceProjectIds],
      })
    } catch (error) {
      this.logger.error('dashboard refresh failed', error)
      await this.panel.webview.postMessage({
        message: error instanceof Error ? error.message : String(error),
        type: 'error',
      })
    }
  }

  dispose(): void {
    this.panel?.dispose()
    this.panel = null
    this.stopUsagePolling()
    this.onDidChangeVisibility(false)
    for (const disposable of this.panelDisposables.splice(0)) disposable.dispose()
    this.previewCache.clear()
    this.dashboardModel = null
    this.workspaceProjectIds.clear()
  }

  private async handleMessage(message: DashboardMessage): Promise<void> {
    try {
      if (message.type === 'refresh') {
        await this.panel?.webview.postMessage({ type: 'refreshState', refreshing: true })
        try {
          await this.onDidMutate()
          await this.refreshUsage()
        } finally {
          await this.panel?.webview.postMessage({ type: 'refreshState', refreshing: false })
        }
        return
      }
      if (
        message.type === 'copyProjectPath' ||
        message.type === 'openProject' ||
        message.type === 'revealProjectById'
      ) {
        const model = await this.dataSource.loadModel({
          includeArchived: true,
          includePreviewHints: false,
        })
        const project = model.projects.find((candidate) => candidate.id === message.projectId)
        if (!project) throw new Error('This project is no longer available locally.')
        if (message.type === 'copyProjectPath') {
          await vscode.env.clipboard.writeText(project.path)
          void vscode.window.showInformationMessage('Project path copied.')
        } else if (message.type === 'openProject') {
          await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(project.path), {
            forceNewWindow: false,
          })
        } else {
          await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(project.path))
        }
        return
      }
      if (message.type === 'deepSearch') {
        this.searchRequestId = message.requestId
        const matches = await this.dataSource.searchTranscriptContent(
          message.query,
          true,
          (scanned, total) => {
            if (this.searchRequestId === message.requestId)
              void this.panel?.webview.postMessage({
                requestId: message.requestId,
                scanned,
                total,
                type: 'searchProgress',
              })
          }
        )
        if (this.searchRequestId === message.requestId)
          await this.panel?.webview.postMessage({
            matches,
            requestId: message.requestId,
            type: 'searchResults',
          })
        return
      }
      if (message.type === 'metadataSearch') {
        const sessions = this.dashboardModel
          ? filterDashboardSessions(
              this.dashboardModel.sessions,
              message.query,
              message.filter,
              message.projectId,
              this.workspaceProjectIds
            )
          : []
        await this.panel?.webview.postMessage({
          requestId: message.requestId,
          sessionIds: sessions.map((session) => session.id),
          type: 'metadataResults',
        })
        return
      }

      const session = await this.dataSource.resolveSession(message.projectId, message.sessionId)
      if (!session) throw new Error('This session is no longer available locally.')

      switch (message.type) {
        case 'selectSession':
          await this.sendPreview(session, message.requestId)
          break
        case 'resume':
          await this.resumeService.resume(session, {
            remember: message.remember === true,
            target: message.target,
          })
          await this.panel?.webview.postMessage({
            resumeCapabilities: await this.resumeService.getCapabilities(),
            type: 'resumeCapabilities',
          })
          break
        case 'copyHandoff':
          await copySessionHandoff(session, this.logger)
          void vscode.window.showInformationMessage('Reup handoff packet copied.')
          break
        case 'editAlias':
          await this.inspector.editAlias(session)
          break
        case 'editTags':
          await this.inspector.editTags(session)
          break
        case 'archive':
          await this.inspector.toggleArchive(session)
          break
        case 'revealProject':
          await vscode.commands.executeCommand(
            'revealFileInOS',
            vscode.Uri.file(session.projectPath)
          )
          break
        case 'openFile':
          await openPreviewFile(
            session,
            await this.dataSource.loadPreview(session.projectId, session.id),
            message.path
          )
          break
        case 'touchedSessions': {
          const picked = await pickTouchedSession(this.dataSource, session.id, message.path)
          if (picked)
            await this.panel?.webview.postMessage({ type: 'focusSession', sessionId: picked.id })
          break
        }
      }
    } catch (error) {
      this.logger.error(`dashboard action failed: ${message.type}`, error)
      await this.panel?.webview.postMessage({
        message: error instanceof Error ? error.message : String(error),
        type: 'actionError',
      })
    }
  }

  private startUsagePolling(): void {
    if (this.usageTimer) return
    this.usageTimer = setInterval(() => void this.refreshUsage(), APP.usagePollMs)
  }

  private stopUsagePolling(): void {
    if (this.usageTimer) clearInterval(this.usageTimer)
    this.usageTimer = null
  }

  private async refreshUsage(): Promise<void> {
    if (!this.panel?.visible) return
    try {
      await this.panel.webview.postMessage({
        type: 'usage',
        usage: await readLiveUsageSummary(),
      })
    } catch (error) {
      this.logger.debug('dashboard usage refresh failed', error)
    }
  }

  private async sendPreview(session: ExtensionSession, requestId: number): Promise<void> {
    this.previewRequestId = requestId
    const key = `${session.projectId}:${session.id}`
    const cached = this.previewCache.get(key)
    const preview = cached ?? (await this.dataSource.loadPreview(session.projectId, session.id))
    if (!cached) this.previewCache.set(key, preview)
    if (this.previewRequestId !== requestId) return
    await this.panel?.webview.postMessage({
      preview,
      requestId,
      session,
      touchedOverlap: await this.computeTouchedOverlap(preview),
      type: 'preview',
    })
  }

  /** Maps each touched file to how many *other* sessions also edited it. */
  private async computeTouchedOverlap(preview: SessionPreview): Promise<Record<string, number>> {
    const includeArchived = getReupConfigurationValue<boolean>('includeArchived', false)
    const counts = await this.dataSource.touchedFileCounts(includeArchived)
    const overlap: Record<string, number> = {}
    for (const path of preview.touchedFiles) {
      const total = counts.get(pathIdentityKey(path)) ?? 1
      if (total > 1) overlap[path] = total - 1
    }
    return overlap
  }
}

async function openPreviewFile(
  session: ExtensionSession,
  preview: SessionPreview,
  requestedPath: string
): Promise<void> {
  const allowed = [...preview.touchedFiles, ...preview.automaticContext.readFiles].map((path) =>
    normalizePathForComparison(isAbsolute(path) ? path : resolve(session.projectPath, path))
  )
  const absolute = isAbsolute(requestedPath)
    ? requestedPath
    : resolve(session.projectPath, requestedPath)
  if (!allowed.includes(normalizePathForComparison(absolute)))
    throw new Error('The requested file is not part of the current session preview.')
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(absolute))
  await vscode.window.showTextDocument(document, { preview: true })
}

function isDashboardMessage(value: unknown): value is DashboardMessage {
  if (!value || typeof value !== 'object') return false
  const message = value as Record<string, unknown>
  if (message['type'] === 'refresh') return Object.keys(message).every((key) => key === 'type')
  if (
    message['type'] === 'deepSearch' &&
    typeof message['query'] === 'string' &&
    typeof message['requestId'] === 'number'
  )
    return true
  if (message['type'] === 'metadataSearch')
    return (
      typeof message['query'] === 'string' &&
      typeof message['requestId'] === 'number' &&
      (message['projectId'] === null || typeof message['projectId'] === 'string') &&
      ['active', 'all', 'archived', 'attention', 'workspace'].includes(String(message['filter']))
    )
  if (['copyProjectPath', 'openProject', 'revealProjectById'].includes(String(message['type'])))
    return typeof message['projectId'] === 'string'
  if (typeof message['projectId'] !== 'string' || typeof message['sessionId'] !== 'string')
    return false
  if (message['type'] === 'selectSession') return typeof message['requestId'] === 'number'
  if (message['type'] === 'openFile' || message['type'] === 'touchedSessions')
    return typeof message['path'] === 'string'
  if (
    message['type'] === 'resume' &&
    message['target'] !== undefined &&
    message['target'] !== 'terminal' &&
    message['target'] !== 'claude-extension'
  )
    return false
  if (
    message['type'] === 'resume' &&
    message['remember'] !== undefined &&
    typeof message['remember'] !== 'boolean'
  )
    return false
  return ['archive', 'copyHandoff', 'editAlias', 'editTags', 'resume', 'revealProject'].includes(
    String(message['type'])
  )
}

function renderDashboardHtml(): string {
  const nonce = randomBytes(18).toString('base64')
  const brandMarkup = renderBrandMarkup()
  const theme = resolveTheme(
    process.env[APP.themeEnvVar] ?? process.env[APP.legacyThemeEnvVar] ?? getStoredThemeName()
  )
  const themeCss = `:root{--reup-accent:${theme.accent};--reup-accent-hi:${theme.accentHi};--good:${theme.green};--warn:${theme.amber};--orange:${theme.orange};--bad:${theme.red};}`
  return `<!doctype html>
<html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style nonce="${nonce}">${DASHBOARD_CSS}${themeCss}</style></head>
<body><div id="app"><div class="loading">${brandMarkup}<p>Mapping your Claude work…</p></div></div>
<script nonce="${nonce}">const BRAND_MARKUP=${JSON.stringify(brandMarkup)};${DASHBOARD_SCRIPT}</script></body></html>`
}

function renderBrandMarkup(): string {
  return `<div class="brand"><span class="mark brand-mark">${renderReupMarkSvg({ className: 'brand-mark-svg', size: 48 })}</span><span class="brand-copy"><span class="brand-title">Reup</span><span class="brand-subtitle">claude code</span></span></div>`
}

const DASHBOARD_CSS = String.raw`
:root{color-scheme:light dark;--bg:var(--vscode-editor-background);--panel:var(--vscode-sideBar-background);--line:var(--vscode-widget-border);--muted:var(--vscode-descriptionForeground);--accent:var(--vscode-focusBorder,var(--vscode-button-background));--good:var(--vscode-testing-iconPassed);--warn:var(--vscode-editorWarning-foreground);--bad:var(--vscode-editorError-foreground);--project-count-col:3ch;--usage-limit-bar-width:52px}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--vscode-foreground);font-family:var(--vscode-font-family);height:100vh;overflow:hidden}button,input{font:inherit}.loading,.empty{height:100%;display:grid;place-content:center;text-align:center;color:var(--muted)}.mark{display:grid;place-items:center;width:48px;height:48px;margin:auto;border-radius:14px;background:linear-gradient(135deg,var(--accent),var(--vscode-button-background));color:var(--vscode-button-foreground);font-size:24px;font-weight:800}
.shell{height:100vh;display:grid;grid-template-rows:auto 1fr}.top{display:flex;align-items:center;gap:14px;padding:14px 18px;border-bottom:1px solid var(--line);background:color-mix(in srgb,var(--panel) 88%,transparent)}.brand{display:flex;align-items:center;gap:9px;font-weight:750;font-size:16px}.brand .mark{width:30px;height:30px;border-radius:9px;font-size:15px}.search{flex:1;max-width:700px;position:relative;height:36px}.search input{display:block;width:100%;height:36px;padding:0 104px 0 34px;border:1px solid var(--line);border-radius:9px;color:inherit;background:var(--vscode-input-background);outline:none}.search input:focus{border-color:var(--vscode-focusBorder)}.search:before{content:'⌕';position:absolute;z-index:1;left:12px;top:50%;color:var(--muted);transform:translateY(-50%);pointer-events:none}.deep{position:absolute;right:4px;top:4px;height:28px;padding:0 9px;line-height:26px}.btn{border:1px solid var(--line);border-radius:7px;padding:7px 11px;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);cursor:pointer}.btn:hover{filter:brightness(1.12)}.btn.primary{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border-color:transparent}.layout{min-height:0;display:grid;grid-template-columns:220px minmax(300px,430px) minmax(360px,1fr)}.rail,.sessions,.detail{min-height:0;overflow:auto}.rail{border-right:1px solid var(--line);background:var(--panel);padding:14px 10px}.sessions{border-right:1px solid var(--line);padding:14px}.detail{padding:22px 26px}.section-title{padding:6px 8px;color:var(--muted);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em}.rail-focus{margin-top:10px;padding-top:8px;border-top:1px solid var(--line)}.rail-focus .nav{color:var(--muted)}.nav,.project{align-items:center;gap:8px;width:100%;padding:8px;border:0;border-radius:7px;color:inherit;background:transparent;text-align:left;cursor:pointer}.nav{display:flex}.project{display:grid;grid-template-columns:minmax(0,1fr) var(--project-count-col)}.nav:hover,.project:hover,.nav.active,.project.active{background:var(--vscode-list-hoverBackground)}.nav .count{margin-left:auto}.nav .count,.project .count{color:var(--muted)}.project .name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.project .count{text-align:right;font-variant-numeric:tabular-nums}
.hero{border:1px solid color-mix(in srgb,var(--accent) 40%,var(--line));border-radius:12px;padding:14px;margin-bottom:14px;background:linear-gradient(135deg,color-mix(in srgb,var(--accent) 10%,transparent),transparent)}.eyebrow{color:var(--accent);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em}.hero h2{margin:5px 0;font-size:18px}.hero p{margin:0 0 10px;color:var(--muted)}.filter-row{display:flex;gap:6px;margin-bottom:10px}.chip{border:1px solid var(--line);border-radius:999px;padding:4px 9px;background:transparent;color:var(--muted);cursor:pointer}.chip.active{color:var(--accent);border-color:var(--accent);background:color-mix(in srgb,var(--accent) 10%,transparent)}
.session{display:grid;grid-template-columns:12px 1fr;gap:10px;padding:11px 9px;border-radius:9px;cursor:pointer;border:1px solid transparent}.session:hover,.session.active{background:var(--vscode-list-hoverBackground);border-color:var(--line)}.dot{width:8px;height:8px;margin-top:6px;border-radius:50%;background:var(--vscode-disabledForeground)}.dot.live{background:var(--good);box-shadow:0 0 0 3px color-mix(in srgb,var(--good) 18%,transparent)}.dot.warn{background:var(--warn)}.dot.bad{background:var(--bad)}.session h3{margin:0;font-size:13px}.meta{margin-top:4px;color:var(--muted);font-size:11px;display:flex;gap:7px;flex-wrap:wrap}.tags{color:var(--accent)}.detail h1{font-size:25px;margin:4px 0 7px}.detail h2{font-size:15px;margin:22px 0 7px}.detail p{line-height:1.55}.advice{padding:12px 14px;border-left:3px solid var(--accent);background:var(--vscode-textBlockQuote-background);border-radius:0 8px 8px 0}.actions{display:flex;gap:7px;flex-wrap:wrap;margin:14px 0}.facts{display:flex;gap:8px;flex-wrap:wrap;color:var(--muted);font-size:12px}.fact{padding:4px 7px;border:1px solid var(--line);border-radius:999px}.fact.active{color:var(--good)}.fact.warn{color:var(--warn);border-color:var(--warn)}.preview-loading{color:var(--muted);padding:30px 0}.md{line-height:1.55;overflow-wrap:anywhere}.md pre{overflow:auto;background:var(--vscode-textCodeBlock-background);padding:10px;border-radius:7px}.md code{font-family:var(--vscode-editor-font-family);background:var(--vscode-textCodeBlock-background);padding:1px 3px;border-radius:3px}.md table{border-collapse:collapse;width:100%}.md td,.md th{border:1px solid var(--line);padding:5px;text-align:left}.files button{display:block;border:0;background:transparent;color:var(--accent);padding:3px 0;cursor:pointer;text-align:left}.touched-file-row{display:flex;align-items:baseline;gap:8px}.touched-file-row button{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.touched-link{flex:none;color:var(--warn);cursor:pointer;font-size:.85em;opacity:.85}.touched-link:hover{opacity:1;text-decoration:underline}.toast{position:fixed;right:18px;bottom:18px;max-width:420px;padding:10px 13px;border:1px solid var(--bad);border-radius:8px;background:var(--panel);box-shadow:0 8px 30px #0005}
.brand{gap:10px;min-width:118px}.brand .mark{width:32px;height:32px;border-radius:10px;font-size:16px}.brand-mark{position:relative;background:transparent!important}.brand-mark-svg{display:block;width:100%;height:100%}.brand-copy{display:flex;flex-direction:column;line-height:1}.brand-title{font-weight:780;font-size:17px;letter-spacing:-.02em}.brand-subtitle{margin-top:4px;color:${BRAND_COLOR_MID};font-size:9px;font-style:italic;font-weight:550;letter-spacing:.13em;text-transform:lowercase;opacity:.9}.usage{display:flex;align-items:center;gap:7px;margin-left:auto;color:var(--muted);font-size:10px;white-space:nowrap}.usage-heading{font-weight:700;letter-spacing:.08em;text-transform:uppercase}.usage-limit{display:grid;grid-template-columns:auto var(--usage-limit-bar-width) auto;align-items:center;gap:5px}.usage-bar{height:3px;border-radius:4px;background:var(--vscode-progressBar-background);opacity:.24;overflow:hidden}.usage-fill{display:block;height:100%;background:var(--accent)}.usage-limit.warn .usage-fill{background:var(--warn)}.usage-limit.danger .usage-fill{background:var(--bad)}.usage-limit.stale{opacity:.58}.usage-credit{color:var(--good)}.usage-empty{font-style:italic;opacity:.72}.project-kicker{color:var(--accent);font-family:var(--vscode-editor-font-family);font-size:11px;font-weight:550;line-height:1.45;overflow-wrap:anywhere}.context-menu{position:fixed;z-index:20;min-width:210px;padding:5px;border:1px solid var(--line);border-radius:9px;background:var(--vscode-menu-background,var(--panel));color:var(--vscode-menu-foreground,var(--vscode-foreground));box-shadow:0 12px 35px #0007}.context-menu button{display:flex;width:100%;align-items:center;gap:9px;padding:7px 9px;border:0;border-radius:5px;background:transparent;color:inherit;text-align:left;cursor:pointer}.context-menu button:hover{background:var(--vscode-menu-selectionBackground,var(--vscode-list-hoverBackground));color:var(--vscode-menu-selectionForeground,var(--vscode-foreground))}.context-menu .sep{height:1px;margin:4px;background:var(--line)}.context-menu .danger{color:var(--bad)}
.search input{padding-right:108px}.deep{display:flex;align-items:center;justify-content:center;box-sizing:border-box;padding:0 10px;line-height:normal;white-space:nowrap;font-size:12px}.usage-bar{display:block;width:var(--usage-limit-bar-width);height:5px;border:0;border-radius:4px;overflow:hidden;background:color-mix(in srgb,var(--reup-accent) 16%,transparent);appearance:none;opacity:1}.usage-bar::-webkit-progress-bar{background:color-mix(in srgb,var(--reup-accent) 16%,transparent);border-radius:4px}.usage-bar::-webkit-progress-value{background:var(--reup-accent);border-radius:4px;box-shadow:0 0 5px color-mix(in srgb,var(--reup-accent) 45%,transparent)}.usage-limit.warn .usage-bar::-webkit-progress-value{background:var(--warn)}.usage-limit.danger .usage-bar::-webkit-progress-value{background:var(--bad)}
@media(max-width:900px){.layout{grid-template-columns:190px 1fr}.detail{display:none}.layout.show-detail .sessions{display:none}.layout.show-detail .detail{display:block}.top{flex-wrap:wrap}.search{order:3;flex-basis:100%;max-width:none}}@media(max-width:620px){.layout{grid-template-columns:1fr}.rail{display:none}.brand-copy{display:none}}
.loading .brand{margin:auto}.loading .brand .mark{width:48px;height:48px;border-radius:14px;font-size:24px}.resume-split{display:inline-flex}.resume-split .resume-main{border-radius:7px 0 0 7px}.resume-split .resume-menu{min-width:30px;padding:7px 8px;border-left:1px solid color-mix(in srgb,var(--vscode-button-foreground) 25%,transparent);border-radius:0 7px 7px 0}.resume-split button:disabled{opacity:.52;cursor:not-allowed}.remember-choice{display:flex;align-items:center;gap:8px;padding:7px 9px;color:var(--muted);font-size:11px;cursor:pointer}.remember-choice input{accent-color:var(--accent)}
`

const DASHBOARD_SCRIPT = String.raw`
const vscode=acquireVsCodeApi();const app=document.getElementById('app');let model=null,usage=null,resumeCapabilities={claudeExtensionAvailable:false,preferredTarget:null},workspaceIds=new Set(),selected=null,project=null,filter='all',query='',preview=null,previewRequest=0,searchRequest=0,metadataRequest=0,metadataSessionIds=null,deepMatches=null,touchedOverlap={};const saved=vscode.getState()||{},hadSavedSelection=Object.prototype.hasOwnProperty.call(saved,'selected');filter=saved.filter||'all';query=saved.query||'';project=saved.project||null;selected=saved.selected||null;
window.addEventListener('message',e=>{const m=e.data;if(m.type==='model'){const firstModel=model===null,uiState=captureUiState();model=m.model;resumeCapabilities=m.resumeCapabilities||resumeCapabilities;workspaceIds=new Set(m.workspaceProjectIds);if(selected&&!model.sessions.some(s=>s.id===selected))selected=null;if(firstModel&&!hadSavedSelection&&!selected&&model.continueNow)selected=model.continueNow.id;render();restoreUiState(uiState);requestMetadataSearch();if(selected)loadPreview(selected)}else if(m.type==='resumeCapabilities'){resumeCapabilities=m.resumeCapabilities||resumeCapabilities;renderPreservingUiState()}else if(m.type==='usage'){usage=m.usage;renderUsage()}else if(m.type==='refreshState'){setRefreshState(m.refreshing)}else if(m.type==='preview'&&m.requestId===previewRequest){const uiState=captureUiState();preview=m.preview;touchedOverlap=m.touchedOverlap||{};renderDetail();restoreUiState(uiState)}else if(m.type==='focusSession'){select(m.sessionId)}else if(m.type==='metadataResults'&&m.requestId===metadataRequest){const uiState=captureUiState();metadataSessionIds=new Set(m.sessionIds);renderSearchResults();restoreUiState(uiState)}else if(m.type==='searchResults'&&m.requestId===searchRequest){deepMatches=m.matches;renderPreservingUiState()}else if(m.type==='searchProgress'&&m.requestId===searchRequest){setSearchStatus(m.scanned+'/'+m.total)}else if(m.type==='error'&&!model){renderLoadError(m.message)}else if(m.type==='error'||m.type==='actionError')toast(m.message)});
function post(type,extra={}){vscode.postMessage({type,...extra})}function persist(){vscode.setState({filter,query,project,selected})}
function renderLoadError(message){app.innerHTML='<div class="loading">'+BRAND_MARKUP+'<h2>Could not load Reup</h2><p>'+esc(message)+'</p><button class="btn primary" id="retry">Try again</button></div>';document.getElementById('retry').onclick=()=>{app.innerHTML='<div class="loading">'+BRAND_MARKUP+'<p>Mapping your Claude work…</p></div>';post('refresh')}}
function render(){if(!model){return}const sessions=visibleSessions();app.innerHTML='<div class="shell"><header class="top">'+BRAND_MARKUP+'<div class="search"><input id="search" value="'+esc(query)+'" placeholder="Find sessions, projects, branches, tags…"><button class="btn deep" id="deep">Deep search</button></div><div class="usage" id="usage"></div><button class="btn" id="refresh">Refresh</button></header><main class="layout '+(selected?'show-detail':'')+'" id="layout">'+rail()+'<section class="sessions">'+hero()+filters()+'<div id="search-status"></div>'+sessionRows(sessions)+'</section><section class="detail" id="detail"></section></main></div>';bind();renderUsage();renderDetail()}
function renderPreservingUiState(resetDetailScroll=false){const state=captureUiState();if(resetDetailScroll)delete state.scroll.detail;render();restoreUiState(state)}
function captureUiState(){const scroll={};for(const name of ['rail','sessions','detail']){const element=document.querySelector('.'+name);if(element)scroll[name]=[element.scrollLeft,element.scrollTop]}if(!document.hasFocus())return {focus:null,scroll};const element=document.activeElement;if(!(element instanceof HTMLElement)||element===document.body)return {focus:null,scroll};const focus={selector:focusSelector(element),end:null,start:null};if(element instanceof HTMLInputElement){focus.start=element.selectionStart;focus.end=element.selectionEnd}return {focus:focus.selector?focus:null,scroll}}
function restoreUiState(state){if(!state)return;for(const [name,position] of Object.entries(state.scroll||{})){const element=document.querySelector('.'+name);if(element){element.scrollLeft=position[0];element.scrollTop=position[1]}}const focus=state.focus;if(!focus)return;const element=document.querySelector(focus.selector);if(!(element instanceof HTMLElement))return;element.focus({preventScroll:true});if(element instanceof HTMLInputElement&&focus.start!==null)element.setSelectionRange(focus.start,focus.end)}
function focusSelector(element){if(element.id)return '#'+CSS.escape(element.id);for(const key of ['resumePrimary','resumeMenu','session','project','filter','file']){const value=element.dataset[key];if(value)return '[data-'+key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())+'="'+CSS.escape(value)+'"]'}if(element.dataset.action&&element.dataset.id)return '[data-action="'+CSS.escape(element.dataset.action)+'"][data-id="'+CSS.escape(element.dataset.id)+'"]';return null}
function renderUsage(){const el=document.getElementById('usage');if(!el)return;if(!usage){el.innerHTML='<span class="usage-empty">usage loading</span>';return}const limits=usage.rateLimits||{},parts=[];if(limits.fiveHour)parts.push(usageLimit('5h',limits.fiveHour,usage.limitsStatus));if(limits.sevenDay)parts.push(usageLimit('7d',limits.sevenDay,usage.limitsStatus));if(!parts.length){el.innerHTML='<span class="usage-heading">limits</span><span class="usage-empty">'+(usage.configured?'unavailable':'off')+'</span>';return}el.innerHTML='<span class="usage-heading">limits</span>'+parts.join('')+(usage.usageCreditsEnabled===true?'<span class="usage-credit">credits on</span>':'')}
function usageLimit(label,limit,status){const p=Math.max(0,Math.min(100,Number(limit.usedPercentage)||0)),level=status==='stale'?'stale':p>=90?'danger':p>=80?'warn':'';return '<span class="usage-limit '+level+'" title="'+attr(formatReset(limit.resetsAt))+'"><strong>'+label+'</strong><progress class="usage-bar" max="100" value="'+p+'"></progress><span>'+Math.round(p)+'%</span></span>'}
function formatReset(v){if(!v)return '';const mins=Math.ceil((Date.parse(v)-Date.now())/60000);if(mins<=0)return 'reset now';if(mins>=1440)return 'reset '+Math.floor(mins/1440)+'d '+Math.floor((mins%1440)/60)+'h';if(mins>=60)return 'reset '+Math.floor(mins/60)+'h '+(mins%60)+'m';return 'reset '+mins+'m'}
function rail(){const projectRows=model.projects.map(p=>'<button class="project '+(project===p.id?'active':'')+'" data-project="'+attr(p.id)+'" title="'+attr(p.path)+'"><span class="name">'+esc(p.name)+'</span><span class="count">'+p.sessionCount+'</span></button>').join(''),workspaceCount=model.sessions.filter(s=>workspaceIds.has(s.projectId)&&!s.archived).length,allCount=model.summary.sessions-model.summary.archived,secondaryFocusRows=[focusNav('workspace','Current workspace',workspaceCount),focusNav('active','Active now',model.summary.active),focusNav('attention','Needs attention',model.summary.attention),focusNav('archived','Archived',model.summary.archived)].join(''),showAll=allCount>0&&(secondaryFocusRows||project||filter!=='all'),focusRows=(showAll?nav('all','All sessions',allCount):'')+secondaryFocusRows,focusBlock=focusRows?'<div class="rail-focus"><div class="section-title">Focus</div>'+focusRows+'</div>':'';return '<aside class="rail"><div class="section-title">Projects</div>'+projectRows+focusBlock+'</aside>'}
function nav(id,label,count){return '<button class="nav '+(filter===id&&!project?'active':'')+'" data-filter="'+id+'"><span>'+label+'</span><span class="count">'+count+'</span></button>'}
function focusNav(id,label,count){return count>0?nav(id,label,count):''}
function hero(){const s=model.continueNow;if(!s||query||project||filter!=='all')return '';return '<div class="hero"><div class="eyebrow">Continue now</div><h2>'+esc(s.title)+'</h2><p>'+esc(s.projectName)+' · '+relative(s.updated)+' · '+s.messageCount+' messages</p>'+resumeButtons(s,'Resume session')+'</div>'}
function filters(){return '<div class="filter-row"><button class="chip '+(filter==='all'?'active':'')+'" data-filter="all">All</button><button class="chip '+(filter==='active'?'active':'')+'" data-filter="active">Active</button><button class="chip '+(filter==='attention'?'active':'')+'" data-filter="attention">Attention</button><button class="chip '+(filter==='workspace'?'active':'')+'" data-filter="workspace">Workspace</button><button class="chip '+(filter==='archived'?'active':'')+'" data-filter="archived">Archived</button></div>'}
function visibleSessions(){if(deepMatches)return deepMatches.map(m=>({...m.session,_snippet:m.snippet,_matches:m.matchCount}));return metadataSessionIds?model.sessions.filter(s=>metadataSessionIds.has(s.id)):model.sessions}
function sessionRows(rows){if(!rows.length)return '<div class="empty"><div><h2>No sessions found</h2><p>Try clearing the project, filter, or search.</p></div></div>';return rows.map(s=>'<article class="session '+(selected===s.id?'active':'')+'" data-session="'+attr(s.id)+'"><span class="dot '+statusClass(s)+'"></span><div><h3>'+esc(s.title)+'</h3><div class="meta"><span>'+esc(s.projectName)+'</span><span>'+relative(s.updated)+'</span><span>'+s.messageCount+' msgs</span>'+(s.branch?'<span>'+esc(s.branch)+'</span>':'')+(s.tags.length?'<span class="tags">'+s.tags.map(t=>'#'+esc(t)).join(' ')+'</span>':'')+(s._matches?'<span>'+s._matches+' matches</span>':'')+'</div>'+(s._snippet?'<div class="meta">'+esc(s._snippet)+'</div>':'')+'</div></article>').join('')}
function renderDetail(){const el=document.getElementById('detail');if(!el)return;const s=model&&model.sessions.find(x=>x.id===selected);if(!s){el.innerHTML='<div class="empty"><div><h2>Select a session</h2><p>Its resume context will appear here.</p></div></div>';return}el.innerHTML='<div class="project-kicker" title="'+attr(s.projectPath)+'">'+esc(s.projectPath)+'</div><h1>'+esc(s.title)+'</h1><div class="facts"><span class="fact">'+relative(s.updated)+'</span><span class="fact">'+s.messageCount+' messages</span>'+(s.contextTokens?'<span class="fact">'+formatCtx(s.contextTokens)+'</span>':'')+(s.needsInput?'<span class="fact warn">● needs input</span>':'')+(s.isActive&&!s.needsInput?'<span class="fact active">● active</span>':'')+'</div><div class="advice"><strong>'+esc(s.advice.title)+'</strong><p>'+esc(s.advice.explanation)+'</p></div><div class="actions">'+resumeButtons(s,'Resume')+'<button class="btn" data-action="copyHandoff" data-id="'+attr(s.id)+'">Copy handoff</button><button class="btn" data-action="editAlias" data-id="'+attr(s.id)+'">Alias</button><button class="btn" data-action="editTags" data-id="'+attr(s.id)+'">Tags</button><button class="btn" data-action="archive" data-id="'+attr(s.id)+'">'+(s.archived?'Restore':'Archive')+'</button><button class="btn" data-action="revealProject" data-id="'+attr(s.id)+'">Reveal project</button></div><div id="preview">'+(preview?previewHtml(preview):'<div class="preview-loading">Reading resume context…</div>')+'</div>';bindActions()}
function resumeButtons(s,label){const active=s.advice.code==='already-active',disabled=s.advice.code==='path-missing'||(active&&!resumeCapabilities.claudeExtensionAvailable),target=resumeCapabilities.preferredTarget,targetLabel=active?'Jump to active Claude session':target==='claude-extension'?'Claude Code Extension':target==='terminal'?'VS Code Terminal':'Choose resume destination';return '<span class="resume-split"><button class="btn primary resume-main" data-resume-primary="'+attr(s.id)+'" title="'+targetLabel+'" '+(disabled?'disabled':'')+'>'+(active?'Open active session':label)+'</button>'+(active?'':'<button class="btn primary resume-menu" data-resume-menu="'+attr(s.id)+'" title="Choose resume destination" '+(disabled?'disabled':'')+'>▾</button>')+'</span>'}
function previewHtml(p){return section('What you asked for',p.goal,false)+section('Where Claude left off',p.lastResponse,true)+section('Plan',p.automaticContext.plan&&p.automaticContext.plan.text,true)+todos(p)+touchedFiles(p.touchedFiles)+files('Files read',p.automaticContext.readFiles)}
function section(title,value,md){return value?'<h2>'+title+'</h2><div class="md">'+(md?markdown(value):'<p>'+esc(value)+'</p>')+'</div>':''}function todos(p){const a=p.automaticContext.todos.items;if(!a.length)return '';return '<h2>TODOs</h2><ul>'+a.slice(0,24).map(x=>'<li>'+esc(x.content)+(x.status==='completed'?' ✓':'')+'</li>').join('')+'</ul>'}function files(title,a){if(!a.length)return '';return '<h2>'+title+'</h2><div class="files">'+a.map(x=>'<button data-file="'+attr(x)+'">'+esc(x)+'</button>').join('')+'</div>'}
function touchedFiles(a){if(!a.length)return '';return '<h2>Files touched</h2><div class="files">'+a.map(x=>{const n=touchedOverlap[x]||0;const link=n>0?' <span class="touched-link" data-touched="'+attr(x)+'">↳ '+n+' other session'+(n===1?'':'s')+'</span>':'';return '<div class="touched-file-row"><button data-file="'+attr(x)+'">'+esc(x)+'</button>'+link+'</div>'}).join('')+'</div>'}
function bind(){document.getElementById('search').addEventListener('input',e=>{query=e.target.value;deepMatches=null;persist();requestMetadataSearch()});document.getElementById('deep').onclick=()=>{if(query.trim().length<2)return toast('Enter at least two characters.');searchRequest++;deepMatches=[];post('deepSearch',{query:query.trim(),requestId:searchRequest});setSearchStatus('Searching transcripts…')};document.getElementById('refresh').onclick=()=>{setRefreshState(true);post('refresh')};document.querySelectorAll('[data-filter]').forEach(x=>x.onclick=()=>{filter=x.dataset.filter;project=null;deepMatches=null;persist();renderPreservingUiState();requestMetadataSearch()});document.querySelectorAll('[data-project]').forEach(x=>{x.onclick=()=>{project=project===x.dataset.project?null:x.dataset.project;deepMatches=null;persist();renderPreservingUiState();requestMetadataSearch()};x.oncontextmenu=e=>{e.preventDefault();showProjectMenu(e.clientX,e.clientY,x.dataset.project)}});bindSessionRows();bindActions()}
function bindActions(){document.querySelectorAll('[data-action]').forEach(x=>x.onclick=e=>{e.stopPropagation();const s=model.sessions.find(v=>v.id===x.dataset.id);if(s)post(x.dataset.action,{projectId:s.projectId,sessionId:s.id,...(x.dataset.target?{target:x.dataset.target}:{})})});document.querySelectorAll('[data-resume-primary]').forEach(x=>x.onclick=e=>{e.stopPropagation();const s=model.sessions.find(v=>v.id===x.dataset.resumePrimary);if(!s)return;if(resumeCapabilities.preferredTarget)post('resume',{projectId:s.projectId,sessionId:s.id,target:resumeCapabilities.preferredTarget});else showResumeMenu(e.clientX,e.clientY,s.id)});document.querySelectorAll('[data-resume-menu]').forEach(x=>x.onclick=e=>{e.stopPropagation();showResumeMenu(e.clientX,e.clientY,x.dataset.resumeMenu)});document.querySelectorAll('[data-file]').forEach(x=>x.onclick=()=>{const s=model.sessions.find(v=>v.id===selected);if(s)post('openFile',{projectId:s.projectId,sessionId:s.id,path:x.dataset.file})});document.querySelectorAll('[data-touched]').forEach(x=>x.onclick=e=>{e.stopPropagation();const s=model.sessions.find(v=>v.id===selected);if(s)post('touchedSessions',{projectId:s.projectId,sessionId:s.id,path:x.dataset.touched})})}
function bindSessionRows(){document.querySelectorAll('[data-session]').forEach(x=>{x.onclick=()=>select(x.dataset.session);x.oncontextmenu=e=>{e.preventDefault();select(x.dataset.session);showSessionMenu(e.clientX,e.clientY,x.dataset.session)}})}
function requestMetadataSearch(){if(!model)return;metadataRequest++;post('metadataSearch',{filter,projectId:project,query,requestId:metadataRequest})}
function renderSearchResults(){const container=document.querySelector('.sessions');if(!container)return;container.innerHTML=hero()+filters()+'<div id="search-status"></div>'+sessionRows(visibleSessions());container.querySelectorAll('[data-filter]').forEach(x=>x.onclick=()=>{filter=x.dataset.filter;project=null;deepMatches=null;persist();renderPreservingUiState();requestMetadataSearch()});bindSessionRows();bindActions()}
function select(id){selected=id;preview=null;persist();renderPreservingUiState(true);loadPreview(id)}function loadPreview(id){const s=model.sessions.find(x=>x.id===id);if(!s)return;previewRequest++;post('selectSession',{projectId:s.projectId,sessionId:s.id,requestId:previewRequest})}
function showProjectMenu(x,y,id){const p=model.projects.find(v=>v.id===id);if(!p)return;showMenu(x,y,[['◫','Show sessions',()=>{project=id;filter='all';deepMatches=null;persist();renderPreservingUiState();requestMetadataSearch()}],['↗','Open folder in VS Code',()=>post('openProject',{projectId:id})],['⌖','Reveal in OS',()=>post('revealProjectById',{projectId:id})],['⧉','Copy project path',()=>post('copyProjectPath',{projectId:id})]])}
function showSessionMenu(x,y,id){const s=model.sessions.find(v=>v.id===id);if(!s)return;const active=s.advice.code==='already-active';showMenu(x,y,[['▶',active?'Open active session':'Resume',()=>active?post('resume',{projectId:s.projectId,sessionId:s.id,target:'claude-extension'}):resumeCapabilities.preferredTarget?post('resume',{projectId:s.projectId,sessionId:s.id,target:resumeCapabilities.preferredTarget}):showResumeMenu(x,y,s.id),s.advice.code==='path-missing'||(active&&!resumeCapabilities.claudeExtensionAvailable)],['⧉','Copy handoff',()=>post('copyHandoff',{projectId:s.projectId,sessionId:s.id})],['✎','Edit alias',()=>post('editAlias',{projectId:s.projectId,sessionId:s.id})],['#','Edit tags',()=>post('editTags',{projectId:s.projectId,sessionId:s.id})],['⌖','Reveal project',()=>post('revealProject',{projectId:s.projectId,sessionId:s.id})],['—','',null],['◌',s.archived?'Restore session':'Archive session',()=>post('archive',{projectId:s.projectId,sessionId:s.id}),false,true]])}
function showResumeMenu(x,y,id){const s=model.sessions.find(v=>v.id===id);if(!s)return;closeMenu();const menu=document.createElement('div');menu.className='context-menu resume-target-menu';menu.innerHTML='<label class="remember-choice"><input type="checkbox" checked> Remember my choice</label><div class="sep"></div>';const remember=menu.querySelector('input');const add=(icon,label,target)=>{const button=document.createElement('button');button.innerHTML='<span>'+icon+'</span><span>'+label+'</span>';button.onclick=()=>{closeMenu();post('resume',{projectId:s.projectId,sessionId:s.id,target,remember:remember.checked})};menu.appendChild(button)};if(resumeCapabilities.claudeExtensionAvailable)add('✻','Claude Code Extension','claude-extension');add('>_','VS Code Terminal','terminal');placeMenu(menu,x,y)}
function showMenu(x,y,items){closeMenu();const menu=document.createElement('div');menu.className='context-menu';for(const item of items){if(!item[2]){const sep=document.createElement('div');sep.className='sep';menu.appendChild(sep);continue}const button=document.createElement('button');button.innerHTML='<span>'+item[0]+'</span><span>'+esc(item[1])+'</span>';button.disabled=!!item[3];if(item[4])button.classList.add('danger');button.onclick=()=>{closeMenu();item[2]()};menu.appendChild(button)}placeMenu(menu,x,y)}
function placeMenu(menu,x,y){document.body.appendChild(menu);const r=menu.getBoundingClientRect();menu.style.left=Math.max(6,Math.min(x,innerWidth-r.width-6))+'px';menu.style.top=Math.max(6,Math.min(y,innerHeight-r.height-6))+'px';setTimeout(()=>document.addEventListener('pointerdown',event=>{if(!menu.contains(event.target))closeMenu()},{once:true}),0)}
function closeMenu(){document.querySelector('.context-menu')?.remove()}
document.addEventListener('keydown',e=>{if(e.key==='/'&&document.activeElement?.tagName!=='INPUT'){e.preventDefault();document.getElementById('search')?.focus()}if(e.key==='Escape'){if(query){query='';deepMatches=null;persist();renderPreservingUiState();requestMetadataSearch()}else if(selected){selected=null;preview=null;persist();renderPreservingUiState()}}if((e.ctrlKey||e.metaKey)&&e.key==='Enter'&&selected){e.preventDefault();const button=document.querySelector('[data-resume-primary="'+CSS.escape(selected)+'"]');if(button instanceof HTMLElement)button.click()}if((e.key==='ArrowDown'||e.key==='ArrowUp')&&document.activeElement?.tagName!=='INPUT'){const rows=visibleSessions();if(!rows.length)return;const i=Math.max(0,rows.findIndex(x=>x.id===selected));select(rows[(i+(e.key==='ArrowDown'?1:-1)+rows.length)%rows.length].id)}})
function statusClass(s){return s.needsInput?'warn':s.isActive?'live':(s.primaryStatus==='expiring'||s.primaryStatus==='path-missing'?'bad':s.needsAttention?'warn':'')}function relative(v){if(!v)return 'unknown';const d=Date.now()-Date.parse(v),m=Math.floor(d/60000);return m<1?'now':m<60?m+'m ago':m<1440?Math.floor(m/60)+'h ago':Math.floor(m/1440)+'d ago'}function formatCtx(n){return n>=1000?Math.round(n/100)/10+'k ctx':n+' ctx'}function setSearchStatus(t){const x=document.getElementById('search-status');if(x)x.textContent=t||''}function setRefreshState(active){const button=document.getElementById('refresh');if(!button)return;button.disabled=!!active;button.textContent=active?'Refreshing…':'Refresh';button.title=active?'Reloading projects, sessions, active state, and usage':'Reload projects, sessions, active state, and usage'}function toast(t){const x=document.createElement('div');x.className='toast';x.textContent=t;document.body.appendChild(x);setTimeout(()=>x.remove(),3500)}
function markdown(v){const lines=String(v).replace(/\r\n?/g,'\n').split('\n');let out='',list=null;const close=()=>{if(list){out+='</'+list+'>';list=null}};for(const raw of lines){const l=raw.trimEnd();if(!l){close();continue}const h=l.match(/^(#{1,4})\s+(.+)/);if(h){close();out+='<h'+h[1].length+'>'+inline(h[2])+'</h'+h[1].length+'>';continue}const b=l.match(/^\s*[-*+]\s+(.+)/),o=l.match(/^\s*\d+[.)]\s+(.+)/);if(b||o){const t=o?'ol':'ul';if(list!==t){close();list=t;out+='<'+t+'>'}out+='<li>'+inline((o||b)[1])+'</li>';continue}close();out+='<p>'+inline(l)+'</p>'}close();return out}function inline(v){return esc(v).replace(/\x60([^\x60]+)\x60/g,'<code>$1</code>').replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>')}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}function attr(v){return esc(v)}
`
