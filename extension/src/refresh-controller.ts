import { join } from 'node:path'

import * as vscode from 'vscode'

import {
  getClaudeDirectory,
  getClaudeProjectsDirectory,
} from '../../src/core/project/claude-paths.js'
import type { SwoopLogger } from './logger.js'
import { resolveGitDirectory } from './git-workspace.js'

const SAFETY_REFRESH_MS = 20_000
const WATCH_DEBOUNCE_MS = 500

type RefreshMode = 'interval' | 'manual' | 'watch'

export interface RefreshTarget {
  refresh(): Promise<void>
}

/**
 * Owns refresh lifecycle for the cockpit. No watcher or interval remains active
 * while the Swoop view is hidden.
 */
export class SwoopRefreshController implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = []
  private debounceTimer: NodeJS.Timeout | null = null
  private disposed = false
  private intervalTimer: NodeJS.Timeout | null = null
  private pendingRefreshReason: string | null = null
  private refreshInFlight: Promise<void> | null = null
  private visible = false
  private readonly watcherDisposables: vscode.Disposable[] = []
  private readonly watchers: vscode.FileSystemWatcher[] = []

  constructor(
    private readonly logger: SwoopLogger,
    private readonly target: RefreshTarget
  ) {
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (
          event.affectsConfiguration('swoop.refreshMode') ||
          event.affectsConfiguration('swoop.includeArchived')
        ) {
          this.reconfigure()
          this.requestRefresh('configuration')
        }
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.reconfigure()
        this.requestRefresh('workspace folders')
      }),
      vscode.window.onDidChangeActiveTextEditor(() => {
        this.requestRefresh('active editor')
      })
    )
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible) return
    this.visible = visible
    if (!visible) {
      this.clearRuntime()
      return
    }
    this.reconfigure()
    void this.refresh('view opened')
  }

  dispose(): void {
    this.disposed = true
    this.clearRuntime()
    for (const disposable of this.disposables.splice(0)) disposable.dispose()
  }

  reconfigure(): void {
    this.clearRuntime()
    if (!this.visible || this.disposed) return

    const mode = readRefreshMode()
    this.logger.info('VS Code refresh mode configured', mode)
    if (mode === 'watch') {
      this.startFilesystemWatchers()
      this.startGitWatchers()
      this.startSafetyInterval()
    } else if (mode === 'interval') {
      this.startSafetyInterval()
    }
  }

  requestRefresh(reason: string): void {
    if (this.disposed || !this.visible) return
    this.clearDebounce()
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      void this.refresh(reason)
    }, WATCH_DEBOUNCE_MS)
  }

  private async refresh(reason: string): Promise<void> {
    if (this.disposed || !this.visible) return
    if (this.refreshInFlight) {
      this.pendingRefreshReason = reason
      return
    }

    this.logger.debug('VS Code cockpit refresh requested', reason)
    this.refreshInFlight = this.target.refresh()
    try {
      await this.refreshInFlight
    } finally {
      this.refreshInFlight = null
      const pendingReason = this.pendingRefreshReason
      this.pendingRefreshReason = null
      if (pendingReason && !this.disposed && this.visible) {
        this.requestRefresh(`queued after ${pendingReason}`)
      }
    }
  }

  private clearRuntime(): void {
    this.clearDebounce()
    if (this.intervalTimer) clearInterval(this.intervalTimer)
    this.intervalTimer = null
    for (const disposable of this.watcherDisposables.splice(0)) disposable.dispose()
    for (const watcher of this.watchers.splice(0)) watcher.dispose()
  }

  private clearDebounce(): void {
    if (!this.debounceTimer) return
    clearTimeout(this.debounceTimer)
    this.debounceTimer = null
  }

  private startSafetyInterval(): void {
    this.intervalTimer = setInterval(() => {
      void this.refresh('safety interval')
    }, SAFETY_REFRESH_MS)
  }

  private startFilesystemWatchers(): void {
    this.addWatcher(getClaudeProjectsDirectory(), '**/*', 'Claude project')
    this.addWatcher(join(getClaudeDirectory(), 'sessions'), '**/*', 'Claude session lock')
  }

  private startGitWatchers(): void {
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      void resolveGitDirectory(folder.uri.fsPath).then((gitDirectory) => {
        if (!gitDirectory || !this.visible || this.disposed || readRefreshMode() !== 'watch') return
        this.addWatcher(gitDirectory, 'HEAD', 'Git HEAD')
        this.addWatcher(gitDirectory, 'refs/heads/**', 'Git branch')
      })
    }
  }

  private addWatcher(root: string, pattern: string, label: string): void {
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(root, pattern)
    )
    this.watchers.push(watcher)
    watcher.onDidChange(
      () => this.requestRefresh(`${label} change`),
      undefined,
      this.watcherDisposables
    )
    watcher.onDidCreate(
      () => this.requestRefresh(`${label} create`),
      undefined,
      this.watcherDisposables
    )
    watcher.onDidDelete(
      () => this.requestRefresh(`${label} delete`),
      undefined,
      this.watcherDisposables
    )
  }
}

function readRefreshMode(): RefreshMode {
  const configured = vscode.workspace.getConfiguration('swoop').get<string>('refreshMode', 'watch')
  return configured === 'manual' || configured === 'interval' ? configured : 'watch'
}
