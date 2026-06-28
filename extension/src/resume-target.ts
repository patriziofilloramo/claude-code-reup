import * as vscode from 'vscode'

import type { ReupLogger } from './logger.js'
import type { ExtensionSession } from './reup-data.js'
import { resumeSessionInTerminal, validateResumeSession } from './terminal.js'
import { getMigratedGlobalState } from './configuration.js'

const CLAUDE_EXTENSION_ID = 'anthropic.claude-code'
const CLAUDE_RESUME_COMMAND = 'claude-vscode.editor.open'
// Versioned so users of the earlier implicit-save behavior get one explicit choice.
const PREFERENCE_KEY = 'reup.resumeTarget.v2'

export type ResumeTarget = 'claude-extension' | 'terminal'

export interface ResumeCapabilities {
  claudeExtensionAvailable: boolean
  preferredTarget: ResumeTarget | null
}

export interface ResumeOptions {
  remember?: boolean
  target?: ResumeTarget
}

interface ResumeTargetItem extends vscode.QuickPickItem {
  target: ResumeTarget
}

export class SessionResumeService {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly logger: ReupLogger
  ) {}

  async getCapabilities(): Promise<ResumeCapabilities> {
    const claudeExtensionAvailable =
      vscode.extensions.getExtension(CLAUDE_EXTENSION_ID) !== undefined
    const storedValue = await getMigratedGlobalState<unknown>(this.context, PREFERENCE_KEY)
    const storedTarget = isResumeTarget(storedValue) ? storedValue : null

    return {
      claudeExtensionAvailable,
      preferredTarget:
        storedTarget === 'claude-extension' && !claudeExtensionAvailable
          ? 'terminal'
          : (storedTarget ?? (claudeExtensionAvailable ? null : 'terminal')),
    }
  }

  async resume(
    session: ExtensionSession,
    options: ResumeOptions = {}
  ): Promise<ResumeTarget | null> {
    const capabilities = await this.getCapabilities()
    if (session.advice.code === 'already-active') {
      if (!capabilities.claudeExtensionAvailable) {
        throw new Error(
          'This session is already active. Install or enable the Claude Code extension to jump to its tab.'
        )
      }
      await openSessionInClaudeExtension(session)
      return 'claude-extension'
    }
    if (session.advice.code === 'path-missing') {
      throw new Error(session.advice.explanation)
    }
    await validateResumeSession(session)
    const promptedChoice =
      options.target === undefined && capabilities.preferredTarget === null
        ? await chooseResumeTarget()
        : null
    if (
      options.target === undefined &&
      capabilities.preferredTarget === null &&
      promptedChoice === null
    )
      return null

    const target =
      options.target ?? promptedChoice?.target ?? capabilities.preferredTarget ?? 'terminal'
    const remember = options.remember === true || promptedChoice?.remember === true

    if (target === 'claude-extension' && capabilities.claudeExtensionAvailable) {
      try {
        await openSessionInClaudeExtension(session)
        if (remember) await this.setPreferredTarget(target)
        return target
      } catch (error) {
        this.logger.error('Claude Code extension resume failed; falling back to terminal', error)
        void vscode.window.showWarningMessage(
          'Claude Code Extension could not open this session. Resuming in the terminal instead.'
        )
        await resumeSessionInTerminal(session)
        return 'terminal'
      }
    }

    await resumeSessionInTerminal(session)
    if (remember) await this.setPreferredTarget('terminal')
    return 'terminal'
  }

  private async setPreferredTarget(target: ResumeTarget): Promise<void> {
    await this.context.globalState.update(PREFERENCE_KEY, target)
  }
}

export function isResumeTarget(value: unknown): value is ResumeTarget {
  return value === 'claude-extension' || value === 'terminal'
}

async function openSessionInClaudeExtension(session: ExtensionSession): Promise<void> {
  await vscode.commands.executeCommand(
    CLAUDE_RESUME_COMMAND,
    session.id,
    undefined,
    vscode.ViewColumn.Active
  )
}

async function chooseResumeTarget(): Promise<{
  remember: boolean
  target: ResumeTarget
} | null> {
  const picker = vscode.window.createQuickPick<ResumeTargetItem>()
  let remember = true
  const updateRememberButton = (): void => {
    picker.title = `Reup: Resume With — ${remember ? '✓ Remember my choice' : 'Remember my choice: off'}`
    picker.buttons = [
      {
        iconPath: new vscode.ThemeIcon(remember ? 'check' : 'circle-large-outline'),
        tooltip: remember ? 'Remember my choice: on' : 'Remember my choice: off',
      },
    ]
  }

  picker.placeholder = 'Choose where to resume this session'
  picker.items = [
    {
      description: 'Open the native Claude Code editor',
      iconPath: new vscode.ThemeIcon('sparkle'),
      label: 'Claude Code Extension',
      target: 'claude-extension',
    },
    {
      description: 'Run claude --resume in the recorded project directory',
      iconPath: new vscode.ThemeIcon('terminal'),
      label: 'VS Code Terminal',
      target: 'terminal',
    },
  ]
  updateRememberButton()

  return new Promise((resolve) => {
    let finished = false
    const finish = (result: { remember: boolean; target: ResumeTarget } | null): void => {
      if (finished) return
      finished = true
      picker.dispose()
      resolve(result)
    }
    picker.onDidTriggerButton(() => {
      remember = !remember
      updateRememberButton()
    })
    picker.onDidAccept(() => {
      const selected = picker.selectedItems[0]
      if (selected) finish({ remember, target: selected.target })
    })
    picker.onDidHide(() => finish(null))
    picker.show()
  })
}
