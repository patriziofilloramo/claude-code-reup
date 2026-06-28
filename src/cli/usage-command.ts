import {
  clearUsageCaptureError,
  parseStatusLineUsage,
  readLiveUsageSummary,
  readRawCapture,
  recordUsageCaptureError,
  writeLiveUsageSnapshot,
  writeRawCapture,
} from '../core/usage/live-usage.js'
import type {
  LiveUsageSnapshot,
  LiveUsageSummary,
  UsageLimitWindow,
} from '../core/usage/live-usage.js'
import {
  isUsageStatusLineConfigured,
  removeUsageStatusLine,
  setupUsageStatusLine,
} from '../core/usage/usage-statusline-integration.js'
import { APP } from '../config/app.js'
import { relativeTime } from '../utils/time.js'
import { failCommand, writeOutput } from './output.js'

/** Runs usage status, setup, removal, or the internal status-line collector. */
export async function runUsageCommand(commandArguments: string[]): Promise<void> {
  const [action, ...actionArguments] = commandArguments

  switch (action) {
    case undefined:
      writeOutput(renderUsageSummary(await readLiveUsageSummary()))
      return
    case '--json':
      if (actionArguments.length > 0) return failUsage()
      console.log(JSON.stringify(await readLiveUsageSummary(), null, 2))
      return
    case 'setup':
      await setupUsage(actionArguments)
      return
    case 'remove':
      if (actionArguments.length > 0) return failUsage()
      await removeUsage()
      return
    case 'toggle':
      if (actionArguments.length > 0) return failUsage()
      await toggleUsage()
      return
    case 'capture':
      if (actionArguments.length > 0) return
      await captureUsageFromStatusLine()
      return
    case 'raw':
      if (actionArguments.length > 0) return failUsage()
      await printRawCapture()
      return
    default:
      failUsage()
  }
}

