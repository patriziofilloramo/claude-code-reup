import assert from 'node:assert/strict'
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

  await assertOutOfWorkspaceFileWatcherFires()
}

/**
 * Proves the editor reports changes to a single file outside the workspace.
 *
 * Retracting a stale needs-input claim depends on it: Claude's transcripts live
 * under the user's home directory, never inside the open folder, and answering
 * a permission prompt writes nothing else. Reup already watches directories out
 * there, but a file-specific pattern is a different request of the editor, and
 * no stub can answer whether VS Code honours it — a wrong assumption here makes
 * the fix inert rather than incorrect, which is the harder failure to notice.
 */
async function assertOutOfWorkspaceFileWatcherFires(): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'reup-watch-smoke-'))
  const transcript = join(directory, 'session.jsonl')
  writeFileSync(transcript, '{"type":"user"}\n')

  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(directory, 'session.jsonl')
  )
  let writeTimer: NodeJS.Timeout | undefined

  try {
    const fired = new Promise<boolean>((resolve) => {
      const deadline = setTimeout(() => resolve(false), 15_000)
      watcher.onDidChange(() => {
        clearTimeout(deadline)
        resolve(true)
      })
    })

    // Watcher registration is asynchronous, so a single write can land before
    // the editor is listening. Keep appending until the event arrives; this is
    // about whether the editor ever reports, not how fast it starts.
    writeTimer = setInterval(() => {
      appendFileSync(transcript, '{"type":"assistant"}\n')
    }, 250)

    assert(
      await fired,
      'VS Code must report changes to a watched file outside the workspace; ' +
        'without it the needs-input retraction never fires'
    )
  } finally {
    if (writeTimer) clearInterval(writeTimer)
    watcher.dispose()
    rmSync(directory, { force: true, recursive: true })
  }
}
