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

export function statusCodicon(status: SessionStatus, isActive: boolean): string {
  return `$(${statusThemeIconId(status, isActive)})`
}

export function statusThemeIconId(status: SessionStatus, isActive: boolean): string {
  if (isActive) return 'circle-filled'
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

export function statusThemeColorId(status: SessionStatus, isActive: boolean): string | undefined {
  if (isActive) return 'testing.iconPassed'
  if (status === 'interrupted') return 'problemsWarningIcon.foreground'
  if (status === 'expiring' || status === 'path-missing') return 'problemsErrorIcon.foreground'
  if (status === 'heavily-compacted') return 'descriptionForeground'
  return undefined
}
