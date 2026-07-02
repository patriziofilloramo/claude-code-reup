import { join } from 'node:path'

import * as vscode from 'vscode'

import {
  getClaudeDirectory,
  getClaudeProjectsDirectory,
  getReupDirectory,
} from '../../src/core/project/claude-paths.js'
import { invalidateProjectCache } from '../../src/core/project/project-cache.js'
import { affectsReupConfiguration, getReupConfigurationValue } from './configuration.js'
import { resolveGitDirectory } from './git-workspace.js'
import type { ReupLogger } from './logger.js'

const SAFETY_REFRESH_MS = 20_000
const WATCH_DEBOUNCE_MS = 500
const WATCH_REFRESH_THROTTLE_MS = 5_000

type RefreshMode = 'interval' | 'manual' | 'watch'

export interface RefreshTarget {
  refresh(): Promise<void>
}

/**
 * Owns refresh lifecycle for the cockpit. No watcher or interval remains active
 * while the Reup view is hidden.
 */
export class ReupRefreshController implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = []
  private debounceTimer: NodeJS.Timeout | null = null
  private disposed = false
  private intervalTimer: NodeJS.Timeout | null = null
  private lastRefreshStartedAt = 0
  private pendingRefreshReason: string | null = null
  private refreshInFlight: Promise<void> | null = null
  private visible = false
  private readonly watcherDisposables: vscode.Disposable[] = []
  private readonly watchers: vscode.FileSystemWatcher[] = []

  constructor(
    private readonly logger: ReupLogger,
    private readonly target: RefreshTarget
  ) {
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (
          affectsReupConfiguration(event, 'refreshMode') ||
          affectsReupConfiguration(event, 'includeArchived')
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
    } else if (mode === 'interval') {
      this.startSafetyInterval()
    }
  }

  requestRefresh(reason: string): void {
    if (this.disposed || !this.visible) return
    this.clearDebounce()
    const throttleDelay =
      readRefreshMode() === 'watch'
        ? Math.max(0, this.lastRefreshStartedAt + WATCH_REFRESH_THROTTLE_MS - Date.now())
        : 0
    this.debounceTimer = setTimeout(
      () => {
        this.debounceTimer = null
        void this.refresh(reason)
      },
      Math.max(WATCH_DEBOUNCE_MS, throttleDelay)
    )
  }

  private async refresh(reason: string): Promise<void> {
    if (this.disposed || !this.visible) return
    if (this.refreshInFlight) {
      this.pendingRefreshReason = reason
      return
    }

    this.logger.debug('VS Code cockpit refresh requested', reason)
    this.lastRefreshStartedAt = Date.now()
    invalidateProjectCache()
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
    // Hook-captured markers drive the needs-input signal; without these the
    // tree only notices attention on the next transcript or lock change.
    this.addWatcher(join(getReupDirectory(), 'attention'), '**/*', 'Reup attention marker')
    this.addWatcher(join(getReupDirectory(), 'activity'), '**/*', 'Reup work marker')
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
  const configured = getReupConfigurationValue<string>('refreshMode', 'watch')
  return configured === 'manual' || configured === 'interval' ? configured : 'watch'
}