export function formatUsageSummary(summary: LiveUsageSummary): string {
  const snapshot = summary.snapshot
  const labels = [
    snapshot?.contextUsedPercentage !== undefined
      ? `context ${roundedPercentage(snapshot.contextUsedPercentage)}`
      : '',
    formatLimit('5h', summary.rateLimits.fiveHour),
    formatLimit('7d', summary.rateLimits.sevenDay),
    summary.usageCreditsEnabled ? 'usage credits on' : '',
    snapshot?.agentName ? `agent ${snapshot.agentName}` : '',
  ].filter(Boolean)

  return [
    `Claude usage: ${labels.join(' | ') || 'limits unavailable'}`,
    formatCaptureStatusText(summary),
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Rich ANSI panel renderer
// ---------------------------------------------------------------------------

// 24-bit RGB codes that match src/config/theme.ts exactly so the CLI output
// looks identical to the TUI in terminals that support true colour.
const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[38;2;34;211;238m', // theme accent   #22d3ee
  green: '\x1b[38;2;52;211;153m', // theme ok       #34d399
  yellow: '\x1b[38;2;251;191;36m', // theme warn     #fbbf24
  orange: '\x1b[38;2;251;146;60m', // theme orange   #fb923c
  red: '\x1b[38;2;248;113;113m', // theme danger   #f87171
  white: '\x1b[97m',
} as const

function ansi(code: string, text: string): string {
  return `${code}${text}${ANSI.reset}`
}

function progressBar(percent: number, width = 20): string {
  const filled = Math.min(width, Math.round((percent / 100) * width))
  const empty = width - filled
  return ansi(limitColor(percent), '█'.repeat(filled)) + ansi(ANSI.dim, '░'.repeat(empty))
}

function limitColor(percent: number): string {
  if (percent >= 100) return ANSI.red
  if (percent >= 90) return ANSI.orange
  if (percent >= 80) return ANSI.yellow
  return ANSI.cyan
}

/** Compact single-line metric: label + bar + percentage + optional reset note. */
function metricChip(label: string, percent: number, note = ''): string {
  const bar = progressBar(percent, 10)
  const pct = ansi(limitColor(percent), roundedPercentage(percent).padStart(4))
  const notePart = note ? ansi(ANSI.dim, ' ' + note) : ''
  return ansi(ANSI.dim, label) + ' ' + bar + pct + notePart
}

/** Compact ANSI summary shown by `reup usage` — matches the TUI/web inline style. */
export function renderUsageSummary(summary: LiveUsageSummary): string {
  const INDENT = '  '
  const { snapshot } = summary

  const title = ansi(ANSI.bold + ANSI.cyan, 'reup') + ansi(ANSI.dim, ' · usage')

  // Header line: title · optional agent · staleness note
  const agentPart = snapshot?.agentName ? ansi(ANSI.dim, '  / ' + snapshot.agentName) : ''
  const stalenessNote = formatCaptureStatusNote(summary)
  const creditsPart = summary.usageCreditsEnabled ? ansi(ANSI.green, '  credits on') : ''
  const header = INDENT + title + agentPart + creditsPart + stalenessNote

  // Metrics line: account-level windows only (ctx is per-session, not meaningful here)
  const chips: string[] = []
  if (summary.rateLimits.fiveHour) {
    const { usedPercentage, resetsAt } = summary.rateLimits.fiveHour
    const note = resetsAt ? 'reset ' + formatResetCountdown(resetsAt) : ''
    chips.push(metricChip('5h', usedPercentage, note))
  }
  if (summary.rateLimits.sevenDay) {
    const { usedPercentage, resetsAt } = summary.rateLimits.sevenDay
    const note = resetsAt ? 'reset ' + formatResetCountdown(resetsAt) : ''
    chips.push(metricChip('7d', usedPercentage, note))
  }

  if (chips.length === 0) {
    const unavailableMessage = summary.limitsIssue
      ? `account limits unavailable: ${summary.limitsIssue}`
      : 'account limits unavailable'
    return ['', header, INDENT + ansi(ANSI.dim, unavailableMessage), ''].join('\n')
  }

  const metricsLine = INDENT + chips.join('   ')
  return ['', header, metricsLine, ''].join('\n')
}

export function formatStatusLineUsage(snapshot: LiveUsageSnapshot): string {
  const labels = [
    snapshot.contextUsedPercentage !== undefined
      ? `ctx ${roundedPercentage(snapshot.contextUsedPercentage)}`
      : '',
    snapshot.rateLimits.fiveHour
      ? `5h ${roundedPercentage(snapshot.rateLimits.fiveHour.usedPercentage)}`
      : '',
    snapshot.rateLimits.sevenDay
      ? `7d ${roundedPercentage(snapshot.rateLimits.sevenDay.usedPercentage)}`
      : '',
  ].filter(Boolean)
  return labels.length > 0 ? `reup | ${labels.join(' | ')}` : 'reup | usage captured'
}

async function toggleUsage(): Promise<void> {
  if (await isUsageStatusLineConfigured()) {
    await removeUsage()
  } else {
    await setupUsage([])
  }
}

async function setupUsage(actionArguments: string[]): Promise<void> {
  if (actionArguments.some((argument) => argument !== '--replace') || actionArguments.length > 1) {
    failUsage()
    return
  }

  try {
    const result = await setupUsageStatusLine(actionArguments.includes('--replace'))
    if (!result.changed) {
      writeOutput('Usage capture is already configured.')
      return
    }
    const refreshMessage = `Reup refreshes account limits every ${APP.accountUsageRefreshMs / 1_000} seconds and uses Claude's status line for session details.`
    writeOutput(
      result.replacedExisting
        ? `Usage capture configured. The previous status line will be restored by \`reup usage remove\`. ${refreshMessage}`
        : `Usage capture configured. ${refreshMessage}`
    )
  } catch (error) {
    failCommand(error instanceof Error ? error.message : String(error))
  }
}

async function removeUsage(): Promise<void> {
  try {
    const result = await removeUsageStatusLine()
    if (!result.changed) {
      writeOutput('Usage capture is not configured.')
      return
    }
    writeOutput(
      result.restoredPrevious
        ? 'Usage capture removed and the previous status line restored.'
        : 'Usage capture removed.'
    )
  } catch (error) {
    failCommand(error instanceof Error ? error.message : String(error))
  }
}

async function captureUsageFromStatusLine(): Promise<void> {
  try {
    if (process.stdin.isTTY) return
    const input = await readStdin()
    // Save raw payload for diagnostics without making capture depend on it.
    await writeRawCapture(input).catch(() => {})
    const snapshot = parseStatusLineUsage(input)
    if (!snapshot)
      throw new Error('Claude Code status-line payload is invalid or missing a session ID')

    await writeLiveUsageSnapshot(snapshot)
    await clearUsageCaptureError()
    writeOutput(formatStatusLineUsage(snapshot))
  } catch (error) {
    // Never disrupt Claude Code, but keep the failure inspectable.
    await recordUsageCaptureError(error).catch(() => {})
    writeOutput('reup | usage capture failed')
  }
}

async function printRawCapture(): Promise<void> {
  const raw = await readRawCapture()
  if (!raw) {
    writeOutput(
      `No raw capture yet. Keep a Claude Code terminal open and wait up to ${APP.usageCaptureRefreshSeconds} s for the next scheduled capture.`
    )
    return
  }
  try {
    // Pretty-print so it's readable in the terminal.
    writeOutput(JSON.stringify(JSON.parse(raw), null, 2))
  } catch {
    writeOutput(raw)
  }
}

function formatLimit(label: string, limit: UsageLimitWindow | undefined): string {
  if (!limit) return ''
  const reset = limit.resetsAt ? `, resets ${formatResetCountdown(limit.resetsAt)}` : ''
  return `${label} ${roundedPercentage(limit.usedPercentage)}${reset}`
}

function formatResetCountdown(resetAt: string): string {
  const remainingMs = new Date(resetAt).getTime() - Date.now()
  if (remainingMs <= 0) return 'now'
  const totalMinutes = Math.ceil(remainingMs / 60_000)
  const days = Math.floor(totalMinutes / (24 * 60))
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) return `${days}d${hours > 0 ? ` ${hours}h` : ''}`
  if (hours > 0) return `${hours}h${minutes > 0 ? ` ${minutes}m` : ''}`
  return `${minutes}m`
}

function roundedPercentage(value: number): string {
  return `${Math.round(value)}%`
}

function formatCaptureStatusNote(summary: LiveUsageSummary): string {
  switch (summary.limitsStatus) {
    case 'fresh':
      return ansi(
        ANSI.dim,
        `  updated ${summary.limitsUpdatedAt ? relativeTime(summary.limitsUpdatedAt) : 'recently'}`
      )
    case 'stale':
      return ansi(
        ANSI.dim,
        `  updated ${summary.limitsUpdatedAt ? relativeTime(summary.limitsUpdatedAt) : 'unknown'}`
      )
    case 'unavailable':
      return ansi(ANSI.yellow, '  account limits unavailable')
    default:
      return ''
  }
}

function formatCaptureStatusText(summary: LiveUsageSummary): string {
  switch (summary.limitsStatus) {
    case 'fresh':
      return summary.limitsUpdatedAt
        ? `limits updated ${relativeTime(summary.limitsUpdatedAt)}`
        : 'limits updated'
    case 'stale':
      return summary.limitsUpdatedAt
        ? `updated ${relativeTime(summary.limitsUpdatedAt)}`
        : 'limits updating'
    case 'unavailable':
      return summary.limitsIssue
        ? `account limits unavailable: ${summary.limitsIssue}`
        : 'account limits unavailable'
  }
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let input = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => {
      input += chunk
    })
    process.stdin.on('end', () => resolve(input))
    process.stdin.on('error', reject)
  })
}

function failUsage(): void {
  failCommand('usage: reup usage [--json|toggle|setup [--replace]|remove]')
}
