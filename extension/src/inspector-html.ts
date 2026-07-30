import { randomBytes } from 'node:crypto'

import type { SessionPreview } from '../../src/core/session/session-preview.js'
import { formatContextTokens, formatRelativeTime, statusLabel } from './formatting.js'
import type { ExtensionSession } from './reup-data.js'

export type InspectorMessage =
  | { type: 'archive' }
  | { type: 'copyHandoff' }
  | { type: 'editAlias' }
  | { type: 'editTags' }
  | { path: string; type: 'openFile' }
  | { path: string; type: 'touchedSessions' }
  | { type: 'resume' }
  | { type: 'revealProject' }

/** Count of *other* sessions that edited each touched file, keyed by raw path. */
export type TouchedOverlap = Record<string, number>

export function renderInspectorHtml(
  session: ExtensionSession,
  preview: SessionPreview,
  touchedOverlap: TouchedOverlap = {}
): string {
  const nonce = randomBytes(18).toString('base64')
  const resumeDisabled =
    session.advice.code === 'path-missing' || session.advice.code === 'already-active'
  const healthStatus = statusLabel(session.primaryStatus)

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style nonce="${nonce}">
    :root { color-scheme: light dark; }
    body { color: var(--vscode-foreground); background: var(--vscode-sideBar-background); font-family: var(--vscode-font-family); padding: 0 12px 24px; line-height: 1.45; }
    h1 { font-size: 1.2rem; margin: 14px 0 8px; }
    h2 { font-size: 1.05rem; margin: 18px 0 6px; }
    p { margin: 6px 0; }
    .advice { border-left: 3px solid var(--vscode-focusBorder); background: var(--vscode-textBlockQuote-background); padding: 10px; margin: 8px 0 12px; }
    .advice.warning { border-color: var(--vscode-editorWarning-foreground); }
    .advice.blocked { border-color: var(--vscode-editorError-foreground); }
    .advice-title { font-weight: 700; }
    .actions { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 14px; }
    button { color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 0; padding: 5px 9px; cursor: pointer; }
    button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
    button:disabled { opacity: .5; cursor: default; }
    .facts { display: grid; grid-template-columns: max-content 1fr; gap: 3px 9px; font-size: .92em; }
    .label { color: var(--vscode-descriptionForeground); }
    .pills { display: flex; flex-wrap: wrap; gap: 5px; margin: 8px 0; }
    .pill { border: 1px solid var(--vscode-widget-border); border-radius: 10px; padding: 1px 7px; font-size: .85em; }
    .pill-active { color: var(--vscode-testing-iconPassed); border-color: var(--vscode-testing-iconPassed); }
    /* Attached but quiet: the live colour held back, as in the TUI and the web. */
    .pill-attached { color: var(--vscode-testing-iconPassed); border-color: var(--vscode-testing-iconPassed); opacity: 0.6; }
    .pill-warning { color: var(--vscode-editorWarning-foreground); border-color: var(--vscode-editorWarning-foreground); }
    .pill-error { color: var(--vscode-editorError-foreground); border-color: var(--vscode-editorError-foreground); }
    .pill-muted { color: var(--vscode-descriptionForeground); }
    .tag { color: var(--vscode-textLink-foreground); border-color: var(--vscode-textLink-foreground); background: var(--vscode-textBlockQuote-background); font-weight: 600; }
    .muted { color: var(--vscode-descriptionForeground); }
    .markdown { overflow-wrap: anywhere; }
    .markdown h3, .markdown h4 { margin: 12px 0 5px; }
    .markdown p { margin: 5px 0 9px; }
    .markdown pre { overflow-x: auto; padding: 8px; background: var(--vscode-textCodeBlock-background); border-radius: 4px; }
    .markdown code { font-family: var(--vscode-editor-font-family); background: var(--vscode-textCodeBlock-background); padding: 1px 3px; border-radius: 3px; }
    .markdown pre code { padding: 0; background: transparent; }
    .markdown table { border-collapse: collapse; width: 100%; margin: 8px 0 12px; font-size: .9em; }
    .markdown th, .markdown td { border: 1px solid var(--vscode-widget-border); padding: 4px 6px; text-align: left; vertical-align: top; }
    .markdown th { background: var(--vscode-textBlockQuote-background); }
    ul { padding-left: 18px; }
    a { color: var(--vscode-textLink-foreground); cursor: pointer; }
    .touched-link { color: var(--vscode-editorWarning-foreground); cursor: pointer; font-size: .85em; margin-left: 8px; opacity: .85; }
    .touched-link:hover { opacity: 1; text-decoration: underline; }
  </style>
</head>
<body>
  <h1>${escapeHtml(session.title)}</h1>
  <div class="advice ${escapeHtml(session.advice.severity)}">
    <div class="advice-title">${escapeHtml(session.advice.title)}</div>
    <p>${escapeHtml(session.advice.explanation)}</p>
  </div>
  <div class="actions">
    <button data-action="resume" ${resumeDisabled ? 'disabled' : ''}>Resume</button>
    <button data-action="copyHandoff">Copy Handoff</button>
    <button class="secondary" data-action="editAlias">Edit Alias</button>
    <button class="secondary" data-action="archive" ${session.isActive ? 'disabled' : ''}>${session.archived ? 'Unarchive' : 'Archive'}</button>
    <button class="secondary" data-action="editTags">Edit Tags</button>
    <button class="secondary" data-action="revealProject">Reveal Project</button>
  </div>
  <div class="pills">
    ${session.needsInput ? '<span class="pill pill-warning">● needs input</span>' : ''}
    ${healthStatus ? `<span class="pill ${statusPillClass(session.primaryStatus)}">${escapeHtml(healthStatus)}</span>` : ''}
    ${session.liveState === 'working' ? '<span class="pill pill-active">● working</span>' : ''}
    ${session.liveState === 'attached' ? '<span class="pill pill-attached">● attached</span>' : ''}
    ${session.tags.map((tag) => `<span class="pill tag">#${escapeHtml(tag)}</span>`).join('')}
  </div>
  <div class="facts">
    <span class="label">Project</span><span>${escapeHtml(session.projectName)}</span>
    <span class="label">Updated</span><span>${escapeHtml(formatRelativeTime(session.updated))}</span>
    <span class="label">Messages</span><span>${session.messageCount}</span>
    <span class="label">Context</span><span>${escapeHtml(formatContextTokens(session.contextTokens) ?? 'not analysed')}</span>
    <span class="label">Recorded branch</span><span>${escapeHtml(session.branch ?? 'unknown')}</span>
    <span class="label">Current branch</span><span>${escapeHtml(session.currentBranch ?? 'unknown')}</span>
    <span class="label">Session ID</span><span>${escapeHtml(session.id)}</span>
  </div>
  ${textSection('What You Asked For', preview.goal)}
  ${markdownSection('Where Claude Left Off', preview.lastResponse)}
  ${markdownSection('Plan', preview.automaticContext.plan?.text ?? null)}
  ${todoSection(preview)}
  ${touchedFileSection(preview.touchedFiles, touchedOverlap)}
  ${fileSection('Files Read', preview.automaticContext.readFiles)}
  ${preview.pendingToolName ? textSection('Pending Tool', preview.pendingToolName) : ''}
  <p class="muted">Local transcript-derived view. Reup never sends this content to a remote service.</p>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.addEventListener('click', (event) => {
      const action = event.target.closest('[data-action]');
      if (action && !action.disabled) vscode.postMessage({ type: action.dataset.action });
      const touched = event.target.closest('[data-touched]');
      if (touched) { vscode.postMessage({ type: 'touchedSessions', path: touched.dataset.touched }); return; }
      const file = event.target.closest('[data-file]');
      if (file) vscode.postMessage({ type: 'openFile', path: file.dataset.file });
    });
  </script>
</body>
</html>`
}

function statusPillClass(status: ExtensionSession['primaryStatus']): string {
  if (status === 'interrupted') return 'pill-warning'
  if (status === 'expiring' || status === 'path-missing') return 'pill-error'
  return 'pill-muted'
}

export function emptyInspectorHtml(): string {
  const nonce = randomBytes(18).toString('base64')
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}';"><style nonce="${nonce}">body{font-family:var(--vscode-font-family);color:var(--vscode-descriptionForeground);padding:12px}</style></head><body><h2>Select a session</h2><p>The Inspector will explain whether it is safe to resume and show the latest structured context.</p></body></html>`
}

