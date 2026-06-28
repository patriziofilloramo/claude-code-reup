import assert from 'node:assert/strict'

import * as vscode from 'vscode'

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension('reup-local.reup-vscode')
  assert(extension, 'Reup extension must be available in the Extension Host')
  await extension.activate()

  const commands = new Set(await vscode.commands.getCommands(true))
  for (const command of [
    'reup.focusCockpit',
    'reup.openDashboard',
    'reup.openSessionDetail',
    'reup.refreshSessions',
    'reup.resumeHere',
    'reup.resumeSession',
    'reup.searchSessions',
  ]) {
    assert(commands.has(command), `command must be registered: ${command}`)
  }

  await vscode.commands.executeCommand('reup.refreshSessions')
  await vscode.commands.executeCommand('reup.focusCockpit')
}
