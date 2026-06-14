import { readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'

import { APP } from '../config/app.js'
import type { Session, SessionContextMetrics } from './session-model.js'
import { computeSignalsFromLines } from './session-signals.js'

interface CollectedTranscriptMetadata {
  aiGeneratedTitle: string
  context: SessionContextMetrics
  createdAt?: string
  customTitle: string
  firstHumanMessage: string
  gitBranch?: string
  messageCount: number
  projectPath?: string
  summary: string
  updatedAt?: string
}

// -----------------------------------------------------------------------------
// Transcript loading
// -----------------------------------------------------------------------------

/**
 * Extracts session metadata from a transcript without altering Claude-owned data.
 *
 * Title priority: custom title, AI title, summary, first human message, fallback.
 */
export async function parseSessionTranscript(
  transcriptPath: string,
  fallbackProjectPath: string
): Promise<Session | null> {
  try {
    const transcriptStats = await stat(transcriptPath)
    if (transcriptStats.size === 0) return null

    const lines = (await readFile(transcriptPath, 'utf8')).trim().split('\n').filter(Boolean)
    if (lines.length === 0) return null

    const metadata = collectTranscriptMetadata(lines)
    // Claude can leave metadata-only remnants after deleting a session. They
    // have titles or agent names but no conversation and cannot be resumed.
    if (metadata.messageCount === 0) return null

    const createdAt = metadata.createdAt ?? transcriptStats.birthtime.toISOString()
    const updatedAt = metadata.updatedAt ?? transcriptStats.mtime.toISOString()

    return {
      context: metadata.context,
      created: createdAt,
      gitBranch: metadata.gitBranch,
      id: basename(transcriptPath, '.jsonl'),
      messageCount: metadata.messageCount,
      name:
        metadata.customTitle ||
        metadata.aiGeneratedTitle ||
        metadata.summary ||
        metadata.firstHumanMessage ||
        'Untitled session',
      projectPath: metadata.projectPath ?? fallbackProjectPath,
      signals: {
        analysisComplete: true,
        archived: false,
        ...computeSignalsFromLines(lines, updatedAt),
        pathExists: true,
      },
      updated: updatedAt,
    }
  } catch {
    return null
  }
}

// -----------------------------------------------------------------------------
// Event collection
// -----------------------------------------------------------------------------

function collectTranscriptMetadata(lines: string[]): CollectedTranscriptMetadata {
  const metadata: CollectedTranscriptMetadata = {
    aiGeneratedTitle: '',
    context: {
      latestContextTokens: null,
      latestModel: null,
      latestOutputTokens: null,
      models: [],
    },
    customTitle: '',
    firstHumanMessage: '',
    messageCount: 0,
    summary: '',
  }

  for (const line of lines) {
    const event = parseTranscriptEvent(line)
    if (!event) continue

    collectTitleCandidates(metadata, event)
    collectResumeContext(metadata, event)
    collectTranscriptTimestamps(metadata, event)
    collectConversationMetadata(metadata, event)
  }

  return metadata
}

function parseTranscriptEvent(line: string): Record<string, unknown> | null {
  try {
    return JSON.parse(line) as Record<string, unknown>
  } catch {
    return null
  }
}

function collectTitleCandidates(
  metadata: CollectedTranscriptMetadata,
  event: Record<string, unknown>
): void {
  if (event['type'] === 'custom-title' && typeof event['customTitle'] === 'string') {
    metadata.customTitle = event['customTitle']
    return
  }
  if (event['type'] === 'ai-title' && typeof event['aiTitle'] === 'string') {
    metadata.aiGeneratedTitle = event['aiTitle']
    return
  }
  if (!metadata.summary && event['type'] === 'summary' && typeof event['summary'] === 'string') {
    metadata.summary = event['summary']
  }
}

function collectResumeContext(
  metadata: CollectedTranscriptMetadata,
  event: Record<string, unknown>
): void {
  if (!metadata.gitBranch && typeof event['gitBranch'] === 'string' && event['gitBranch']) {
    metadata.gitBranch = event['gitBranch']
  }
  if (!metadata.projectPath && typeof event['cwd'] === 'string' && event['cwd']) {
    metadata.projectPath = event['cwd']
  }
}

function collectTranscriptTimestamps(
  metadata: CollectedTranscriptMetadata,
  event: Record<string, unknown>
): void {
  if (typeof event['timestamp'] !== 'string') return
  metadata.createdAt ??= event['timestamp']
  metadata.updatedAt = event['timestamp']
}

function collectConversationMetadata(
  metadata: CollectedTranscriptMetadata,
  event: Record<string, unknown>
): void {
  if (event['type'] === 'assistant') {
    metadata.messageCount++
    collectAssistantContextMetrics(metadata.context, event)
    return
  }
  if (event['type'] !== 'user') return

  const messageContent = messageContentFromEvent(event)
  if (!containsOnlyToolResults(messageContent)) metadata.messageCount++
  if (!metadata.firstHumanMessage && !isContextUsageReport(messageContent)) {
    metadata.firstHumanMessage = firstTextBlockContent(messageContent)
      .slice(0, APP.titleMaxChars)
      .trim()
  }
}

function collectAssistantContextMetrics(
  context: SessionContextMetrics,
  event: Record<string, unknown>
): void {
  const message = event['message'] as Record<string, unknown> | undefined
  if (!message) return

  const model = message['model']
  if (isPlaceholderModelId(model)) return
  if (isDisplayableModelId(model)) {
    context.latestModel = model
    if (context.models && !context.models.includes(model)) context.models.push(model)
  }

  const usage = message['usage'] as Record<string, unknown> | undefined
  if (!usage) return

  const contextTokenFields = [
    'input_tokens',
    'cache_creation_input_tokens',
    'cache_read_input_tokens',
  ]
  const contextTokenCounts = contextTokenFields
    .map((field) => usage[field])
    .filter(isNonNegativeNumber)
  const outputTokens = usage['output_tokens']
  if (contextTokenCounts.length === 0 && !isNonNegativeNumber(outputTokens)) return

  context.latestContextTokens =
    contextTokenCounts.length > 0
      ? contextTokenCounts.reduce((total, count) => total + count, 0)
      : null
  context.latestOutputTokens = isNonNegativeNumber(outputTokens) ? outputTokens : null
}

function isDisplayableModelId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isPlaceholderModelId(value: unknown): boolean {
  return typeof value === 'string' && /^<.*>$/.test(value)
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

// -----------------------------------------------------------------------------
// Message content helpers
// -----------------------------------------------------------------------------

function messageContentFromEvent(event: Record<string, unknown>): unknown {
  return (event['message'] as Record<string, unknown> | undefined)?.['content']
}

function containsOnlyToolResults(content: unknown): boolean {
  return (
    Array.isArray(content) &&
    (content as Record<string, unknown>[]).every((block) => block['type'] === 'tool_result')
  )
}

/** `/context` output is stored as a user event but is not a useful session title. */
function isContextUsageReport(content: unknown): boolean {
  const text = firstTextBlockContent(content).trimStart()
  return text.startsWith('## Context Usage') && text.includes('**Model:**')
}

function firstTextBlockContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  const textBlock = (content as Record<string, unknown>[]).find(
    (block) => block['type'] === 'text' && typeof block['text'] === 'string'
  )
  return typeof textBlock?.['text'] === 'string' ? textBlock['text'] : ''
}
