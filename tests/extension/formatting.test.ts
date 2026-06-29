import { describe, expect, it } from 'vitest'

import { compactProjectName } from '../../extension/src/formatting.js'

describe('VS Code extension formatting', () => {
  it('uses the same two-segment project label as the Web and TUI project lists', () => {
    expect(compactProjectName('P:\\Projects\\IT\\Apps\\claude-sessions-manager')).toBe(
      'Apps/claude-sessions-manager'
    )
    expect(compactProjectName('/Users/patri/Projects/Phone')).toBe('Projects/Phone')
    expect(compactProjectName('Test')).toBe('Test')
  })
})
