/**
 * Compatibility facade for the original core API.
 *
 * New internal code should import the module that owns each responsibility.
 * Keeping these re-exports avoids breaking existing consumers while the source
 * layout remains explicit and navigable.
 */
export { getActiveSessions } from './active-sessions.js'
export {
  decodeProjectDirectoryName as dirToPath,
  getClaudeDirectory as getClaudeDir,
} from './claude-paths.js'
export { loadProjectById, loadProjects } from './project-discovery.js'
export { isValidSessionId } from './session-model.js'
export type {
  Project,
  Session,
  SessionContextMetrics,
  SessionSignals,
  SessionStatus,
} from './session-model.js'
export { setSessionAlias, setSessionArchived } from './session-metadata.js'
export { computeSignalsFromLines, primaryStatus } from './session-signals.js'
export { relativeTime } from '../utils/time.js'
