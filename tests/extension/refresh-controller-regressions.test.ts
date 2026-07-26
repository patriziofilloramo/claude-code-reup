import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const source = readFileSync('extension/src/refresh-controller.ts', 'utf8')
const extensionSource = readFileSync('extension/src/extension.ts', 'utf8')
const manifest = JSON.parse(readFileSync('extension/package.json', 'utf8')) as {
  contributes: { configuration: { properties: Record<string, unknown> } }
}

describe('VS Code refresh controller guardrails', () => {
  it('keeps automatic refresh wiring isolated and disposable', () => {
    expect(source).toContain('implements vscode.Disposable')
    expect(source).toContain('clearInterval')
    expect(source).toContain('clearTimeout')
    expect(source).toContain('watcherDisposables')
    expect(source).toContain('this.watchers.splice(0)')
    expect(source).toContain('pendingRefreshReason')
    expect(source).toContain('setScope(scope: RefreshScope)')
    expect(source).toContain("if (this.disposed || this.scope === 'off') return")
    expect(extensionSource).toContain('new ReupRefreshController')
    expect(extensionSource).toContain('refreshController,')
  })

  it('supports manual, watcher, and interval modes from configuration', () => {
    expect(manifest.contributes.configuration.properties['reup.refreshMode']).toMatchObject({
      default: 'watch',
      enum: ['manual', 'watch', 'interval'],
    })
    expect(source).toContain("configured === 'manual' || configured === 'interval'")
    expect(source).toContain('vscode.workspace.createFileSystemWatcher')
    expect(source).toContain('setInterval')
    expect(source).toContain('WATCH_REFRESH_THROTTLE_MS')
    expect(source).toContain('Math.max(WATCH_DEBOUNCE_MS, throttleDelay)')
    expect(extensionSource).toContain('invalidateProjectCache()')
    expect(source).toContain("previousScope === 'signals' && scope === 'full'")
    expect(source).not.toContain(
      "if (mode === 'watch') {\n      this.startFilesystemWatchers()\n      this.startGitWatchers()\n      this.startSafetyInterval()"
    )
    expect(source).toContain("join(getClaudeDirectory(), 'sessions')")
    expect(source).toContain('resolveGitDirectory')
  })

  it('refreshes needs-input signals urgently, bypassing the watch throttle', () => {
    // Attention/work markers and lock transitions flip the needs-input state;
    // they are rare and time-sensitive, so they must skip the 5s throttle.
    expect(source).toContain("join(getReupDirectory(), 'attention')")
    expect(source).toContain("join(getReupDirectory(), 'activity')")
    expect(source).toContain("'Claude session lock', true")
    expect(source).toContain("'Reup attention marker', true")
    expect(source).toContain("'Reup work marker', true")
    expect(source).toContain('!this.pendingUrgent && readRefreshMode()')
  })

  it('keeps signal watchers alive for the sidebar tree without dashboard churn', () => {
    // With only the tree visible, lock/marker watchers must still run so
    // needs-input flips reach the sidebar; transcript watching stays
    // dashboard-only to avoid a perpetually busy shared sidebar.
    expect(source).toContain('this.startSignalWatchers()')
    expect(source).toContain("if (this.scope === 'full')")
    expect(extensionSource).toContain("dashboardVisible ? 'full' : treeVisible ? 'signals' : 'off'")
  })
})
