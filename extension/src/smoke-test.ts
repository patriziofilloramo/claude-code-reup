import assert from 'node:assert/strict'

import * as vscode from 'vscode'

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension('swoop-local.swoop-vscode')
  assert(extension, 'Swoop extension must be available in the Extension Host')
  await extension.activate()

  const commands = new Set(await vscode.commands.getCommands(true))
  for (const command of [
    'swoop.focusCockpit',
    'swoop.openSessionDetail',
    'swoop.refreshSessions',
    'swoop.resumeHere',
    'swoop.resumeSession',
  ]) {
    assert(commands.has(command), `command must be registered: ${command}`)
  }

  await vscode.commands.executeCommand('swoop.refreshSessions')
  await vscode.commands.executeCommand('swoop.focusCockpit')
}
