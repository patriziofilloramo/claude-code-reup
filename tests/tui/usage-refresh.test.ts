import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(process.cwd(), 'src', 'tui', 'App.tsx'), 'utf8')

describe('TUI usage refresh', () => {
  it('loads usage immediately without waiting for project discovery', () => {
    expect(source).toContain('void refreshUsage()')
    expect(source).toContain('setInterval(() => void refreshUsage(), APP.usagePollMs)')
    expect(source).not.toContain(
      'Promise.all([loadProjects(), getActiveSessions(), readLiveUsageSummary()])'
    )
  })
})
