import * as vscode from 'vscode'

import {
  loadSessionPreview,
  sessionTranscriptPath,
} from '../../src/core/session/session-preview.js'
import { formatRelativeTime, statusCodicon } from './formatting.js'
import type { SwoopLogger } from './logger.js'
import { renderSessionDetailMarkdown } from './session-detail-markdown.js'
import type { ExtensionSession, SwoopDataSource } from './swoop-data.js'

const DETAIL_SCHEME = 'swoop'

/**
 * Read-only Markdown provider for lightweight Resume Cards.
 *
 * The provider keeps the VS Code surface editor-native: no webview, no
 * transcript streaming, no writes. Documents are generated on demand from the
 * same preview extractor used by Swoop's TUI/web surfaces.
 */
export class SwoopSessionDetailProvider
  implements vscode.TextDocumentContentProvider, vscode.Disposable
{
  private readonly changedEmitter = new vscode.EventEmitter<vscode.Uri>()
  private readonly documentCloseListener: vscode.Disposable
  private readonly sessionsByUri = new Map<string, ExtensionSession>()

  readonly onDidChange = this.changedEmitter.event

  constructor(private readonly logger: SwoopLogger) {
    this.documentCloseListener = vscode.workspace.onDidCloseTextDocument((document) => {
      if (document.uri.scheme === DETAIL_SCHEME) this.sessionsByUri.delete(document.uri.toString())
    })
  }

  registerSession(session: ExtensionSession): vscode.Uri {
    const uri = vscode.Uri.from({
      path: `/session/${encodeURIComponent(session.projectId)}/${session.id}.md`,
      scheme: DETAIL_SCHEME,
    })
    this.sessionsByUri.set(uri.toString(), session)
    this.changedEmitter.fire(uri)
    return uri
  }

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const session = this.sessionsByUri.get(uri.toString())
    if (!session) return '# Swoop Resume Card\n\nSession details are no longer available.'

    try {
      const preview = await loadSessionPreview(sessionTranscriptPath(session.projectId, session.id))
      return renderSessionDetailMarkdown(session, preview)
    } catch (error) {
      this.logger.error('failed to render session detail', error)
      return [
        '# Swoop Resume Card',
        '',
        'Could not render this session detail.',
        '',
        `Session ID: \`${escapeInlineCode(session.id)}\``,
      ].join('\n')
    }
  }

  dispose(): void {
    this.documentCloseListener.dispose()
    this.changedEmitter.dispose()
    this.sessionsByUri.clear()
  }
}

export async function openSessionDetail(
  provider: SwoopSessionDetailProvider,
  session: ExtensionSession
): Promise<void> {
  const uri = provider.registerSession(session)
  const document = await vscode.workspace.openTextDocument(uri)
  await vscode.window.showTextDocument(document, {
    preview: true,
    viewColumn: vscode.ViewColumn.Active,
  })
}

export async function showSessionDetailPicker(
  provider: SwoopSessionDetailProvider,
  dataSource: SwoopDataSource,
  logger: SwoopLogger
): Promise<void> {
  try {
    const model = await dataSource.loadModel({
      includeArchived: vscode.workspace
        .getConfiguration('swoop')
        .get<boolean>('includeArchived', false),
      includePreviewHints: true,
      workspacePath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    })
    if (model.sessions.length === 0) {
      void vscode.window.showInformationMessage('No Swoop sessions found.')
      return
    }

    const selected = await vscode.window.showQuickPick(
      model.sessions.map((session) => ({
        description: `${session.projectName} - ${formatRelativeTime(session.updated)}`,
        detail: [session.branch, session.todoSummary ? `todos ${session.todoSummary}` : null]
          .filter(Boolean)
          .join(' - '),
        label: `${statusCodicon(session.primaryStatus, session.isActive)} ${session.title}`,
        session,
      })),
      {
        matchOnDescription: true,
        matchOnDetail: true,
        placeHolder: 'Open a read-only Swoop Resume Card',
        title: 'Swoop: Open Resume Card',
      }
    )
    if (!selected) return

    await openSessionDetail(provider, selected.session)
  } catch (error) {
    logger.error('session detail picker failed', error)
    void vscode.window.showErrorMessage(
      error instanceof Error ? error.message : 'Could not open Swoop Resume Card.'
    )
  }
}

function escapeInlineCode(value: string): string {
  return value.replace(/`/g, '\\`')
}
