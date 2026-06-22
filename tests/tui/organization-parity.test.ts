import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const appSource = readFileSync('src/tui/App.tsx', 'utf8')
const commandsSource = readFileSync('src/tui/commands.ts', 'utf8')
const footerSource = readFileSync('src/tui/components/AppFooter.tsx', 'utf8')
const projectListSource = readFileSync('src/tui/components/ProjectList.tsx', 'utf8')
const resumeCardSource = readFileSync('src/tui/components/ResumeCard.tsx', 'utf8')

describe('TUI organization parity guardrails', () => {
  it('uses the shared smart-view model and exposes keyboard focus controls', () => {
    expect(appSource).toContain("from '../core/session/session-smart-view.js'")
    expect(appSource).toContain('filterProjectsBySmartView(')
    expect(appSource).toContain('nextSessionSmartView(')
    expect(appSource).toContain("input === 'f'")
    expect(commandsSource).toContain("id: 'cycle-focus'")
    expect(commandsSource).toContain("id: 'clear-focus'")
    expect(footerSource).toContain('LABELS.hintFocus')
  })

  it('surfaces organization and provenance without duplicating metadata logic', () => {
    expect(projectListSource).toContain('project.groupName')
    expect(resumeCardSource).toContain('automaticFactLabel(')
    expect(resumeCardSource).toContain('automaticContext.plan.source')
    expect(resumeCardSource).toContain('todos.updatedAt')
  })
})
