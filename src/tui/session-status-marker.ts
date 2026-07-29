import { COLORS } from '../config/theme.js'
import type { SessionLiveState } from '../core/session/session-live-state.js'
import type { SessionStatus } from '../core/session/session-model.js'
import { TUI_LAYOUT } from './layout.js'

export const SESSION_MARKER_WIDTH = TUI_LAYOUT.sessionPanel.markerWidth
export const SESSION_MARKER_PULSE_FRAME_COUNT = 4
export const SESSION_MARKER_PULSE_INTERVAL_MS = 250

const BUSY_PULSE_COLORS = [COLORS.ok, COLORS.ok, COLORS.dim, COLORS.ok] as const
const ATTENTION_PULSE_COLORS = [COLORS.danger, COLORS.warn, COLORS.danger, COLORS.warn] as const

export interface SessionStatusMarker {
  color: string
  /**
   * Renders the same colour at reduced intensity. Preferred over a darker hex
   * so the shade survives 16-colour terminals and every theme unchanged.
   */
  dim: boolean
  glyph: string
}

export interface SessionStatusMarkerState {
  isBulkSelected: boolean
  isRemotelyActive: boolean
  /** The shared cross-surface reading; the TUI does not derive its own. */
  liveState: SessionLiveState
  pulseFrame: number
  status: SessionStatus
}

/**
 * Resolves the one marker a session row shows, most urgent state first:
 * waiting on the user, then triage problems, then selection and liveness.
 *
 * The liveness half of that order is `SessionLiveState`, so a live session
 * reads here exactly as it does in the web UI and the extension. What stays
 * local to the TUI is only presentation plus the states no other surface has:
 * bulk selection and the `reup cleanup`/`doctor` triage flags.
 *
 * The historical `interrupted` status is deliberately absent — it is a
 * full-transcript triage flag that can stay true forever, so it must never
 * drive a live indicator (see PROJECT_MEMORY).
 */
export function sessionStatusMarker({
  isBulkSelected,
  isRemotelyActive,
  liveState,
  pulseFrame,
  status,
}: SessionStatusMarkerState): SessionStatusMarker {
  if (liveState === 'needs-input') {
    return {
      color: ATTENTION_PULSE_COLORS[pulseFrame % ATTENTION_PULSE_COLORS.length] as string,
      dim: false,
      glyph: '!',
    }
  }
  if (status === 'expiring' || status === 'path-missing') {
    return { color: COLORS.danger, dim: false, glyph: '!' }
  }
  if (isBulkSelected) return { color: COLORS.warn, dim: false, glyph: '●' }
  if (liveState === 'working') {
    return {
      color: BUSY_PULSE_COLORS[pulseFrame % BUSY_PULSE_COLORS.length] as string,
      dim: false,
      glyph: '●',
    }
  }
  // Attached but quiet: still the live colour, held back so a working session
  // stays the brightest thing on screen.
  if (liveState === 'attached') return { color: COLORS.ok, dim: true, glyph: '●' }
  if (isRemotelyActive) return { color: COLORS.muted, dim: false, glyph: '●' }
  if (status === 'heavily-compacted') return { color: COLORS.muted, dim: false, glyph: '●' }
  return { color: COLORS.border, dim: false, glyph: '●' }
}
