import type { SessionLiveState } from '../../src/core/session/session-live-state.js'
import type { SessionStatus } from '../../src/core/session/session-model.js'
import { relativeTime } from '../../src/utils/time.js'

export function compactProjectName(projectPath: string): string {
  return (
    projectPath.replace(/\\/g, '/').split('/').filter(Boolean).slice(-2).join('/') || projectPath
  )
}

export function compactText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1)}...`
}

export function formatContextTokens(tokens: number | null): string | null {
  if (tokens === null) return null
  if (tokens >= 1_000) return `${Math.round(tokens / 100) / 10}k ctx`
  return `${tokens} ctx`
}

export function formatRelativeTime(isoTimestamp: string | null): string {
  return isoTimestamp ? relativeTime(isoTimestamp) : 'unknown'
}

export function statusCodicon(status: SessionStatus, liveState: SessionLiveState): string {
  return `$(${statusThemeIconId(status, liveState)})`
}

/**
 * Draws the shared `SessionLiveState` in VS Code's own idiom.
 *
 * The TUI and the web separate a working session from an attached-but-quiet
 * one by intensity — a pulsing dot against a dimmed one. A tree icon has no
 * intensity, so the same distinction is carried by fill: filled means work is
 * happening, outline means someone is here. The green colour is what both
 * share, and what tells them apart from a session with no process at all.
 */
export function statusThemeIconId(status: SessionStatus, liveState: SessionLiveState): string {
  // Waiting on the user outranks the live dot: an active session is exactly
  // where a needs-input alert must stay visible.
  if (liveState === 'needs-input') return 'bell-dot'
  if (liveState === 'working') return 'circle-filled'
  if (liveState === 'attached') return 'circle-outline'
  switch (status) {
    case 'expiring':
      return 'warning'
    case 'heavily-compacted':
      return 'layers'
    case 'interrupted':
      return 'error'
    case 'path-missing':
      return 'debug-disconnect'
    case 'ok':
      return 'circle-outline'
  }
}

export function statusLabel(status: SessionStatus): string | null {
  switch (status) {
    case 'interrupted':
      return 'interrupted'
    case 'expiring':
      return 'expiring soon'
    case 'path-missing':
      return 'path missing'
    case 'heavily-compacted':
      return 'heavy context'
    case 'ok':
      return null
  }
}

export function statusThemeColorId(
  status: SessionStatus,
  liveState: SessionLiveState
): string | undefined {
  if (liveState === 'needs-input') return 'problemsWarningIcon.foreground'
  // Both live states share the live colour, exactly as the TUI and the web
  // share one green; the icon's fill is what separates them.
  if (liveState === 'working' || liveState === 'attached') return 'testing.iconPassed'
  if (status === 'interrupted') return 'problemsWarningIcon.foreground'
  if (status === 'expiring' || status === 'path-missing') return 'problemsErrorIcon.foreground'
  if (status === 'heavily-compacted') return 'descriptionForeground'
  return undefined
}
