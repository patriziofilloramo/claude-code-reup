import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { join } from 'node:path'

import { getProjectDirectory } from './claude-paths.js'
import type { Project, Session } from './session-model.js'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ContentMatch {
  project: Project
  session: Session
  matchCount: number
  snippet: string
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Scans every session transcript in the given projects for the query string.
 * Streams each JSONL file line-by-line — never loads a full file into memory.
 * Results are sorted by match count descending.
 */
export async function searchTranscripts(
  query: string,
  projects: Project[],
  onProgress?: (scanned: number, total: number) => void
): Promise<ContentMatch[]> {
  const lowerQuery = query.toLowerCase()
  const results: ContentMatch[] = []

  const pairs: Array<{ project: Project; session: Session }> = []
  for (const project of projects) {
    for (const session of project.sessions) {
      pairs.push({ project, session })
    }
  }

  const total = pairs.length
  let scanned = 0

  for (const { project, session } of pairs) {
    const transcriptPath = join(getProjectDirectory(project.id), `${session.id}.jsonl`)
    const match = await scanFile(transcriptPath, lowerQuery)
    scanned++
    onProgress?.(scanned, total)
    if (match.matchCount > 0) results.push({ project, session, ...match })
  }

  return results.sort((a, b) => b.matchCount - a.matchCount)
}

// ---------------------------------------------------------------------------
// File scanning
// ---------------------------------------------------------------------------

async function scanFile(
  filePath: string,
  lowerQuery: string
): Promise<{ matchCount: number; snippet: string }> {
  let matchCount = 0
  let snippet = ''

  try {
    const rl = createInterface({
      input: createReadStream(filePath, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    })

    for await (const line of rl) {
      // Cheap pre-filter: skip lines that can't possibly match
      if (!line.toLowerCase().includes(lowerQuery)) continue

      const text = extractMessageText(line)
      if (!text || !text.toLowerCase().includes(lowerQuery)) continue

      matchCount++
      if (!snippet) snippet = makeSnippet(text, lowerQuery)
    }
  } catch {
    // Unreadable or missing transcript — treat as zero matches
  }

  return { matchCount, snippet }
}

function extractMessageText(line: string): string | null {
  try {
    const event = JSON.parse(line) as Record<string, unknown>
    if (event['type'] !== 'user' && event['type'] !== 'assistant') return null
    const content = (event['message'] as Record<string, unknown> | undefined)?.['content']
    return extractText(content) || null
  } catch {
    return null
  }
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return (content as Record<string, unknown>[])
    .filter((b) => b['type'] === 'text' && typeof b['text'] === 'string')
    .map((b) => b['text'] as string)
    .join('\n')
}

function makeSnippet(text: string, lowerQuery: string, contextChars = 60): string {
  const idx = text.toLowerCase().indexOf(lowerQuery)
  if (idx === -1) return ''
  const start = Math.max(0, idx - contextChars)
  const end = Math.min(text.length, idx + lowerQuery.length + contextChars)
  const raw = text.slice(start, end).replace(/\s+/g, ' ').trim()
  return (start > 0 ? '…' : '') + raw + (end < text.length ? '…' : '')
}
