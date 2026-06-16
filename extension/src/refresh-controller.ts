import * as vscode from 'vscode'

import { getClaudeProjectsDirectory } from '../../src/core/project/claude-paths.js'
import type { SwoopLogger } from './logger.js'

const INTERVAL_REFRESH_MS = 20_000
const WATCH_DEBOUNCE_MS = 750

type RefreshMode = 'interval' | 'manual' | 'watch'

export interface RefreshTarget {
  refresh(): Promise<void>
}

/**
 * Owns automatic refresh wiring for the VS Code tree.
 *
 * Manual refresh remains the default. Watch/interval modes are opt-in and
 * disposable so an Extension Host restart cannot leave timers or filesystem
 * watchers behind.
 */
export class SwoopRefreshController implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = []
  private debounceTimer: NodeJS.Timeout | null = null
  private disposed = false
  private intervalTimer: NodeJS.Timeout | null = null
  private pendingRefreshReason: string | null = null
  private refreshInFlight: Promise<void> | null = null
  private watcher: vscode.FileSystemWatcher | null = null
  private readonly watcherDisposables: vscode.Disposable[] = []

  constructor(
    private readonly logger: SwoopLogger,
    private readonly target: RefreshTarget
  ) {
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('swoop.refreshMode')) this.reconfigure()
      })
    )
    this.reconfigure()
  }

  dispose(): void {
    this.disposed = true
    this.clearDebounce()
    this.clearInterval()
    this.clearWatcher()
    for (const disposable of this.disposables.splice(0)) disposable.dispose()
  }

  reconfigure(): void {
    this.clearDebounce()
    this.clearInterval()
    this.clearWatcher()

    const mode = readRefreshMode()
    this.logger.info('VS Code refresh mode configured', mode)

    if (mode === 'watch') {
      this.startWatcher()
    } else if (mode === 'interval') {
      this.startInterval()
    }
  }

  private clearDebounce(): void {
    if (!this.debounceTimer) return
    clearTimeout(this.debounceTimer)
    this.debounceTimer = null
  }

  private clearInterval(): void {
    if (!this.intervalTimer) return
    clearInterval(this.intervalTimer)
    this.intervalTimer = null
  }

  private clearWatcher(): void {
    for (const disposable of this.watcherDisposables.splice(0)) disposable.dispose()
    this.watcher?.dispose()
    this.watcher = null
  }

  private requestRefresh(reason: string): void {
    if (this.disposed) return
    this.clearDebounce()
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      void this.refresh(reason)
    }, WATCH_DEBOUNCE_MS)
  }

  private async refresh(reason: string): Promise<void> {
    if (this.disposed) return
    if (this.refreshInFlight) {
      this.pendingRefreshReason = reason
      return
    }

    this.logger.debug('automatic VS Code refresh requested', reason)
    this.refreshInFlight = this.target.refresh()
    try {
      await this.refreshInFlight
    } finally {
      this.refreshInFlight = null
      const pendingReason = this.pendingRefreshReason
      this.pendingRefreshReason = null
      if (pendingReason && !this.disposed) this.requestRefresh(`queued after ${pendingReason}`)
    }
  }

  private startInterval(): void {
    this.intervalTimer = setInterval(() => {
      void this.refresh('interval')
    }, INTERVAL_REFRESH_MS)
  }

  private startWatcher(): void {
    const projectsDirectory = getClaudeProjectsDirectory()
    const pattern = new vscode.RelativePattern(projectsDirectory, '**/*')
    this.watcher = vscode.workspace.createFileSystemWatcher(pattern)
    this.watcher.onDidChange(
      () => this.requestRefresh('watch change'),
      undefined,
      this.watcherDisposables
    )
    this.watcher.onDidCreate(
      () => this.requestRefresh('watch create'),
      undefined,
      this.watcherDisposables
    )
    this.watcher.onDidDelete(
      () => this.requestRefresh('watch delete'),
      undefined,
      this.watcherDisposables
    )
    this.logger.info('watching Claude projects directory', projectsDirectory)
  }
}

function readRefreshMode(): RefreshMode {
  const configured = vscode.workspace.getConfiguration('swoop').get<string>('refreshMode', 'manual')
  return configured === 'watch' || configured === 'interval' ? configured : 'manual'
}
