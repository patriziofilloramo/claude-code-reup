import { isAbsolute, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import type { SessionStatus } from '../../src/core/session/session-model.js'
import type { SessionPreview } from '../../src/core/session/session-preview.js'
import { formatContextTokens, formatRelativeTime } from './formatting.js'
import type { ExtensionSession } from './swoop-data.js'

const MAX_TODOS_IN_DETAIL = 24

export function renderSessionDetailMarkdown(
  session: ExtensionSession,
  preview: SessionPreview
): string {
  const lines: string[] = [
    '# Swoop Resume Card',
    '',
    `**Session:** ${escapeMarkdown(session.title)}`,
    `**Project:** ${escapeMarkdown(session.projectName)}`,
    `**Updated:** ${formatRelativeTime(session.updated)}`,
    `**Status:** ${formatStatus(session.primaryStatus, session.isActive)}`,
    `**Messages:** ${session.messageCount}`,
  ]

  const context = formatContextTokens(session.contextTokens)
  if (context) lines.push(`**Context:** ${context}`)
  if (session.branch) lines.push(`**Recorded branch:** \`${escapeInlineCode(session.branch)}\``)
  if (session.currentBranch) {
    lines.push(`**Current branch:** \`${escapeInlineCode(session.currentBranch)}\``)
  }
  lines.push(`**Path:** \`${escapeInlineCode(session.projectPath)}\``)
  lines.push(`**ID:** \`${escapeInlineCode(session.id)}\``)

  appendTextSection(lines, 'What You Asked For', preview.goal)
  appendTextSection(lines, 'Where Claude Left Off', preview.lastResponse)
  appendTextSection(lines, 'Native Plan', preview.automaticContext.plan?.text ?? null)
  appendTodoSection(lines, preview)
  appendFileListSection(lines, 'Files Touched', preview.touchedFiles, session.projectPath)
  appendFileListSection(
    lines,
    'Files Read',
    preview.automaticContext.readFiles,
    session.projectPath
  )

  if (preview.pendingToolName) {
    appendListSection(lines, 'Pending Tool', [preview.pendingToolName])
  }

  lines.push('', '---', '')
  lines.push(
    'Read-only local view generated from Claude Code transcript artifacts. Swoop does not modify transcripts.'
  )

  return lines.join('\n')
}

function appendTextSection(lines: string[], title: string, text: string | null): void {
  lines.push('', `## ${title}`, '')
  if (!text) {
    lines.push('_No structured value found._')
    return
  }
  lines.push(text)
}

function appendTodoSection(lines: string[], preview: SessionPreview): void {
  const todos = preview.automaticContext.todos
  if (todos.items.length === 0) return

  const openTodos = todos.counts.pending + todos.counts.in_progress + todos.counts.unknown
  lines.push('', '## Native TODOs', '', `Open: ${openTodos} - Done: ${todos.counts.completed}`, '')

  for (const todo of todos.items.slice(0, MAX_TODOS_IN_DETAIL)) {
    const marker = todo.status === 'completed' ? 'x' : ' '
    const suffix = todo.status === 'in_progress' ? ' _(in progress)_' : ''
    lines.push(`- [${marker}] ${escapeMarkdown(todo.content)}${suffix}`)
  }

  const hiddenCount = todos.items.length - MAX_TODOS_IN_DETAIL
  if (hiddenCount > 0) lines.push(`- _${hiddenCount} more not shown_`)
}

function appendListSection(lines: string[], title: string, values: string[]): void {
  if (values.length === 0) return
  lines.push('', `## ${title}`, '')
  for (const value of values) lines.push(`- \`${escapeInlineCode(value)}\``)
}

function appendFileListSection(
  lines: string[],
  title: string,
  values: string[],
  projectPath: string
): void {
  if (values.length === 0) return
  lines.push('', `## ${title}`, '')
  for (const value of values) lines.push(`- ${formatFileLink(value, projectPath)}`)
}

function formatStatus(status: SessionStatus, isActive: boolean): string {
  return isActive ? `${status} - active` : status
}

function formatFileLink(value: string, projectPath: string): string {
  const absolutePath = isAbsolute(value) ? value : resolve(projectPath, value)
  return `[${escapeMarkdown(value)}](${pathToFileURL(absolutePath).href})`
}

function escapeInlineCode(value: string): string {
  return value.replace(/`/g, '\\`')
}

function escapeMarkdown(value: string): string {
  return value.replace(/([\\*_#[\]()])/g, '\\$1')
}
