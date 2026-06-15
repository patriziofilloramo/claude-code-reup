/**
 * Backward-compatible entry point for consumers of the original core API.
 *
 * Internal code should import from the domain modules under `core/session/`.
 * Keep this facade at its historical path so reorganizing source files does
 * not break existing package consumers.
 */
export * from './session/sessions.js'
