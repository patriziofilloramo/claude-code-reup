import { releaseTerminalInput } from '../tui/terminal-input.js'
import { failCommand } from './output.js'

type ConfigTab = 'Integrations' | 'Interface'

interface OpenConfigInterfaceOptions {
  commandName: string
  initialTab?: ConfigTab
  nonInteractiveAlternative?: string
}

/**
 * Opens the shared configuration TUI only when both standard streams support
 * an interactive terminal. Commands remain predictable in scripts and CI.
 */
export async function openConfigInterface(options: OpenConfigInterfaceOptions): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    const alternative = options.nonInteractiveAlternative
      ? `; ${options.nonInteractiveAlternative}`
      : ''
    failCommand(`${options.commandName} requires an interactive terminal${alternative}`)
    return
  }

  const { runConfigApp } = await import('../tui/ConfigApp.js')
  releaseTerminalInput()
  await runConfigApp({ initialTab: options.initialTab })
}
