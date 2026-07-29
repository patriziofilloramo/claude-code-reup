import * as vscode from 'vscode'

import { getReupConfigurationValue } from './configuration.js'
import { formatRelativeTime, statusCodicon } from './formatting.js'
import { copySessionHandoff } from './handoff.js'
import type { ReupLogger } from './logger.js'
import type { SessionResumeService } from './resume-target.js'
import type {
  ExtensionSession,
  ExtensionTouchedFile,
  ExtensionTouchedMatch,
  ReupDataSource,
} from './reup-data.js'

const RESUME_BUTTON: vscode.QuickInputButton = {
  iconPath: new vscode.ThemeIcon('debug-start'),
  tooltip: 'Resume session',
}
const COPY_BUTTON: vscode.QuickInputButton = {
  iconPath: new vscode.ThemeIcon('clippy'),
  tooltip: 'Copy Handoff',
}

interface FileItem extends vscode.QuickPickItem {
  file: ExtensionTouchedFile
}

interface SessionItem extends vscode.QuickPickItem {
  session: ExtensionSession
}

/**
 * A dedicated "find sessions by touched file" flow: pick a file written across
 * your sessions, then pick which session that wrote it to resume or inspect.
 * It mirrors the CLI and TUI feature and stays separate from metadata search.
 */
export async function showTouchedFileSearch(
  dataSource: ReupDataSource,
  logger: ReupLogger,
  resumeService: SessionResumeService,
  onOpenInspector: (session: ExtensionSession) => Promise<void>
): Promise<void> {
  const includeArchived = getReupConfigurationValue<boolean>('includeArchived', false)

  const files = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: 'Reup: scanning touched files' },
    () => dataSource.listTouchedFiles(includeArchived)
  )
  if (files.length === 0) {
    void vscode.window.showInformationMessage('Reup found no files edited in your sessions yet.')
    return
  }

  const selectedFile = await pickFile(files)
  if (!selectedFile) return

  const matches = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: 'Reup: finding sessions' },
    () => dataSource.searchTouchedSessions(selectedFile.path, includeArchived)
  )
  if (matches.length === 0) {
    void vscode.window.showInformationMessage('No sessions touched that file.')
    return
  }

  await pickSession(matches, selectedFile, logger, resumeService, onOpenInspector)
}

/**
 * Shows a picker of the *other* sessions that edited a file and returns the
 * chosen one. Shared by the inspector and dashboard "↳ N other sessions" links.
 */
export async function pickTouchedSession(
  dataSource: ReupDataSource,
  currentSessionId: string,
  filePath: string
): Promise<ExtensionSession | undefined> {
  const includeArchived = getReupConfigurationValue<boolean>('includeArchived', false)
  const matches = await dataSource.searchTouchedSessions(filePath, includeArchived)
  const others = matches.filter((match) => match.session.id !== currentSessionId)
  if (others.length === 0) {
    void vscode.window.showInformationMessage('No other sessions touched this file.')
    return undefined
  }
  const fileName = filePath.split(/[/\\]/).filter(Boolean).pop() ?? filePath
  const selected = await vscode.window.showQuickPick(others.map(touchedSessionPick), {
    matchOnDescription: true,
    placeHolder: `Sessions that edited ${fileName}`,
    title: 'Reup: Touched By',
  })
  return selected?.session
}

function touchedSessionPick(match: ExtensionTouchedMatch): vscode.QuickPickItem & {
  session: ExtensionSession
} {
  const edits = `${match.matchCount} edit${match.matchCount === 1 ? '' : 's'}`
  return {
    description: `${match.session.projectName} · ${formatRelativeTime(match.lastTouchedAt ?? match.session.updated)}`,
    detail: [match.gitBranch ?? match.session.branch, edits].filter(Boolean).join(' · '),
    label: `${statusCodicon(match.session.primaryStatus, match.session.liveState)} ${match.session.title}`,
    session: match.session,
  }
}

function pickFile(files: ExtensionTouchedFile[]): Promise<ExtensionTouchedFile | undefined> {
  return new Promise((resolve) => {
    const picker = vscode.window.createQuickPick<FileItem>()
    picker.title = 'Reup: Touched Files'
    picker.placeholder = 'Pick a file to see which sessions edited it'
    picker.matchOnDescription = true
    picker.matchOnDetail = true
    picker.items = files.map(fileItem)

    let accepted: ExtensionTouchedFile | undefined
    picker.onDidAccept(() => {
      accepted = picker.selectedItems[0]?.file
      picker.hide()
    })
    picker.onDidHide(() => {
      picker.dispose()
      resolve(accepted)
    })
    picker.show()
  })
}

function pickSession(
  matches: ExtensionTouchedMatch[],
  file: ExtensionTouchedFile,
  logger: ReupLogger,
  resumeService: SessionResumeService,
  onOpenInspector: (session: ExtensionSession) => Promise<void>
): Promise<void> {
  return new Promise((resolve) => {
    const picker = vscode.window.createQuickPick<SessionItem>()
    picker.title = `Reup: Sessions that edited ${baseName(file.path)}`
    picker.placeholder = 'Resume or inspect a session that edited this file'
    picker.items = matches.map(sessionItem)

    let finished = false
    const finish = (): void => {
      if (finished) return
      finished = true
      picker.dispose()
      resolve()
    }

    picker.onDidAccept(() => {
      const selected = picker.selectedItems[0]
      if (selected) void onOpenInspector(selected.session).finally(finish)
      else finish()
    })
    picker.onDidTriggerItemButton((event) => {
      if (event.button === RESUME_BUTTON) {
        const session = event.item.session
        finish()
        void resumeService
          .resume(session)
          .catch((error) =>
            vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error))
          )
      } else if (event.button === COPY_BUTTON) {
        void copySessionHandoff(event.item.session, logger)
          .then(() => vscode.window.showInformationMessage('Reup handoff packet copied.'))
          .catch((error) =>
            vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error))
          )
      }
    })
    picker.onDidHide(finish)
    picker.show()
  })
}

function fileItem(file: ExtensionTouchedFile): FileItem {
  const sessions = `${file.sessionCount} session${file.sessionCount === 1 ? '' : 's'}`
  return {
    label: `$(file) ${baseName(file.path)}`,
    description: [sessions, formatRelativeTime(file.lastTouchedAt), file.gitBranch ?? undefined]
      .filter(Boolean)
      .join(' · '),
    detail: file.path,
    file,
  }
}

function sessionItem(match: ExtensionTouchedMatch): SessionItem {
  const { session } = match
  const edits = `${match.matchCount} edit${match.matchCount === 1 ? '' : 's'}`
  return {
    buttons: [RESUME_BUTTON, COPY_BUTTON],
    description: `${session.projectName} · ${formatRelativeTime(match.lastTouchedAt ?? session.updated)}`,
    detail: [match.gitBranch ?? session.branch ?? session.currentBranch, edits]
      .filter(Boolean)
      .join(' · '),
    label: `${statusCodicon(session.primaryStatus, session.liveState)} ${session.title}`,
    session,
  }
}

function baseName(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).pop() ?? path
}
