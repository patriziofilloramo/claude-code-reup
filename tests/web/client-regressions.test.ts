import { beforeAll, describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const CLIENT_PATH = join(process.cwd(), 'src', 'web', 'client.js')
const STYLES_PATH = join(process.cwd(), 'src', 'web', 'styles.css')
const UI_PATH = join(process.cwd(), 'src', 'web', 'ui.html')

describe('web client session-row invariants', () => {
  let source: string
  let stylesSource: string
  let uiSource: string

  beforeAll(async () => {
    const files = await Promise.all([
      readFile(CLIENT_PATH, 'utf8'),
      readFile(STYLES_PATH, 'utf8'),
      readFile(UI_PATH, 'utf8'),
    ])
    source = files[0]
    stylesSource = files[1]
    uiSource = files[2]
  })

  function sourceBetween(start: string, end: string): string {
    return source.slice(source.indexOf(start), source.indexOf(end))
  }

  it('resolves rendered session rows by stable session ID, not visual index', () => {
    expect(source).toContain('data-session-id=')
    expect(source).toContain('function resolveSessionFromRow(row)')
    expect(source).not.toContain('sessions[+row.dataset.i]')
    expect(source).not.toContain('data-i=')
  })

  it('resolves rendered project rows by stable project ID, not visual index', () => {
    expect(source).toContain('data-project-id=')
    expect(source).toContain('function resolveProjectFromRow(row)')
    expect(source).not.toContain('projects[+row.dataset.i]')
  })

  it('sorts project rows without changing their stable project resolution', () => {
    const projectSorting = sourceBetween(
      'function deriveVisibleProjects()',
      'function renderProjects()'
    )
    const renderProjects = sourceBetween('function renderProjects()', 'function selectProject(')

    expect(projectSorting).toContain("selectedProjectSort !== 'name'")
    expect(projectSorting).toContain('visibleProjects.slice().sort')
    expect(renderProjects).toContain('visibleProjects.map(buildProjectRowHtml)')
    expect(renderProjects).not.toContain('projects.sort')
  })

  it('filters projects and sessions together during global search', () => {
    const projectSearch = sourceBetween(
      'function deriveVisibleProjects()',
      'function renderProjects()'
    )
    const sessionSearch = sourceBetween(
      'function projectMatchesSearch(',
      'function deriveVisibleSessions()'
    )
    const searchHandlers = sourceBetween(
      'function closeSearch()',
      "elements.searchInput.addEventListener('keydown'"
    )

    expect(projectSearch).toContain('projectMatchesSearch(project, normalizedQuery)')
    expect(projectSearch).toContain('deriveVisibleSessionsForProject(project).length > 0')
    expect(sessionSearch).toContain('[project.id, project.path]')
    expect(sessionSearch).toContain('session.id')
    expect(sessionSearch).toContain('session.projectPath')
    expect(sessionSearch).toContain('session.currentBranch')
    expect(sessionSearch).toContain('.concat(session.context.models || [])')
    expect(searchHandlers).toContain('synchronizeSelectedProjectWithView()')
    expect(searchHandlers).toContain('renderProjects()')
    expect(searchHandlers).toContain('renderSessions()')
  })

  it('protects inline rename input and same-row clicks from rebuilding the row', () => {
    const clickHandler = sourceBetween(
      "elements.sessionList.addEventListener('click'",
      "elements.sessionList.addEventListener('keydown'"
    )

    expect(clickHandler).toContain("event.target.closest('.s-rename-input')")
    expect(clickHandler).toContain('if (row.dataset.sessionId === renamingSessionId) return')
  })

  it('selects an ordinary row without rebuilding the session list', () => {
    const clickHandler = sourceBetween(
      "elements.sessionList.addEventListener('click'",
      "elements.sessionList.addEventListener('keydown'"
    )
    const selectSession = sourceBetween(
      'function selectSession(',
      '// Session filters and inspector'
    )

    expect(clickHandler).toContain('selectedSession.id === session.id')
    expect(clickHandler).toContain('selectSession(session)')
    expect(selectSession).toContain("elements.sessionList.querySelectorAll('.sess-row')")
    expect(selectSession).toContain('const visibleSessions = deriveVisibleSessions()')
    expect(selectSession).toContain('renderInspector(visibleSessions)')
    expect(selectSession).not.toContain('innerHTML')
    expect(selectSession).not.toContain('renderSessions()')
  })

  it('preserves a selected session while filters temporarily hide it', () => {
    const synchronization = sourceBetween(
      'function synchronizeSelectedSession(',
      'function refreshExpandedSessionListIfNeeded('
    )

    expect(synchronization).toContain('selectedSession = refreshedSession || null')
    expect(synchronization).not.toContain('visibleSessions')
  })

  it('searches original names and model history even when a session has an alias', () => {
    const visibleSessions = sourceBetween(
      'function sessionMatchesSearch(',
      'function deriveVisibleSessionsForProject('
    )

    expect(visibleSessions).toContain('session.name')
    expect(visibleSessions).toContain('session.alias')
    expect(visibleSessions).toContain('session.gitBranch')
    expect(visibleSessions).toContain('.concat(session.context.models || [])')
  })

  it('renders account-limit freshness independently from session capture state', () => {
    const usageRendering = sourceBetween('function renderUsageSummary()', 'function compactPath(')

    expect(usageRendering).toContain("liveUsage.limitsStatus === 'fresh'")
    expect(usageRendering).toContain("liveUsage.limitsStatus === 'stale'")
    expect(usageRendering).toContain('liveUsage.rateLimits')
    expect(usageRendering).toContain("liveUsage.limitsSource === 'account-api'")
    expect(usageRendering).not.toContain('live feed')
    expect(usageRendering).toContain('liveUsage.limitsUpdatedAt')
    expect(usageRendering).toContain("'updated ' + relativeTime")
    expect(usageRendering).toContain("'cached, updated ' + relativeTime")
  })

  it('sorts analysed contexts first and keeps recent activity as the tie breaker', () => {
    const visibleSessions = sourceBetween(
      'function deriveVisibleSessions()',
      'function resolveSessionFromRow('
    )

    expect(visibleSessions).toContain("selectedSort === 'context'")
    expect(visibleSessions).toContain('left.context.latestContextTokens ?? -1')
    expect(visibleSessions).toContain('right.updated.localeCompare(left.updated)')
  })

  it('surfaces primary session actions in the inspector, menu, and keyboard shortcuts', () => {
    const inspector = sourceBetween(
      'function buildInspectorActionsHtml(',
      'function buildPreviewBlockHtml('
    )
    const sessionActions = sourceBetween(
      'function executeSessionAction(',
      '// Event delegation keeps handlers valid'
    )
    const shortcuts = sourceBetween(
      "document.addEventListener('keydown'",
      '// j / k - navigate sessions up/down'
    )

    expect(inspector).toContain('data-inspector-action="session-resume"')
    expect(inspector).toContain('data-inspector-action="session-handoff"')
    expect(inspector).toContain('data-inspector-action="session-rename"')
    expect(inspector).toContain('data-inspector-action="session-archive"')
    expect(inspector).toContain('data-inspector-action="session-delete"')
    expect(sessionActions).toContain("action === 'session-handoff'")
    expect(sessionActions).toContain("action === 'session-delete'")
    expect(shortcuts).toContain("event.key === 'r'")
    expect(shortcuts).toContain("event.key === 'H'")
    expect(shortcuts).toContain("event.key === 'D'")
  })

  it('uses a custom right-click menu for project and session rows', () => {
    const contextMenu = sourceBetween(
      "elements.sessionList.addEventListener('contextmenu'",
      "document.addEventListener('click'"
    )

    expect(source).toContain("elements.sessionList.addEventListener('contextmenu'")
    expect(source).toContain("elements.projectList.addEventListener('contextmenu'")
    expect(source).toContain('function openSessionContextMenu(')
    expect(source).not.toContain("elements.sessionInspector.addEventListener('contextmenu'")
    expect(contextMenu).toContain("if (!row || event.target.closest('.s-rename-input')) return")
    expect(contextMenu).toContain('const session = resolveSessionFromRow(row)')
    expect(contextMenu).toContain('if (!row) return')
    expect(contextMenu).toContain('const project = resolveProjectFromRow(row)')
    expect(contextMenu).not.toContain('selectedSession')
    expect(contextMenu).not.toContain('selectedProject')
    expect(source).toContain('event.preventDefault()')
    expect(source).toContain('openContextMenuAt(event.clientX, event.clientY')
  })

  it('keeps the right-click footer hint visible in narrow layouts', () => {
    const narrowStyles = stylesSource.slice(stylesSource.indexOf('@media (max-width: 639px)'))

    expect(uiSource).toContain('ftr-item ftr-item-context')
    expect(narrowStyles).toContain('.ftr-item {')
    expect(narrowStyles).toContain('display: none;')
    expect(narrowStyles).toContain('.ftr-item-context {')
    expect(narrowStyles).toContain('display: flex;')
  })

  it('loads Resume Card preview data lazily and refreshes it without blanking on live updates', () => {
    const previewRefresh = sourceBetween(
      'function refreshSessionPreview(',
      'function ensureSessionPreview('
    )
    const previewLoading = sourceBetween(
      'function ensureSessionPreview(',
      'function markSessionPreviewsStale('
    )
    const staleInvalidation = sourceBetween(
      'function markSessionPreviewsStale(',
      'function buildInspectorActionsHtml('
    )
    const sseUpdates = sourceBetween('function connectLiveUpdates()', '// Narrow-mode back button')

    expect(previewRefresh).toContain('/preview')
    expect(previewRefresh).toContain('entry.refreshing = true')
    expect(previewRefresh).toContain('if (entry.data)')
    expect(previewRefresh).toContain('renderInspector(deriveVisibleSessions())')
    expect(previewLoading).toContain('sessionPreviewCache.set')
    expect(staleInvalidation).toContain('entry.stale = true')
    expect(source).toContain('function buildSessionPreviewHtml(')
    expect(source).toContain('function buildPreviewLabelHtml(')
    expect(source).toContain('preview-label-icon')
    expect(source).toContain('Resume Card')
    expect(source).toContain('function buildNativePlanHtml(')
    expect(source).toContain('function buildNativeTodosHtml(')
    expect(source).toContain('function renderPreviewMarkdown(')
    expect(source).toContain('previewNativePlan')
    expect(source).toContain('previewNativeTodos')
    expect(sseUpdates).toContain('markSessionPreviewsStale()')
    expect(sseUpdates).not.toContain('sessionPreviewCache.clear()')
  })

  it('can expand the session detail panel without affecting mobile layout', () => {
    const renderSessions = sourceBetween(
      'function renderSessions()',
      'async function saveSessionAlias('
    )
    const inspector = sourceBetween(
      'function isSessionInspectorExpanded(',
      "elements.filterBar.addEventListener('click'"
    )
    const narrowStyles = stylesSource.slice(stylesSource.indexOf('@media (max-width: 639px)'))

    expect(source).toContain('let sessionInspectorExpanded = false')
    expect(renderSessions).toContain('const inspectorIsExpanded = isSessionInspectorExpanded')
    expect(renderSessions).toContain(
      'const listedSessions = inspectorIsExpanded ? [selectedSession] : visibleSessions'
    )
    expect(renderSessions).toContain("document.body.classList.toggle('session-details-expanded'")
    expect(inspector).toContain('data-inspector-action="inspector-toggle-expanded"')
    expect(inspector).toContain('sessionInspectorExpanded = !sessionInspectorExpanded')
    expect(stylesSource).toContain('.session-details-expanded .sess-list')
    expect(stylesSource).toContain('.session-details-expanded .sess-inspector')
    expect(source).toContain('inspExpandDetailsLabel')
    expect(source).toContain('inspCollapseDetailsLabel')
    expect(source).toContain('insp-expand-icon')
    expect(source).toContain('insp-expand-label')
    expect(narrowStyles).toContain('.insp-expand-btn')
    expect(narrowStyles).toContain('display: none;')
  })

  it('uses responsive project panel widths instead of a single fixed desktop size', () => {
    expect(stylesSource).toContain('@media (min-width: 1100px)')
    expect(stylesSource).toContain('@media (min-width: 1350px)')
    expect(stylesSource).toContain('@media (min-width: 1600px)')
    expect(stylesSource).toContain('@media (min-width: 1900px)')
    expect(stylesSource).toContain('@media (min-width: 2300px)')
  })

  it('keeps the mobile session detail actions compact', () => {
    const narrowStyles = stylesSource.slice(stylesSource.indexOf('@media (max-width: 639px)'))

    expect(narrowStyles).toContain(".filter-pill[data-filter='active']")
    expect(narrowStyles).toContain(".filter-pill[data-filter='archived']")
    expect(narrowStyles).toContain(".insp-action[data-inspector-action='session-handoff']")
    expect(narrowStyles).toContain(".insp-action[data-inspector-action='session-rename']")
    expect(narrowStyles).toContain(".insp-action[data-inspector-action='session-archive']")
    expect(narrowStyles).toContain('.insp-shortcuts')
  })

  it('keeps mobile session rows compact without horizontal overflow', () => {
    const narrowStyles = stylesSource.slice(stylesSource.indexOf('@media (max-width: 639px)'))

    expect(narrowStyles).toContain('overflow-x: hidden;')
    expect(narrowStyles).toContain('.s-msgs')
    expect(narrowStyles).toContain('.s-model')
    expect(narrowStyles).toContain('.s-context')
    expect(narrowStyles).toContain('display: none;')
    expect(narrowStyles).toContain('.branch-n')
    expect(narrowStyles).toContain('text-overflow: ellipsis;')
  })

  it('derives branch drift from each session working directory', () => {
    const branchDrift = sourceBetween(
      'function buildBranchDriftHtml(',
      'function buildStatusBadgeHtml('
    )

    expect(branchDrift).toContain('session.currentBranch')
    expect(branchDrift).not.toContain('selectedProject.currentBranch')
  })

  it('synchronises selected data before conditionally rendering the inspector', () => {
    const renderSessions = sourceBetween(
      'function renderSessions()',
      'async function saveSessionAlias('
    )

    expect(renderSessions.indexOf('synchronizeSelectedSession()')).toBeGreaterThanOrEqual(0)
    expect(renderSessions.indexOf('synchronizeSelectedSession()')).toBeLessThan(
      renderSessions.indexOf('renderInspector(visibleSessions)')
    )
  })

  it('does not apply stale CLAUDE.md responses after the selected project changes', () => {
    const refreshAvailability = sourceBetween(
      'async function refreshClaudeInstructionsAvailability(',
      'async function openClaudeInstructionsDrawer('
    )
    const openDrawer = sourceBetween(
      'async function openClaudeInstructionsDrawer(',
      'function closeClaudeInstructionsDrawer('
    )

    expect(refreshAvailability).toContain('selectedProject.id === project.id')
    expect(openDrawer).toContain('const project = selectedProject')
    expect(openDrawer).toContain('selectedProject.id !== project.id')
    expect(openDrawer).toContain('claudeInstructionsProjectId = project.id')
  })

  it('surfaces doctor findings in Lost & Found and its issue count', () => {
    const diagnostics = sourceBetween(
      'async function renderDiagnosticsPanel()',
      'elements.diagnosticsButton.addEventListener'
    )
    const refresh = sourceBetween(
      'async function refreshProjectData()',
      'function connectLiveUpdates()'
    )

    expect(diagnostics).toContain('report.brokenIndices')
    expect(diagnostics).toContain('report.staleLocks')
    expect(diagnostics).toContain('(report.brokenIndices ? report.brokenIndices.length : 0) +')
    expect(diagnostics).toContain('(report.staleLocks ? report.staleLocks.length : 0)')
    expect(refresh).toContain('diagnosticsData.brokenIndices')
    expect(refresh).toContain('diagnosticsData.staleLocks')
  })

  it('keeps live usage prominent and applies warning thresholds', () => {
    const usageRendering = sourceBetween('function usageLevel(', 'function compactPath(')
    const usageRefresh = sourceBetween(
      'async function refreshUsageSummary()',
      'async function refreshProjectData()'
    )
    const projectRefresh = sourceBetween(
      'async function refreshProjectData()',
      'function connectLiveUpdates()'
    )

    expect(usageRendering).toContain('percentage >= 100')
    expect(usageRendering).toContain('percentage >= 90')
    expect(usageRendering).toContain('percentage >= 80')
    expect(usageRendering).toContain("appendUsageLimit(elements.usageSummary, '5h'")
    expect(usageRendering).toContain("appendUsageLimit(elements.usageSummary, '7d'")
    expect(usageRendering).toContain("heading.textContent = 'limits'")
    expect(usageRendering).not.toContain("'session context '")
    expect(usageRendering).toContain('liveUsage.usageCreditsEnabled !== true')
    expect(usageRendering).toContain("badge.textContent = 'credits on'")
    expect(usageRendering).toContain('fill.style.width = Math.max(0, Math.min(100')
    expect(usageRendering).not.toContain('↻')
    expect(usageRefresh).toContain("requestJson('/api/usage')")
    expect(usageRefresh).toContain('liveUsage =')
    expect(projectRefresh).not.toContain("requestJson('/api/usage')")
    expect(source).toContain('void refreshUsageSummary()')
    expect(source).toContain('USAGE_POLL_INTERVAL_MS')
  })
})
