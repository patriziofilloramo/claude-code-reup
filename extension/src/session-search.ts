import * as vscode from 'vscode'

import {
  parseSessionQuery,
  sessionMatchesParsedQuery,
} from '../../src/core/session/session-query.js'
import { formatRelativeTime, statusCodicon } from './formatting.js'
import { copySessionHandoff } from './handoff.js'
import { getReupConfigurationValue } from './configuration.js'
import type { ReupLogger } from './logger.js'
import type { SessionResumeService } from './resume-target.js'
import type { ExtensionContentMatch, ExtensionSession, ReupDataSource } from './reup-data.js'

interface SearchItem extends vscode.QuickPickItem {
  session: ExtensionSession
}

const DEEP_SEARCH_BUTTON: vscode.QuickInputButton = {
  iconPath: new vscode.ThemeIcon('search-fuzzy'),
  tooltip: 'Search transcripts',
}
const RESUME_BUTTON: vscode.QuickInputButton = {
  iconPath: new vscode.ThemeIcon('debug-start'),
  tooltip: 'Resume session',
}
const COPY_BUTTON: vscode.QuickInputButton = {
  iconPath: new vscode.ThemeIcon('clippy'),
  tooltip: 'Copy Handoff',
}

export async function showSessionSearch(
  dataSource: ReupDataSource,
  logger: ReupLogger,
  resumeService: SessionResumeService,
  onOpenInspector: (session: ExtensionSession) => Promise<void>
): Promise<void> {
  const includeArchived = getReupConfigurationValue<boolean>('includeArchived', false)
  const model = await dataSource.loadModel({
    includeArchived,
    includePreviewHints: false,
    workspacePath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
  })
  const picker = vscode.window.createQuickPick<SearchItem>()
  picker.title = 'Reup: Search Sessions'
  picker.placeholder = 'Search title, project, branch, tag, status or ID'
  picker.matchOnDescription = false
  picker.matchOnDetail = false
  picker.buttons = [DEEP_SEARCH_BUTTON]

  const updateMetadataResults = (query: string): void => {
    const parsed = parseSessionQuery(query)
    picker.items = model.sessions
      .filter((session) => matchesMetadata(session, parsed))
      .map(metadataItem)
  }
  updateMetadataResults('')

  await new Promise<void>((resolve) => {
    let finished = false
    const finish = (): void => {
      if (finished) return
      finished = true
      picker.dispose()
      resolve()
    }
    picker.onDidChangeValue((value) => updateMetadataResults(value))
    picker.onDidAccept(() => {
      const selected = picker.selectedItems[0]
      if (selected) void onOpenInspector(selected.session).finally(finish)
    })
    picker.onDidTriggerButton((button) => {
      if (button !== DEEP_SEARCH_BUTTON) return
      const query = picker.value.trim()
      if (query.length < 2) {
        void vscode.window.showInformationMessage(
          'Enter at least two characters before searching transcripts.'
        )
        return
      }
      picker.busy = true
      picker.enabled = false
      void Promise.resolve(
        vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Window,
            title: 'Reup: searching transcripts',
          },
          async (progress) => {
            let previous = 0
            const matches = await dataSource.searchTranscriptContent(
              query,
              includeArchived,
              (scanned, total) => {
                const percentage = total > 0 ? (scanned / total) * 100 : 100
                progress.report({
                  increment: percentage - previous,
                  message: `${scanned}/${total}`,
                })
                previous = percentage
              }
            )
            picker.items = matches.map(deepSearchItem)
            picker.title = `Reup: Transcript Results (${matches.length})`
          }
        )
      )
        .catch((error) => {
          logger.error('transcript search failed', error)
          void vscode.window.showErrorMessage(
            error instanceof Error ? error.message : 'Transcript search failed.'
          )
        })
        .finally(() => {
          picker.busy = false
          picker.enabled = true
        })
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

function matchesMetadata(
  session: ExtensionSession,
  query: ReturnType<typeof parseSessionQuery>
): boolean {
  return sessionMatchesParsedQuery(
    {
      active: session.isActive,
      archived: session.archived,
      branches: [session.branch ?? '', session.currentBranch ?? ''],
      project: [session.projectId, session.projectName, session.projectPath],
      status: session.primaryStatus,
      tags: session.tags,
      text: [session.id, session.title, ...session.tags],
    },
    query
  )
}

function metadataItem(session: ExtensionSession): SearchItem {
  return {
    buttons: [RESUME_BUTTON, COPY_BUTTON],
    description: `${session.projectName} · ${formatRelativeTime(session.updated)}`,
    detail: [
      session.branch ?? session.currentBranch,
      session.tags.map((tag) => `#${tag}`).join(' '),
    ]
      .filter(Boolean)
      .join(' · '),
    label: `${statusCodicon(session.primaryStatus, session.liveState)} ${session.title}`,
    session,
  }
}

function deepSearchItem(match: ExtensionContentMatch): SearchItem {
  return {
    ...metadataItem(match.session),
    description: `${match.matchCount} match${match.matchCount === 1 ? '' : 'es'} · ${match.session.projectName}`,
    detail: match.snippet,
  }
}
