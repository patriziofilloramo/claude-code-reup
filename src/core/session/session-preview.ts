import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { getProjectDirectory } from '../project/claude-paths.js'
import {
  extractAutomaticSessionContext,
  type AutomaticSessionContext,
} from './session-automatic-context.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionPreview {
  /** Structured facts Claude Code already recorded; read-only and best-effort. */
  automaticContext: AutomaticSessionContext
  /** Last human turn text, stripped of injection markers, max 240 chars. */
  goal: string | null
  /** Last assistant text, max 400 chars. */
  lastResponse: string | null
  /** Name of the last unresolved tool call when the session is interrupted. */
  pendingToolName: string | null
  /** Absolute paths written/edited during this session, most-recent first, max 8. */
  touchedFiles: string[]
}

// ---------------------------------------------------------------------------
// Path helper
// ---------------------------------------------------------------------------

/** Returns the absolute path to a session's JSONL transcript file. */
export function sessionTranscriptPath(projectId: string, sessionId: string): string {
  return join(getProjectDirectory(projectId), `${sessionId}.jsonl`)
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/**
 * Reads a transcript file and extracts Resume Card content.
 * All fields degrade gracefully to null / empty when content is unavailable.
 */
export async function loadSessionPreview(transcriptPath: string): Promise<SessionPreview> {
  try {
    const raw = await readFile(transcriptPath, 'utf8')
    return extractSessionPreview(raw.trim().split('\n').filter(Boolean))
  } catch {
    return emptyPreview()
  }
}

// ---------------------------------------------------------------------------
// Extraction  (pure — testable without filesystem)
// ---------------------------------------------------------------------------

const GOAL_MAX_CHARS = 240
const RESPONSE_MAX_CHARS = 400
const MAX_TOUCHED_FILES = 8

/**
 * Derives Resume Card content from JSONL transcript lines in a single
 * forward pass. Each field captures the *last* relevant occurrence.
 */
export function extractSessionPreview(lines: string[]): SessionPreview {
  let goal: string | null = null
  let lastResponse: string | null = null
  const pendingTools = new Map<string, string>() // tool_use_id → tool name
  const touchedSequence: string[] = [] // ordered by occurrence

  for (const line of lines) {
    const event = parseEvent(line)
    if (!event) continue

    if (event['type'] === 'user') {
      const content = messageContent(event)
      if (containsOnlyToolResults(content)) {
        resolveToolResults(content, pendingTools)
      } else {
        const text = extractText(content)
        if (text && !isContextUsageReport(content)) {
          goal = smartTruncate(text, GOAL_MAX_CHARS)
        }
      }
      continue
    }

    if (event['type'] === 'assistant') {
      const content = messageContent(event)
      const text = extractStructuredText(content)
      if (text) lastResponse = smartTruncate(text, RESPONSE_MAX_CHARS)
      collectToolCalls(content, pendingTools, touchedSequence)
    }
  }

  return {
    automaticContext: extractAutomaticSessionContext(lines),
    goal,
    lastResponse,
    pendingToolName: lastValue(pendingTools),
    touchedFiles: deduplicateTail(touchedSequence, MAX_TOUCHED_FILES),
  }
}

// ---------------------------------------------------------------------------
// Transcript parsing helpers
// ---------------------------------------------------------------------------

function parseEvent(line: string): Record<string, unknown> | null {
  try {
    return JSON.parse(line) as Record<string, unknown>
  } catch {
    return null
  }
}

function messageContent(event: Record<string, unknown>): unknown {
  return (event['message'] as Record<string, unknown> | undefined)?.['content']
}

function containsOnlyToolResults(content: unknown): boolean {
  return (
    Array.isArray(content) &&
    content.length > 0 &&
    (content as Record<string, unknown>[]).every((b) => b['type'] === 'tool_result')
  )
}

function resolveToolResults(content: unknown, pendingTools: Map<string, string>): void {
  if (!Array.isArray(content)) return
  for (const block of content as Record<string, unknown>[]) {
    if (typeof block['tool_use_id'] === 'string') pendingTools.delete(block['tool_use_id'])
  }
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return cleanText(content)
  if (!Array.isArray(content)) return ''
  return cleanText(
    (content as Record<string, unknown>[])
      .filter((b) => b['type'] === 'text' && typeof b['text'] === 'string')
      .map((b) => b['text'] as string)
      .join('\n')
  )
}

function cleanText(text: string): string {
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanStructuredText(text: string): string {
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function extractStructuredText(content: unknown): string {
  if (typeof content === 'string') return cleanStructuredText(content)
  if (!Array.isArray(content)) return ''
  return cleanStructuredText(
    (content as Record<string, unknown>[])
      .filter((b) => b['type'] === 'text' && typeof b['text'] === 'string')
      .map((b) => b['text'] as string)
      .join('\n')
  )
}

function isContextUsageReport(content: unknown): boolean {
  const text = extractText(content).trimStart()
  return text.startsWith('## Context Usage') && text.includes('**Model:**')
}

function collectToolCalls(
  content: unknown,
  pendingTools: Map<string, string>,
  touchedSequence: string[]
): void {
  if (!Array.isArray(content)) return
  for (const block of content as Record<string, unknown>[]) {
    if (block['type'] !== 'tool_use') continue

    const id = block['id']
    const name = block['name']
    const input = block['input'] as Record<string, unknown> | undefined

    if (typeof id === 'string' && typeof name === 'string') pendingTools.set(id, name)

    if (typeof name !== 'string' || !input) continue

    const lowerName = name.toLowerCase()
    if (!lowerName.includes('edit') && !lowerName.includes('write')) continue

    const rawPath = input['file_path'] ?? input['path'] ?? input['notebook_path']
    if (typeof rawPath === 'string' && rawPath) touchedSequence.push(rawPath)
  }
}

// ---------------------------------------------------------------------------
// Collection helpers
// ---------------------------------------------------------------------------

function lastValue(map: Map<string, string>): string | null {
  if (map.size === 0) return null
  let last: string | undefined
  for (const v of map.values()) last = v
  return last ?? null
}

/**
 * Returns up to `max` unique items, keeping the *last* occurrence of each
 * (most-recently-touched files appear first in the result).
 */
function deduplicateTail(items: string[], max: number): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (let i = items.length - 1; i >= 0 && result.length < max; i--) {
    const item = items[i]
    if (item && !seen.has(item)) {
      seen.add(item)
      result.push(item)
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// Text quality
// ---------------------------------------------------------------------------

/**
 * Truncates at a sentence boundary near the limit when possible,
 * falling back to a hard cut with an ellipsis.
 */
function smartTruncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const window = text.slice(0, maxChars)
  const sentenceEnd = Math.max(
    window.lastIndexOf('. '),
    window.lastIndexOf('! '),
    window.lastIndexOf('? '),
    window.lastIndexOf('.\n')
  )
  if (sentenceEnd >= maxChars * 0.55) return window.slice(0, sentenceEnd + 1).trimEnd()
  return window.trimEnd() + '…'
}

function emptyPreview(): SessionPreview {
  return {
    automaticContext: extractAutomaticSessionContext([]),
    goal: null,
    lastResponse: null,
    pendingToolName: null,
    touchedFiles: [],
  }
}
