import { getActiveSessions } from '../core/session/active-sessions.js'
import { findCleanupCandidates, summariseCandidates } from '../core/session/cleanup.js'
import { loadProjects } from '../core/project/project-discovery.js'
import { setSessionArchived } from '../core/session/session-metadata.js'
import { releaseTerminalInput } from '../tui/terminal-input.js'
import { writeOutput } from './output.js'

const CLEANUP_HELP = `
reup cleanup — review and archive stale sessions

  Identifies candidates using built-in rules (safe mode — no AI required):
    empty      0 messages — session was never used
    trivial    ≤2 messages
    orphaned   project path no longer exists on disk
    expired    >30 days old — Claude cannot resume these
    stale      inactive >90 days and short (≤10 messages)

  Presents an interactive picker; nothing is archived without your confirmation.

Usage:
  reup cleanup            Interactive picker
  reup cleanup --dry-run  Preview candidates without archiving
`.trim()

export async function runCleanupCommand(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    writeOutput(CLEANUP_HELP)
    return
  }

  const dryRun = args.includes('--dry-run')

  const [projects, activeSessionIds] = await Promise.all([loadProjects(), getActiveSessions()])
  const candidates = findCleanupCandidates(projects, activeSessionIds)

  if (candidates.length === 0) {
    writeOutput('No cleanup candidates found. Everything looks tidy.')
    return
  }

  if (dryRun) {
    writeOutput(formatDryRun(candidates))
    return
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    writeOutput(summariseCandidates(candidates))
    writeOutput('Run `reup cleanup` in an interactive terminal to review and archive.')
    return
  }

  const { runCleanupPicker } = await import('../tui/CleanupPicker.js')
  const chosen = await runCleanupPicker(candidates)
  releaseTerminalInput()

  if (!chosen || chosen.length === 0) {
    writeOutput('No sessions archived.')
    return
  }

  await Promise.all(chosen.map((c) => setSessionArchived(c.projectId, c.session.id, true)))
  writeOutput(`Archived ${chosen.length} session${chosen.length === 1 ? '' : 's'}.`)
}

function formatDryRun(candidates: ReturnType<typeof findCleanupCandidates>): string {
  const lines = [
    `${candidates.length} cleanup candidate${candidates.length === 1 ? '' : 's'} (dry run — nothing archived):`,
    '',
  ]
  for (const c of candidates) {
    const label = c.session.alias ?? c.session.name
    const shortId = c.session.id.slice(0, 8)
    const reasons = c.reasons.join(', ')
    lines.push(`  ${label}  ${shortId}  [${reasons}]`)
    lines.push(`  ${c.projectPath}`)
    lines.push('')
  }
  lines.push('Run `reup cleanup` to review interactively.')
  return lines.join('\n').trimEnd()
}
