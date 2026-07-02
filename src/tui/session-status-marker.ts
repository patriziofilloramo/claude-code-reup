import { COLORS } from '../config/theme.js'
import type { SessionStatus } from '../core/session/session-model.js'
import { TUI_LAYOUT } from './layout.js'

export const SESSION_MARKER_WIDTH = TUI_LAYOUT.sessionPanel.markerWidth
export const SESSION_MARKER_PULSE_FRAME_COUNT = 4
export const SESSION_MARKER_PULSE_INTERVAL_MS = 250

const BUSY_PULSE_COLORS = [COLORS.ok, COLORS.ok, COLORS.dim, COLORS.ok] as const
const ATTENTION_PULSE_COLORS = [COLORS.danger, COLORS.warn, COLORS.danger, COLORS.warn] as const

export interface SessionStatusMarker {
  color: string
  glyph: string
}

export interface SessionStatusMarkerState {
  isActive: boolean
  isBulkSelected: boolean
  isBusy: boolean
  isRemotelyActive: boolean
  needsAttention: boolean
  pulseFrame: number
  status: SessionStatus
}

/**
 * Resolves the one marker a session row shows, most urgent state first:
 * waiting on the user, then triage problems, then selection and liveness.
 * The historical `interrupted` status is deliberately absent — it is a
 * full-transcript triage flag for `reup cleanup`/`doctor` that can stay true
 * forever, so it must never drive a live indicator (see PROJECT_MEMORY).
 */
export function sessionStatusMarker({
  isActive,
  isBulkSelected,
  isBusy,
  isRemotelyActive,
  needsAttention,
  pulseFrame,
  status,
}: SessionStatusMarkerState): SessionStatusMarker {
  if (needsAttention) {
    return {
      color: ATTENTION_PULSE_COLORS[pulseFrame % ATTENTION_PULSE_COLORS.length] as string,
      glyph: '!',
    }
  }
  if (status === 'expiring' || status === 'path-missing') {
    return { color: COLORS.danger, glyph: '!' }
  }
  if (isBulkSelected) return { color: COLORS.warn, glyph: '●' }
  if (isBusy) {
    return {
      color: BUSY_PULSE_COLORS[pulseFrame % BUSY_PULSE_COLORS.length] as string,
      glyph: '●',
    }
  }
  if (isActive) return { color: COLORS.ok, glyph: '●' }
  if (isRemotelyActive) return { color: COLORS.muted, glyph: '●' }
  if (status === 'heavily-compacted') return { color: COLORS.muted, glyph: '●' }
  return { color: COLORS.border, glyph: '●' }
}
