import { readFile } from 'node:fs/promises'

import type { Session } from './session-model.js'
import { primaryStatus } from './session-signals.js'

const MAX_CONTEXT_CHARACTERS = 1_200
const MAX_LIST_ITEMS = 40

export interface TranscriptHandoffContext {
  changedFiles: string[]
  goal?: string
  openTodos: string[]
  recentAssistantContext?: string
  summary?: string
}

/** Reads and analyses one Claude-owned transcript without modifying it. */
export async function readTranscriptHandoffContext(
  transcriptPath: string
): Promise<TranscriptHandoffContext> {
  const transcript = await readFile(transcriptPath, 'utf8')
  return analyzeTranscriptForHandoff(transcript.split('\n').filter(Boolean))
}

/** Extracts only facts that can be supported directly by transcript events. */
export function analyzeTranscriptForHandoff(lines: string[]): TranscriptHandoffContext {
  const changedFiles = new Set<string>()
  let goal: string | undefined
  let recentAssistantContext: string | undefined
  let summary: string | undefined
  let openTodos: string[] = []

  for (const line of lines) {
    const event = parseEvent(line)
    if (!event) continue

    if (event['type'] === 'summary' && typeof event['summary'] === 'string') {
      summary = compactText(event['summary'])
    }

    const message = event['message'] as Record<string, unknown> | undefined
    const content = message?.['content']
    if (event['type'] === 'user' && !containsOnlyToolResults(content)) {
      const userText = extractText(content)
      if (userText) goal = compactText(userText)
    }
    if (event['type'] === 'assistant') {
      const assistantText = extractText(content)
      if (assistantText) recentAssistantContext = compactText(assistantText)
      collectToolFacts(content, changedFiles, (todos) => {
        openTodos = todos
      })
    }
  }

  return {
    changedFiles: [...changedFiles],
    ...(goal ? { goal } : {}),
    openTodos,
    ...(recentAssistantContext ? { recentAssistantContext } : {}),
    ...(summary ? { summary } : {}),
  }
}

/** Formats a compact Markdown packet suitable for pasting into a continuation. */
export function formatHandoff(session: Session, context: TranscriptHandoffContext): string {
  const title = session.alias ?? session.name
  const lines = [
    `# Swoop Handoff: ${title}`,
    '',
    `- Session: \`${session.id}\``,
    `- Project: \`${session.projectPath}\``,
    `- Updated: ${session.updated}`,
    `- Status: ${primaryStatus(session.signals)}`,
  ]
  if (session.gitBranch) lines.push(`- Recorded branch: \`${session.gitBranch}\``)
  if (session.currentBranch) lines.push(`- Current branch: \`${session.currentBranch}\``)

  appendTextSection(lines, 'Goal', context.goal)
  appendTextSection(lines, 'Decisions and context', context.summary)
  appendTextSection(lines, 'Recent assistant context', context.recentAssistantContext)
  appendListSection(lines, 'Changed files detected in transcript', context.changedFiles)
  appendListSection(lines, 'Open todos detected in transcript', context.openTodos)
  lines.push('', '## Resume', '', `\`claude --resume ${session.id}\``)
  return lines.join('\n')
}

function collectToolFacts(
  content: unknown,
  changedFiles: Set<string>,
  replaceOpenTodos: (todos: string[]) => void
): void {
  if (!Array.isArray(content)) return

  for (const block of content as Record<string, unknown>[]) {
    if (block['type'] !== 'tool_use' || typeof block['name'] !== 'string') continue
    const toolName = block['name'].toLowerCase()
    const input = block['input'] as Record<string, unknown> | undefined
    if (!input) continue

    if (toolName.includes('edit') || toolName.includes('write')) {
      const filePath = input['file_path'] ?? input['path'] ?? input['notebook_path']
      if (typeof filePath === 'string' && filePath) changedFiles.add(filePath)
    }

    if (toolName === 'todowrite' && Array.isArray(input['todos'])) {
      replaceOpenTodos(
        (input['todos'] as Record<string, unknown>[])
          .filter((todo) => todo['status'] !== 'completed')
          .map((todo) => todo['content'])
          .filter((content): content is string => typeof content === 'string' && content.length > 0)
      )
    }
  }
}

function parseEvent(line: string): Record<string, unknown> | null {
  try {
    return JSON.parse(line) as Record<string, unknown>
  } catch {
    return null
  }
}

function containsOnlyToolResults(content: unknown): boolean {
  return (
    Array.isArray(content) &&
    content.length > 0 &&
    (content as Record<string, unknown>[]).every((block) => block['type'] === 'tool_result')
  )
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return normalizeText(content)
  if (!Array.isArray(content)) return ''

  return normalizeText(
    (content as Record<string, unknown>[])
      .filter((block) => block['type'] === 'text' && typeof block['text'] === 'string')
      .map((block) => block['text'])
      .join('\n')
  )
}

function normalizeText(text: string): string {
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function compactText(text: string): string {
  if (text.length <= MAX_CONTEXT_CHARACTERS) return text
  return `${text.slice(0, MAX_CONTEXT_CHARACTERS - 1).trimEnd()}…`
}

function appendTextSection(lines: string[], title: string, content: string | undefined): void {
  lines.push('', `## ${title}`, '', content || 'Not available in the transcript.')
}

function appendListSection(lines: string[], title: string, items: string[]): void {
  lines.push('', `## ${title}`, '')
  if (items.length === 0) {
    lines.push('None detected.')
    return
  }
  for (const item of items.slice(0, MAX_LIST_ITEMS)) lines.push(`- \`${item}\``)
  if (items.length > MAX_LIST_ITEMS) {
    lines.push(`- ${items.length - MAX_LIST_ITEMS} more omitted`)
  }
}
