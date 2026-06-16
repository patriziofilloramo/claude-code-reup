import * as vscode from 'vscode'

import { loadProjects } from '../../src/core/project/project-discovery.js'
import {
  formatHandoff,
  readTranscriptHandoffContext,
} from '../../src/core/session/session-handoff.js'
import { sessionTranscriptPath } from '../../src/core/session/session-preview.js'
import type { SwoopLogger } from './logger.js'
import type { ExtensionSession } from './swoop-data.js'

/**
 * Builds the same compact Markdown packet used by the CLI/web/TUI and copies it
 * to the editor clipboard. This is intentionally read-only: it never modifies
 * Claude transcripts or Swoop metadata.
 */
export async function copySessionHandoff(
  session: ExtensionSession,
  logger: SwoopLogger
): Promise<void> {
  const coreSession = await findCoreSession(session.projectId, session.id)
  if (!coreSession) {
    throw new Error('Claude Code session was not found locally.')
  }

  const context = await readTranscriptHandoffContext(
    sessionTranscriptPath(session.projectId, session.id)
  )
  const handoff = formatHandoff(coreSession, context)
  await vscode.env.clipboard.writeText(handoff)
  logger.info('copied handoff packet from VS Code', session.id)
}

async function findCoreSession(projectId: string, sessionId: string) {
  const projects = await loadProjects()
  return projects
    .find((project) => project.id === projectId)
    ?.sessions.find((s) => s.id === sessionId)
}