export function isInspectorMessage(value: unknown): value is InspectorMessage {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  if (
    candidate['type'] === 'archive' ||
    candidate['type'] === 'copyHandoff' ||
    candidate['type'] === 'editAlias' ||
    candidate['type'] === 'editTags' ||
    candidate['type'] === 'resume' ||
    candidate['type'] === 'revealProject'
  ) {
    return true
  }
  return (
    (candidate['type'] === 'openFile' || candidate['type'] === 'touchedSessions') &&
    typeof candidate['path'] === 'string'
  )
}

function textSection(title: string, value: string | null): string {
  return `<h2>${escapeHtml(title)}</h2><p>${value ? escapeHtml(value) : '<span class="muted">No structured value found.</span>'}</p>`
}

function markdownSection(title: string, value: string | null): string {
  return `<h2>${escapeHtml(title)}</h2>${value ? `<div class="markdown">${renderMarkdown(value)}</div>` : '<p><span class="muted">No structured value found.</span></p>'}`
}

function renderMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const html: string[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (!line.trim()) {
      index++
      continue
    }

    const fence = line.match(/^```/)
    if (fence) {
      const code: string[] = []
      index++
      while (index < lines.length && !/^```/.test(lines[index] ?? '')) {
        code.push(lines[index] ?? '')
        index++
      }
      if (index < lines.length) index++
      html.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`)
      continue
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/)
    if (heading) {
      const level = Math.min(4, heading[1]?.length ?? 3)
      html.push(`<h${level}>${renderMarkdownInline(heading[2] ?? '')}</h${level}>`)
      index++
      continue
    }

    if (isTableHeader(lines, index)) {
      const headers = splitTableRow(line)
      index += 2
      const rows: string[][] = []
      while (index < lines.length && isTableRow(lines[index] ?? '')) {
        rows.push(splitTableRow(lines[index] ?? ''))
        index++
      }
      html.push(
        `<table><thead><tr>${headers.map((cell) => `<th>${renderMarkdownInline(cell)}</th>`).join('')}</tr></thead><tbody>${rows
          .map(
            (row) =>
              `<tr>${headers.map((_, cellIndex) => `<td>${renderMarkdownInline(row[cellIndex] ?? '')}</td>`).join('')}</tr>`
          )
          .join('')}</tbody></table>`
      )
      continue
    }

    const bullet = line.match(/^\s*[-*+]\s+(.+)$/)
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/)
    if (bullet || ordered) {
      const tag = ordered ? 'ol' : 'ul'
      const items: string[] = []
      while (index < lines.length) {
        const match =
          tag === 'ol'
            ? (lines[index] ?? '').match(/^\s*\d+[.)]\s+(.+)$/)
            : (lines[index] ?? '').match(/^\s*[-*+]\s+(.+)$/)
        if (!match) break
        items.push(`<li>${renderMarkdownInline(match[1] ?? '')}</li>`)
        index++
      }
      html.push(`<${tag}>${items.join('')}</${tag}>`)
      continue
    }

    const paragraph: string[] = [line.trim()]
    index++
    while (
      index < lines.length &&
      (lines[index] ?? '').trim() &&
      !isMarkdownBlockStart(lines, index)
    ) {
      paragraph.push((lines[index] ?? '').trim())
      index++
    }
    html.push(`<p>${renderMarkdownInline(paragraph.join(' '))}</p>`)
  }

  return html.join('')
}

function renderMarkdownInline(value: string): string {
  const code: string[] = []
  let escaped = escapeHtml(value).replace(/`([^`]+)`/g, (_match, content: string) => {
    const placeholder = `REUPCODEPLACEHOLDER${code.length}END`
    code.push(`<code>${content}</code>`)
    return placeholder
  })
  escaped = escaped
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
  return escaped.replace(
    /REUPCODEPLACEHOLDER(\d+)END/g,
    (_match, index: string) => code[Number(index)] ?? ''
  )
}

function isMarkdownBlockStart(lines: string[], index: number): boolean {
  const line = lines[index] ?? ''
  return (
    /^```/.test(line) ||
    /^#{1,4}\s+/.test(line) ||
    /^\s*[-*+]\s+/.test(line) ||
    /^\s*\d+[.)]\s+/.test(line) ||
    isTableHeader(lines, index)
  )
}

function isTableHeader(lines: string[], index: number): boolean {
  const header = lines[index] ?? ''
  const separator = lines[index + 1] ?? ''
  return isTableRow(header) && /^\s*\|?\s*:?-{3,}/.test(separator) && isTableRow(separator)
}

function isTableRow(line: string): boolean {
  return line.includes('|')
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

function todoSection(preview: SessionPreview): string {
  const todos = preview.automaticContext.todos
  if (todos.items.length === 0) return ''
  const items = todos.items
    .slice(0, 24)
    .map(
      (todo) =>
        `<li>${todo.status === 'completed' ? '✓' : '○'} ${escapeHtml(todo.content)}${todo.status === 'in_progress' ? ' <em>(in progress)</em>' : ''}</li>`
    )
    .join('')
  return `<h2>TODOs</h2><ul>${items}</ul>`
}

function fileSection(title: string, values: string[]): string {
  if (values.length === 0) return ''
  return `<h2>${escapeHtml(title)}</h2><ul>${values
    .map((value) => `<li><a data-file="${escapeAttribute(value)}">${escapeHtml(value)}</a></li>`)
    .join('')}</ul>`
}

/**
 * Like fileSection, but each file that other sessions also edited gets a
 * clickable "↳ N other sessions" link that opens those sessions.
 */
function touchedFileSection(values: string[], overlap: TouchedOverlap): string {
  if (values.length === 0) return ''
  const items = values
    .map((value) => {
      const others = overlap[value] ?? 0
      const link =
        others > 0
          ? ` <span class="touched-link" data-touched="${escapeAttribute(value)}">↳ ${others} other session${
              others === 1 ? '' : 's'
            }</span>`
          : ''
      return `<li><a data-file="${escapeAttribute(value)}">${escapeHtml(value)}</a>${link}</li>`
    })
    .join('')
  return `<h2>Files Touched</h2><ul>${items}</ul>`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/\r/g, '&#13;').replace(/\n/g, '&#10;')
}
