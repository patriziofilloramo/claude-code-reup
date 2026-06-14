import { buildDiagnosticsReport } from '../core/diagnostics.js'
import type { DiagnosticsReport } from '../core/diagnostics.js'
import { writeOutput } from './output.js'

/** Prints non-destructive health checks for Claude Code's local session data. */
export async function runDoctor(): Promise<void> {
  writeOutput(formatDoctorReport(await buildDiagnosticsReport()))
}

export function formatDoctorReport(report: DiagnosticsReport): string {
  const issueCount =
    report.brokenIndices.length +
    report.orphanedTranscripts.length +
    report.pathMissing.length +
    report.staleLocks.length

  if (issueCount === 0) return 'CCM Doctor\n\nNo issues found.'

  const lines = [`CCM Doctor · ${issueCount} issue${issueCount === 1 ? '' : 's'}`]
  appendSection(
    lines,
    'Broken session indices',
    report.brokenIndices.map((item) => `${item.projectId}: ${item.reason}`),
    'Claude Code owns these files; CCM falls back to readable transcripts.'
  )
  appendSection(
    lines,
    'Stale sidecar locks',
    report.staleLocks.map((item) => `${item.path}: ${item.reason}`),
    'No live owner was detected; CCM can recover abandoned locks on its next metadata write.'
  )
  appendSection(
    lines,
    'Orphaned transcripts',
    report.orphanedTranscripts.map((item) => `${item.projectId}: ${item.sessionId}`),
    'The transcript exists but is absent from its project index.'
  )
  appendSection(
    lines,
    'Missing session paths',
    report.pathMissing.map((item) => `${item.id.slice(0, 8)}: ${item.projectPath}`),
    'The recorded working directory no longer exists.'
  )
  return lines.join('\n')
}

function appendSection(lines: string[], title: string, items: string[], explanation: string): void {
  if (items.length === 0) return
  lines.push('', `${title} (${items.length})`, `  ${explanation}`)
  for (const item of items) lines.push(`  - ${item}`)
}
