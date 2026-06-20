import { randomBytes } from 'node:crypto'

import type { SessionPreview } from '../../src/core/session/session-preview.js'
import { formatContextTokens, formatRelativeTime } from './formatting.js'
import type { ExtensionSession } from './swoop-data.js'

export type InspectorMessage =
  | { type: 'archive' }
  | { type: 'copyHandoff' }
  | { type: 'editAlias' }
  | { type: 'editTags' }
  | { path: string; type: 'openFile' }
  | { type: 'resume' }
  | { type: 'revealProject' }

export function renderInspectorHtml(session: ExtensionSession, preview: SessionPreview): string {
  const nonce = randomBytes(18).toString('base64')
  const resumeDisabled =
    session.advice.code === 'path-missing' || session.advice.code === 'already-active'
  const memoryStatus =
    session.memoryStatus && session.memoryStatus !== 'none'
      ? `<span class="pill memory-${session.memoryStatus}">Project Memory: ${escapeHtml(session.memoryStatus)}</span>`
      : ''

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
    .memory-green { color: var(--vscode-testing-iconPassed); }
    .memory-orange { color: var(--vscode-editorWarning-foreground); }
    .memory-grey { color: var(--vscode-disabledForeground); }
    .muted { color: var(--vscode-descriptionForeground); }
    ul { padding-left: 18px; }
    a { color: var(--vscode-textLink-foreground); cursor: pointer; }
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
    <span class="pill">${escapeHtml(session.primaryStatus)}</span>
    ${session.isActive ? '<span class="pill">active</span>' : ''}
    ${memoryStatus}
    ${session.tags.map((tag) => `<span class="pill">${escapeHtml(tag)}</span>`).join('')}
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
  ${textSection('Where Claude Left Off', preview.lastResponse)}
  ${textSection('Plan', preview.automaticContext.plan?.text ?? null)}
  ${todoSection(preview)}
  ${fileSection('Files Touched', preview.touchedFiles)}
  ${fileSection('Files Read', preview.automaticContext.readFiles)}
  ${preview.pendingToolName ? textSection('Pending Tool', preview.pendingToolName) : ''}
  <p class="muted">Local transcript-derived view. Swoop never sends this content to a remote service.</p>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.addEventListener('click', (event) => {
      const action = event.target.closest('[data-action]');
      if (action && !action.disabled) vscode.postMessage({ type: action.dataset.action });
      const file = event.target.closest('[data-file]');
      if (file) vscode.postMessage({ type: 'openFile', path: file.dataset.file });
    });
  </script>
</body>
</html>`
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
  return candidate['type'] === 'openFile' && typeof candidate['path'] === 'string'
}

function textSection(title: string, value: string | null): string {
  return `<h2>${escapeHtml(title)}</h2><p>${value ? escapeHtml(value) : '<span class="muted">No structured value found.</span>'}</p>`
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
