import { APP } from '../config/app.js'

const debugEnabled = (process.env[APP.debugEnvVar] ?? process.env[APP.legacyDebugEnvVar]) === '1'

/**
 * Minimal structured logger.
 * Set REUP_DEBUG=1 to enable debug output.
 */
export const log = {
  debug: (...args: unknown[]): void => {
    // Debug output belongs on stderr so script-friendly commands can reserve
    // stdout for machine-readable results.
    if (debugEnabled) console.error('[reup:debug]', ...args)
  },
  error: (...args: unknown[]): void => console.error('[reup:error]', ...args),
  info: (...args: unknown[]): void => console.log('[reup:info]', ...args),
  warn: (...args: unknown[]): void => console.warn('[reup:warn]', ...args),
}
