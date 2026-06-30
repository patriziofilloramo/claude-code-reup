/**
 * Shared API model layer — types and serialisation helpers used by both the
 * Hono route handlers (server) and the JavaScript browser client (consumer).
 *
 * Keeping these definitions here means the server and client stay in sync
 * without a code-generation step. The types exported below are the single
 * source of truth for every JSON response shape the server produces.
 */

import type { Project, Session, SessionStatus } from '../core/session/session-model.js'
import type { TranscriptHandoffContext } from '../core/session/session-handoff.js'
import type { SessionPreview } from '../core/session/session-preview.js'
import { primaryStatus } from '../core/session/session-signals.js'
import { isResumeVisibleSession } from '../core/session/session-visibility.js'
import {
  getProjectSyncStatus,
  isProjectMemorySyncEnabled,
  type ProjectSyncStatus,
} from '../core/sync/project-sync-status.js'

// ---------------------------------------------------------------------------
// Core entity types
// ---------------------------------------------------------------------------

/**
 * A session enriched with a derived `primaryStatus` field.
 * Returned by every endpoint that surfaces session data.
 */
export type ApiSession = Session & { primaryStatus: SessionStatus }

/**
 * A project whose session list contains {@link ApiSession} entries rather than
 * bare {@link Session} entries.
 */
export type ApiProject = Omit<Project, 'sessions'> & {
  sessions: ApiSession[]
  syncStatus: ProjectSyncStatus | null
}

// ---------------------------------------------------------------------------
// Search responses
// ---------------------------------------------------------------------------

/**
 * A single metadata-search hit. Returned by `GET /api/search`.
 * Contains enough context to navigate directly to the matching session.
 */
export interface ApiSearchHit {
  /** The matching session (with primaryStatus). */
  id: string
  name: string
  alias?: string
  projectName: string
  primaryStatus: SessionStatus
}

/**
 * A single deep-search hit. Returned by `GET /api/search/deep`.
 * Includes a human-readable snippet for display in the session list.
 */
export interface ApiDeepSearchHit {
  sessionId: string
  sessionName: string
  projectId: string
  projectName: string
  /** Number of lines in the transcript that contain the query string. */
  matchCount: number
  /** A short excerpt of the first matching line, trimmed for display. */
  snippet?: string
}

/** Full response envelope for `GET /api/search/deep`. */
export interface ApiDeepSearchResponse {
  matches: ApiDeepSearchHit[]
}

/**
 * One file written across sessions. Returned by `GET /api/touched/files`.
 * The reverse-lookup view lists these, then drills into the sessions per file.
 */
export interface ApiTouchedFile {
  path: string
  sessionCount: number
  lastTouchedAt: string
  gitBranch: string | null
}

/** Full response envelope for `GET /api/touched/files`. */
export interface ApiTouchedFilesResponse {
  files: ApiTouchedFile[]
}

/**
 * One session that wrote a queried file. Returned by `GET /api/touched/sessions`.
 * Ordered by reverse-lookup relevance (edit count, then most recent touch).
 */
export interface ApiTouchedSession {
  sessionId: string
  sessionName: string
  projectId: string
  projectName: string
  matchCount: number
  lastTouchedAt: string | null
  gitBranch: string | null
  active: boolean
}

/** Full response envelope for `GET /api/touched/sessions`. */
export interface ApiTouchedSessionsResponse {
  matches: ApiTouchedSession[]
}

// ---------------------------------------------------------------------------
// Active-session response
// ---------------------------------------------------------------------------

/** Response for `GET /api/active`. */
export interface ApiActiveResponse {
  /** UUIDs of sessions that currently have a live Claude Code process. */
  sessionIds: string[]
}

// ---------------------------------------------------------------------------
// Session-mutation responses
// ---------------------------------------------------------------------------

/**
 * Success response for archive and alias mutation endpoints.
 * A `false` value for `ok` indicates a handled error (not a 500).
 */
export interface ApiOkResponse {
  ok: true
}

// ---------------------------------------------------------------------------
// Launch responses
// ---------------------------------------------------------------------------

/**
 * Response for `POST /api/resume/:id` and `POST /api/new-session`.
 * Exactly one of `launched` or `copied` is true on success.
 */
export interface ApiLaunchResponse {
  /** True when the terminal was opened successfully. */
  launched: boolean
  /** True when the launch failed but the command was copied to the clipboard. */
  copied: boolean
  /** Present when `launched` and `copied` are both false. */
  message?: string
}

// ---------------------------------------------------------------------------
// Transcript response
// ---------------------------------------------------------------------------

/**
 * Response for `GET /api/session/:id`.
 * Events are raw JSONL-parsed objects; the client is responsible for
 * narrowing to the specific event shapes it cares about.
 */
export interface ApiTranscriptResponse {
  events: Record<string, unknown>[]
}

// ---------------------------------------------------------------------------
// Resume-card and handoff responses
// ---------------------------------------------------------------------------

/** Response for `GET /api/sessions/:projectId/:sessionId/preview`. */
export type ApiSessionPreviewResponse = SessionPreview

/** Response for `GET /api/sessions/:projectId/:sessionId/handoff`. */
export interface ApiSessionHandoffResponse {
  context: TranscriptHandoffContext
  markdown: string
}

// ---------------------------------------------------------------------------
// CLAUDE.md responses
// ---------------------------------------------------------------------------

/** Response for `GET /api/claude-md/:projectId` when a file exists. */
export interface ApiClaudeMdResponse {
  /** Absolute filesystem path to the CLAUDE.md file. */
  path: string
  /** Raw file content (may be empty string). */
  content: string
}

// ---------------------------------------------------------------------------
// Error envelope
// ---------------------------------------------------------------------------

/**
 * Standard error response shape returned on 4xx and 5xx responses.
 * All route handlers that use {@link apiRoute} or {@link guardedRoute} produce
 * this shape on unhandled exceptions. Handlers may also return it explicitly
 * for validation errors.
 */
export interface ApiErrorResponse {
  error: string
}

// ---------------------------------------------------------------------------
// Serialisation helpers
// ---------------------------------------------------------------------------

/**
 * Enriches a raw {@link Session} with its derived `primaryStatus`.
 * Use whenever a session is included in an API response.
 */
export function serializeSession(session: Session): ApiSession {
  return { ...session, primaryStatus: primaryStatus(session.signals) }
}

/**
 * Serialises a {@link Project} and all its sessions for API responses.
 * Use for the `/api/projects` endpoint and any response that embeds project data.
 */
export function serializeProject(
  project: Project,
  projectMemorySyncEnabled = isProjectMemorySyncEnabled()
): ApiProject {
  return {
    ...project,
    sessions: project.sessions.filter(isResumeVisibleSession).map(serializeSession),
    syncStatus: getProjectSyncStatus(project, projectMemorySyncEnabled),
  }
}

/**
 * Returns the last path segment of a project path as its display name.
 * Falls back to the full path if no separators are found.
 *
 * @example
 * projectDisplayName({ path: '/home/user/my-project' }) // → 'my-project'
 */
export function projectDisplayName(project: Project): string {
  return project.path.split(/[/\\]/).filter(Boolean).pop() ?? project.path
}
