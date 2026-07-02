import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const CONFIG_APP_PATH = join(process.cwd(), 'src', 'tui', 'ConfigApp.tsx')

describe('config integrations layout', () => {
  it('uses focused cards for usage and shell completion', async () => {
    const source = await readFile(CONFIG_APP_PATH, 'utf8')
    const integrations = source.slice(
      source.indexOf('function IntegrationsTab('),
      source.indexOf('function FeaturesTab(')
    )

    expect(integrations).toContain('const usageFocused = cursor === 0')
    expect(integrations).toContain('<FeatureCard focused={usageFocused}>')
    expect(integrations).toContain(
      'const attentionFocused = cursor === INTEGRATION_ATTENTION_CURSOR'
    )
    expect(integrations).toContain('<FeatureCard focused={attentionFocused}>')
    expect(integrations).toContain(
      '<FeatureCard focused={cursor >= INTEGRATION_FIRST_SHELL_CURSOR}>'
    )
  })

  it('aligns headings, rows, descriptions, and focused details', async () => {
    const source = await readFile(CONFIG_APP_PATH, 'utf8')
    const integrations = source.slice(
      source.indexOf('function IntegrationsTab('),
      source.indexOf('function FeaturesTab(')
    )

    expect(integrations).toContain('<Box flexDirection="column" paddingLeft={2}>')
    expect(source).toContain('<Box paddingLeft={3}>')
    expect(source).toContain('marginBottom={noBottomMargin ? 0 : 1}')
  })

  it('puts the detected shell first and renders a prominent badge', async () => {
    const source = await readFile(CONFIG_APP_PATH, 'utf8')

    expect(source).toContain(
      '.sort((left, right) => Number(right.detected) - Number(left.detected))'
    )
    expect(source).toContain('DISPLAY_SHELLS[cursor - INTEGRATION_FIRST_SHELL_CURSOR]')
    expect(source).toContain('DISPLAY_SHELLS.map')
    expect(source).toContain('<Text bold color={COLORS.ok} inverse>')
  })
})
