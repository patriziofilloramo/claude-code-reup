import { APP } from '../config/app.js'

const debugEnabled = process.env[APP.debugEnvVar] === '1'

/**
 * Minimal structured logger.
 * Set SWOOP_DEBUG=1 to enable debug output.
 */
export const log = {
  debug: (...args: unknown[]): void => {
    // Debug output belongs on stderr so script-friendly commands can reserve
    // stdout for machine-readable results.
    if (debugEnabled) console.error('[swoop:debug]', ...args)
  },
  error: (...args: unknown[]): void => console.error('[swoop:error]', ...args),
  info: (...args: unknown[]): void => console.log('[swoop:info]', ...args),
  warn: (...args: unknown[]): void => console.warn('[swoop:warn]', ...args),
}
