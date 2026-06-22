import { describe, expect, it } from 'vitest'

import {
  parseSessionQuery,
  sessionMatchesParsedQuery,
} from '../../src/core/session/session-query.js'

const document = {
  active: true,
  archived: false,
  branches: ['feat/search', 'main'],
  project: ['project-id', 'P:\\Projects\\Swoop', '/Users/device/Projects/Swoop'],
  status: 'ok',
  tags: ['important', 'extension'],
  text: ['session-id', 'Improve session search'],
}

describe('session query', () => {
  it('matches text and shared metadata qualifiers', () => {
    for (const query of [
      'session search',
      'project:swoop',
      'branch:search',
      'tag:important',
      '#extension',
      'status:ok',
      'is:active',
      'project:device tag:extension is:active',
    ]) {
      expect(sessionMatchesParsedQuery(document, parseSessionQuery(query)), query).toBe(true)
    }
  })

  it('rejects unmatched qualifiers and archived-only searches', () => {
    for (const query of ['project:other', 'branch:release', '#missing', 'is:archived']) {
      expect(sessionMatchesParsedQuery(document, parseSessionQuery(query)), query).toBe(false)
    }
  })
})
