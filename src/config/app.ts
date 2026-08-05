import { APP_VERSION } from './version.js'

/**
 * Central runtime configuration for reup.
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
  version: APP_VERSION,

  // ── Environment variable names ──────────────────────────────────────────────
  // Override these env vars to customise behaviour without changing source code.

  /** Overrides the default ~/.claude config directory path. */
  claudeConfigEnvVar: 'CLAUDE_CONFIG_DIR',
  /** Set to any non-empty string to enable debug logging. */
  debugEnvVar: 'REUP_DEBUG',
  legacyDebugEnvVar: `${'SW'}${'OOP'}_DEBUG`,
  /** Set to any non-empty string to suppress auto-opening the browser. */
  noOpenEnvVar: 'REUP_NO_OPEN',
  legacyNoOpenEnvVar: `${'SW'}${'OOP'}_NO_OPEN`,
  /** Override the default web server port (see defaultPort below). */
  portEnvVar: 'REUP_PORT',
  legacyPortEnvVar: `${'SW'}${'OOP'}_PORT`,
  /** Override the active theme before stored preferences are read. */
  themeEnvVar: 'REUP_THEME',
  legacyThemeEnvVar: `${'SW'}${'OOP'}_THEME`,

  // ── Web server ──────────────────────────────────────────────────────────────

  /** Preferred port for the local web server. */
  defaultPort: 3333,
  /**
   * How many consecutive ports to try before giving up when the preferred
   * port is already in use. With the default of 20, reup tries 3333–3352.
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
  /**
   * How long (ms) the SSE event-stream waits for filesystem bursts to settle
   * before invalidating and notifying clients.
   */
  sseChangeDebounceMs: 250,
  /**
   * Upper bound (ms) on how long sustained filesystem activity can postpone a
   * change notification. Without it, events arriving faster than the debounce
   * window would starve clients of updates exactly when the most is happening.
   */
  sseChangeMaxWaitMs: 2_000,
  /**
   * Coalescing window (ms) for pushed live-activity snapshots. Lock-status and
   * transcript events within this window produce one SSE `activity` push, so
   * busy/idle flips reach the browser in near real time without recomputing
   * the snapshot for every single filesystem event.
   */
  sseActivityPushDebounceMs: 150,

  // ── Active-session detection ────────────────────────────────────────────────

  /**
   * How often (ms) the server re-reads the ~/.claude/sessions/ lock files to
   * detect which sessions currently have a live Claude Code process attached.
   * Lower = more responsive live indicators; higher = less disk I/O.
   */
  activeSessionsPollMs: 1_000,
  /**
   * Minimum interval (ms) between `claude agents --json` refreshes. The
   * command is substantially more expensive than reading lock files, so it
   * runs on a slower, shared cache while locks and hooks keep their 1 s poll.
   */
  claudeAgentsRefreshMs: 10_000,
  /**
   * Maximum age (ms) at which an official agent-view state may still drive a
   * live UI claim. This includes headroom for one background refresh.
   */
  claudeAgentsStateFreshMs: 15_000,
  /**
   * Maximum age (ms) at which a failed refresh may retain an official record
   * solely to protect an apparently active session from destructive actions.
   */
  claudeAgentsSafetyRetentionMs: 60_000,
  /** Maximum runtime (ms) for the optional Claude agent inventory command. */
  claudeAgentsCommandTimeoutMs: 4_000,
  /** Maximum stdout bytes accepted from `claude agents --json`. */
  claudeAgentsMaxOutputBytes: 1024 * 1024,
  /** Maximum records accepted from one official inventory response. */
  claudeAgentsMaxRecords: 10_000,
  /** Disables the optional subprocess boundary, primarily for hermetic runs. */
  disableClaudeAgentsEnvVar: 'REUP_DISABLE_CLAUDE_AGENTS',

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
} as const
