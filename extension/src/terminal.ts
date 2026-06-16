import * as vscode from 'vscode'

import { isValidSessionId } from '../../src/core/session/session-model.js'
import type { ExtensionSession } from './swoop-data.js'
import { pathExists } from './swoop-data.js'

/** Opens Claude Code in a VS Code integrated terminal after validating local state. */
export async function resumeSessionInTerminal(session: ExtensionSession): Promise<void> {
  if (!isValidSessionId(session.id)) {
    throw new Error('Refusing to launch Claude Code with an invalid session ID.')
  }
  if (!(await pathExists(session.projectPath))) {
    throw new Error(`Project path no longer exists: ${session.projectPath}`)
  }

  const terminal = vscode.window.createTerminal({
    cwd: session.projectPath,
    name: `Swoop: ${session.title}`,
  })
  terminal.show()
  terminal.sendText(`claude --resume ${session.id}`, true)
}
