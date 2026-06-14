import { APP } from '../config/app.js'

const debugEnabled = process.env[APP.debugEnvVar] === '1'

/**
 * Minimal structured logger.
 * Set CCM_DEBUG=1 to enable debug output.
 */
export const log = {
  debug: (...args: unknown[]): void => {
    // Debug output belongs on stderr so script-friendly commands can reserve
    // stdout for machine-readable results.
    if (debugEnabled) console.error('[ccm:debug]', ...args)
  },
  error: (...args: unknown[]): void => console.error('[ccm:error]', ...args),
  info: (...args: unknown[]): void => console.log('[ccm:info]', ...args),
  warn: (...args: unknown[]): void => console.warn('[ccm:warn]', ...args),
}
