import { describe, expect, it } from 'vitest'

import * as legacySessionsApi from '../../src/core/sessions.js'

describe('legacy core sessions entry point', () => {
  it('continues to expose the original public core API', () => {
    expect(Object.keys(legacySessionsApi).sort()).toEqual(
      [
        'computeSignalsFromLines',
        'dirToPath',
        'getActiveSessions',
        'getClaudeDir',
        'isValidSessionId',
        'loadProjectById',
        'loadProjects',
        'primaryStatus',
        'relativeTime',
        'setSessionAlias',
        'setSessionArchived',
      ].sort()
    )
  })
})
