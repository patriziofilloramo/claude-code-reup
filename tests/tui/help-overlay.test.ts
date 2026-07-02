import { describe, expect, it } from 'vitest'

import { COMMANDS } from '../../src/tui/commands.js'
import { commandsForHelpLayout } from '../../src/tui/components/HelpOverlay.js'
import { helpOverlayLayoutForWidth } from '../../src/tui/layout.js'

describe('TUI help overlay layout', () => {
  it('uses dense labeled compact help when the full card cannot fit', () => {
    expect(helpOverlayLayoutForWidth(34)).toEqual({
      compact: true,
      keyWidth: 8,
      outerPaddingX: 0,
      panelPaddingX: 1,
      panelWidth: 34,
    })
    expect(helpOverlayLayoutForWidth(64)).toEqual({
      compact: false,
      keyWidth: 14,
      outerPaddingX: 2,
      panelPaddingX: 2,
      panelWidth: 60,
    })
  })

  it('removes commands without keybindings from compact help', () => {
    const compactCommandIds = commandsForHelpLayout(COMMANDS, true).map((command) => command.id)
    const fullCommandIds = commandsForHelpLayout(COMMANDS, false).map((command) => command.id)

    expect(compactCommandIds).toContain('resume')
    expect(compactCommandIds).not.toContain('focus-active')
    expect(fullCommandIds).toContain('focus-active')
  })
})
