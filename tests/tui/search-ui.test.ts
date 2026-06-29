import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const appFooterSource = readFileSync('src/tui/components/AppFooter.tsx', 'utf8')
const appSource = readFileSync('src/tui/App.tsx', 'utf8')
const deepSearchSource = readFileSync('src/tui/DeepSearchPicker.tsx', 'utf8')
const searchResultsSource = readFileSync('src/tui/SearchResultsPicker.tsx', 'utf8')

describe('TUI search UI guardrails', () => {
  it('gives deep search a visible accent from normal search surfaces', () => {
    expect(appFooterSource).toContain('COLORS.orange')
    expect(appFooterSource).toContain('<Text bold>{LABELS.keyTab}</Text>')
    expect(appFooterSource).toContain('LABELS.hintDeepSearch')
    expect(searchResultsSource).toContain('LABELS.deepSearchCta')
    expect(searchResultsSource).toContain('LABELS.deepSearchScansTranscripts')
    expect(searchResultsSource).toContain('COLORS.orange')
  })

  it('keeps deep search results list-like while separating snippets from metadata', () => {
    expect(deepSearchSource).toContain('LABELS.deepSearchTitle')
    expect(deepSearchSource).toContain("{'HITS'.padEnd")
    expect(deepSearchSource).toContain('row.matches.padEnd')
    expect(deepSearchSource).toContain('↳')
    expect(deepSearchSource).toContain('snippetIndent')
    expect(deepSearchSource).toContain('COLORS.orange')
  })

  it('uses the global app footer for embedded deep search instead of rendering two footers', () => {
    expect(deepSearchSource).toContain('showFooter = true')
    expect(deepSearchSource).toContain('{showFooter ? (')
    expect(appSource).toContain('showFooter={false}')
  })
})
