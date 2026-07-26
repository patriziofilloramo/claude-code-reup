import { buildDiagnosticsReport } from '../core/health/diagnostics.js'
import type { DiagnosticsReport } from '../core/health/diagnostics.js'
import { writeOutput } from './output.js'
import { sanitizeTerminalField } from './terminal-text.js'

/** Prints non-destructive health checks for Claude Code's local session data. */
export async function runDoctor(): Promise<void> {
  writeOutput(formatDoctorReport(await buildDiagnosticsReport()))
}

export function formatDoctorReport(report: DiagnosticsReport): string {
  const sections = doctorSections(report).filter((section) => section.items.length > 0)
  const findingCount = sections.reduce((count, section) => count + section.items.length, 0)

  const lines = ['Reup Doctor', 'Local session-data health check']

  if (findingCount === 0) {
    lines.push('', 'OK  No issues found.')
    return lines.join('\n')
  }

  lines.push('', `${findingCount} finding${findingCount === 1 ? '' : 's'}`)
  for (const section of sections) appendSection(lines, section)
  return lines.join('\n')
}

interface DoctorSection {
  items: string[]
  nextStep: string
  title: string
  why: string
}

function doctorSections(report: DiagnosticsReport): DoctorSection[] {
  return [
    {
      title: 'Broken session indices',
      why: 'Claude Code owns these files. Reup falls back to readable transcripts.',
      nextStep: 'Leave them alone unless sessions are missing from Claude Code itself.',
      items: report.brokenIndices.map((item) =>
        formatItem(item.projectId, [item.reason, item.path])
      ),
    },
    {
      title: 'Stale sidecar locks',
      why: 'No live owner was detected for a Reup metadata lock.',
      nextStep: 'Reup can recover abandoned locks on its next metadata write.',
      items: report.staleLocks.map((item) => formatItem(item.projectId, [item.reason, item.path])),
    },
    {
      title: 'Legacy Project Memory artifacts',
      why: 'This release no longer manages Project Memory artifacts.',
      nextStep: 'Review these paths manually before deleting or moving anything.',
      items: report.legacyProjectMemoryArtifacts.map((item) =>
        formatItem(item.projectId, [item.kind.replaceAll('-', ' '), item.path])
      ),
    },
    {
      title: 'Orphaned transcripts',
      why: 'The transcript exists on disk but is absent from its project index.',
      nextStep: 'Keep it if you need the transcript; otherwise cleanup can archive stale sessions.',
      items: report.orphanedTranscripts.map((item) =>
        formatItem(item.sessionId.slice(0, 8), [item.projectPath, item.projectId])
      ),
    },
    {
      title: 'Missing session paths',
      why: 'The recorded working directory no longer exists.',
      nextStep:
        'Restore the path, archive the session, or use the transcript as read-only history.',
      items: report.pathMissing.map((item) =>
        formatItem(item.id.slice(0, 8), [item.alias ?? item.name, item.projectPath])
      ),
    },
    {
      title: 'Sessions nearing Claude cleanup',
      why: 'Claude Code may stop resuming these sessions when the cleanup window closes.',
      nextStep: 'Resume or hand off anything still important; archive the rest when ready.',
      items: report.expiring.map((item) =>
        formatItem(item.id.slice(0, 8), [
          item.alias ?? item.name,
          item.signals.expiresInDays === null
            ? 'expiry unknown'
            : `${item.signals.expiresInDays}d remaining`,
          item.projectPath,
        ])
      ),
    },
  ]
}

function appendSection(lines: string[], section: DoctorSection): void {
  lines.push('', `[!] ${section.title} (${section.items.length})`)
  lines.push(`    Why:  ${section.why}`)
  lines.push(`    Next: ${section.nextStep}`)
  lines.push('    Items:')
  for (const item of section.items) lines.push(item)
}

function formatItem(title: string, details: string[]): string {
  return [
    `      - ${sanitizeTerminalField(title)}`,
    ...details.map((detail) => `        ${sanitizeTerminalField(detail)}`),
  ].join('\n')
}
