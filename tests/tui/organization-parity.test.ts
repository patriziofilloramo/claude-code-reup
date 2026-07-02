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

  it('exposes archive and confirmed delete actions while bulk sessions are selected', () => {
    expect(footerSource).toContain('if (bulkSelectedCount > 0)')
    expect(footerSource).toContain('bulkSelectedCount} {LABELS.wordSelected}')
    expect(footerSource).toContain('LABELS.wordArchive')
    expect(footerSource).toContain('LABELS.wordDelete')
    expect(appSource).toContain("input === 'D' && focusedPanel === 'sessions'")
    expect(appSource).toContain('pendingDeleteIds.size > 0')
    expect(appSource).toContain('D confirm')
    expect(appSource).toContain('esc cancel')
  })

  it('surfaces organization and provenance without duplicating metadata logic', () => {
    expect(projectListSource).toContain('project.groupName')
    expect(projectListSource).toContain('layout.showProjectGroups')
    expect(projectListSource).not.toContain('width={4}')
    expect(projectListSource).not.toContain('width={7}')
    expect(projectListSource).toContain('width={layout.countColumnWidth}')
    expect(resumeCardSource).toContain('automaticFactLabel(')
    expect(resumeCardSource).toContain('automaticContext.plan.source')
    expect(resumeCardSource).toContain('todos.updatedAt')
  })

  it('keeps resume preview actions in the app footer only', () => {
    expect(footerSource).toContain('if (isResumeCardOpen)')
    expect(resumeCardSource).not.toContain('LABELS.keyEnter')
    expect(resumeCardSource).not.toContain('LABELS.keyEsc')
    expect(resumeCardSource).not.toContain('LABELS.keyFiles')
  })
})
