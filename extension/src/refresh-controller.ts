import { join } from 'node:path'

import * as vscode from 'vscode'

import {
  getClaudeDirectory,
  getClaudeProjectsDirectory,
  getReupDirectory,
} from '../../src/core/project/claude-paths.js'
import { affectsReupConfiguration, getReupConfigurationValue } from './configuration.js'
import { resolveGitDirectory } from './git-workspace.js'
import type { ReupLogger } from './logger.js'

const SAFETY_REFRESH_MS = 20_000
const WATCH_DEBOUNCE_MS = 500
const WATCH_REFRESH_THROTTLE_MS = 5_000

type RefreshMode = 'interval' | 'manual' | 'watch'

/**
 * How much filesystem watching the visible surfaces justify:
 * - `full`: dashboard open — watch everything, including transcript churn.
 * - `signals`: only the sidebar tree — watch just locks and hook markers, the
 *   rare events that flip live/needs-input state, so the shared sidebar never
 *   flickers busy while Claude streams transcript writes.
 * - `off`: nothing visible.
 */
export type RefreshScope = 'full' | 'off' | 'signals'

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
  private pendingUrgent = false
  private refreshInFlight: Promise<void> | null = null
  private scope: RefreshScope = 'off'
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

  setScope(scope: RefreshScope): void {
    if (this.scope === scope) return
    const previousScope = this.scope
    this.scope = scope
    if (scope === 'off') {
      this.clearRuntime()
      return
    }
    this.reconfigure()
    if (previousScope === 'off' || (previousScope === 'signals' && scope === 'full')) {
      void this.refresh('view opened')
    }
  }

  dispose(): void {
    this.disposed = true
    this.clearRuntime()
    for (const disposable of this.disposables.splice(0)) disposable.dispose()
  }

  reconfigure(): void {
    this.clearRuntime()
    if (this.scope === 'off' || this.disposed) return

    const mode = readRefreshMode()
    this.logger.info('VS Code refresh mode configured', mode, this.scope)
    if (mode === 'watch') {
      this.startSignalWatchers()
      if (this.scope === 'full') {
        this.startProjectWatchers()
        this.startGitWatchers()
      }
    } else if (mode === 'interval') {
      this.startSafetyInterval()
    }
  }

  requestRefresh(reason: string, urgent = false): void {
    if (this.disposed || this.scope === 'off') return
    // An urgent request (attention markers, lock transitions) skips the
    // throttle so a "needs input" flip shows within the debounce window; a
    // later non-urgent event must not demote an already-urgent pending one.
    this.pendingUrgent = urgent || (this.debounceTimer !== null && this.pendingUrgent)
    this.clearDebounce()
    const throttleDelay =
      !this.pendingUrgent && readRefreshMode() === 'watch'
        ? Math.max(0, this.lastRefreshStartedAt + WATCH_REFRESH_THROTTLE_MS - Date.now())
        : 0
    this.debounceTimer = setTimeout(
      () => {
        this.debounceTimer = null
        this.pendingUrgent = false
        void this.refresh(reason)
      },
      Math.max(WATCH_DEBOUNCE_MS, throttleDelay)
    )
  }

  /** Read through a getter: the scope can change while a refresh awaits. */
  private get watchingAnything(): boolean {
    return this.scope !== 'off'
  }

  private async refresh(reason: string): Promise<void> {
    if (this.disposed || this.scope === 'off') return
    if (this.refreshInFlight) {
      this.pendingRefreshReason = reason
      return
    }

    this.logger.debug('VS Code cockpit refresh requested', reason)
    this.lastRefreshStartedAt = Date.now()
    this.refreshInFlight = this.target.refresh()
    try {
      await this.refreshInFlight
    } finally {
      this.refreshInFlight = null
      const pendingReason = this.pendingRefreshReason
      this.pendingRefreshReason = null
      if (pendingReason && !this.disposed && this.watchingAnything) {
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

  private startProjectWatchers(): void {
    this.addWatcher(getClaudeProjectsDirectory(), '**/*', 'Claude project')
  }

  /**
   * Lock transitions and hook-captured markers drive the live/needs-input
   * signals; they are rare and time-sensitive, so they bypass the throttle
   * and stay active even when only the sidebar tree is visible.
   */
  private startSignalWatchers(): void {
    this.addWatcher(join(getClaudeDirectory(), 'sessions'), '**/*', 'Claude session lock', true)
    this.addWatcher(join(getReupDirectory(), 'attention'), '**/*', 'Reup attention marker', true)
    this.addWatcher(join(getReupDirectory(), 'activity'), '**/*', 'Reup work marker', true)
  }

  private startGitWatchers(): void {
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      void resolveGitDirectory(folder.uri.fsPath).then((gitDirectory) => {
        if (
          !gitDirectory ||
          this.scope !== 'full' ||
          this.disposed ||
          readRefreshMode() !== 'watch'
        )
          return
        this.addWatcher(gitDirectory, 'HEAD', 'Git HEAD')
        this.addWatcher(gitDirectory, 'refs/heads/**', 'Git branch')
      })
    }
  }

  private addWatcher(root: string, pattern: string, label: string, urgent = false): void {
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(root, pattern)
    )
    this.watchers.push(watcher)
    watcher.onDidChange(
      () => this.requestRefresh(`${label} change`, urgent),
      undefined,
      this.watcherDisposables
    )
    watcher.onDidCreate(
      () => this.requestRefresh(`${label} create`, urgent),
      undefined,
      this.watcherDisposables
    )
    watcher.onDidDelete(
      () => this.requestRefresh(`${label} delete`, urgent),
      undefined,
      this.watcherDisposables
    )
  }
}

function readRefreshMode(): RefreshMode {
  const configured = getReupConfigurationValue<string>('refreshMode', 'watch')
  return configured === 'manual' || configured === 'interval' ? configured : 'watch'
}
