/**
 * Central runtime configuration for swoop.
 *
 * All tunable values live here so they can be found and changed in one place.
 * Browser-only values (poll intervals visible in the client) stay in the
 * standalone `client.js` to avoid a frontend build step — but any value that
 * affects server behaviour should be in this file.
 *
 * To add a new configurable value:
 *   1. Add it here with a JSDoc comment explaining what it does and the unit.
 *   2. Import APP from this module wherever you need it.
 *   3. Never hard-code the value at the call-site; always reference APP.xxx.
 */
export const APP = {
  // ── Application identity ────────────────────────────────────────────────────
  version: '0.1.0',

  // ── Environment variable names ──────────────────────────────────────────────
  // Override these env vars to customise behaviour without changing source code.

  /** Overrides the default ~/.claude config directory path. */
  claudeConfigEnvVar: 'CLAUDE_CONFIG_DIR',
  /** Set to any non-empty string to enable debug logging. */
  debugEnvVar: 'SWOOP_DEBUG',
  /** Set to any non-empty string to suppress auto-opening the browser. */
  noOpenEnvVar: 'SWOOP_NO_OPEN',
  /** Override the default web server port (see defaultPort below). */
  portEnvVar: 'SWOOP_PORT',

  // ── Web server ──────────────────────────────────────────────────────────────

  /** Preferred port for the local web server. */
  defaultPort: 3333,
  /**
   * How many consecutive ports to try before giving up when the preferred
   * port is already in use. With the default of 20, swoop tries 3333–3352.
   */
  portSearchRange: 20,

  // ── Session discovery ───────────────────────────────────────────────────────

  /**
   * Maximum number of sessions returned from the metadata search endpoint.
   * Lower values keep the dropdown fast; raise if you work with many projects.
   */
  maxSearchResults: 50,
  /**
   * Maximum characters taken from the first user message when constructing an
   * auto-generated session title. Longer messages are truncated with "…".
   */
  titleMaxChars: 80,

  // ── Project polling ─────────────────────────────────────────────────────────

  /**
   * How often (ms) the SSE event-stream triggers a background project re-scan.
   * Lower values mean the TUI and web UI react faster to new/deleted sessions,
   * at the cost of more filesystem reads. 20 s is a reasonable default.
   */
  projectRefreshMs: 20_000,

  // ── Active-session detection ────────────────────────────────────────────────

  /**
   * How often (ms) the server re-reads the ~/.claude/sessions/ lock files to
   * detect which sessions currently have a live Claude Code process attached.
   * Lower = more responsive live indicators; higher = less disk I/O.
   */
  activeSessionsPollMs: 1_000,

  // ── Usage capture ───────────────────────────────────────────────────────────

  /**
   * How often (seconds) the local usage-capture daemon writes a new snapshot.
   * This controls how fresh the token-usage figures in the web header are.
   */
  usageCaptureRefreshSeconds: 10,
  /**
   * How often (ms) the web server re-reads the latest usage snapshot when the
   * /api/usage endpoint is polled.
   */
  usagePollMs: 5_000,
  /**
   * A usage snapshot older than this (ms) is considered stale and shown with
   * a dimmed indicator in the web header. Claude's status-line feed is
   * event-driven, so a quiet session quickly goes quiet.
   */
  usageStaleMs: 60_000,
  /**
   * How often (ms) the server attempts to refresh the account-level usage
   * summary (plan limits, credits remaining, etc.) from the local Claude data.
   */
  accountUsageRefreshMs: 30_000,
  /**
   * Maximum age (ms) of a cached account-usage summary before it is
   * considered too stale to display, even as a fallback.
   */
  accountUsageFallbackMaxAgeMs: 15 * 60_000,
  /**
   * Timeout (ms) for individual account-usage HTTP requests. Keeps the UI
   * responsive if the local Claude API is slow to respond.
   */
  accountUsageRequestTimeoutMs: 5_000,

  // ── Cloud sync ──────────────────────────────────────────────────────────────

  /**
   * Subdirectory name created inside the project root by `swoop sync link` to hold
   * the cross-device session files that are kept in sync with local storage.
   */
  cloudMemoryDir: '.claude-memory',
  /**
   * Marker file written inside ~/.claude/projects/<id>/ to record which cloud
   * directory the project is linked to. Its presence means local-first sync
   * is active; its absence means local-only storage.
   */
  cloudLinkFile: '.swoop-link',
  /**
   * How often (ms) the background offline-guard loop checks whether the cloud
   * junction target is reachable and transitions between online/offline modes.
   * Also the interval at which the local backup is refreshed from the cloud.
   */
  cloudSyncIntervalMs: 30_000,
  /**
   * Path segment appended to getSwoopDirectory() (~/.claude/swoop/) to locate the
   * local backup root. Each linked project gets its own subdirectory here:
   *   ~/.claude/swoop/<cloudSyncBackupDir>/<projectId>/
   * The backup is kept in sync with the cloud dir and used as an offline
   * fallback when the junction target (pCloud, etc.) becomes unreachable.
   */
  cloudSyncBackupDir: 'sync',
} as const
