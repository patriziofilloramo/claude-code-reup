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

  function createClaudeInstructionsHarness(
    requestJson: (url: string, options: { body: string }) => Promise<unknown>
  ): {
    close: () => Promise<void>
    edit: (value: string) => void
    isDirty: () => boolean
    isEditorDisabled: () => boolean
    isOpen: () => boolean
    save: () => Promise<boolean>
    status: () => string
  } {
    const saveFlow = sourceBetween(
      'async function saveClaudeInstructions()',
      "elements.instructionsTag.addEventListener('click'"
    )
    const closeStart = source.indexOf('async function closeClaudeInstructionsDrawer()')
    const closeEnd = source.indexOf(
      '// ---------------------------------------------------------------------------\n// Lost & Found panel',
      closeStart
    )
    const closeFlow = source.slice(closeStart, closeEnd)
    const factory = new Function(
      'requestJson',
      `
        let claudeInstructionsProjectId = 'project-1'
        let claudeInstructionsSaveTimer = null
        let claudeInstructionsSaveQueue = Promise.resolve()
        let claudeInstructionsDirty = false
        let claudeInstructionsClosing = false
        let drawerOpen = true
        const selectedProject = { id: 'project-1' }
        const STRINGS = {
          claudeMdSaveError: 'error: {message}',
          claudeMdSaved: 'saved'
        }
        const elements = {
          instructionsDrawer: {
            classList: {
              contains: function (name) { return name === 'open' && drawerOpen },
              remove: function (name) { if (name === 'open') drawerOpen = false }
            }
          },
          instructionsEditor: { disabled: false, value: '' },
          instructionsSaveButton: { disabled: false },
          instructionsSaveStatus: { className: 'save-status', textContent: '' }
        }
        function fmt(template, values) {
          return template.replace('{message}', values.message)
        }
        ${saveFlow}
        ${closeFlow}
        return {
          close: closeClaudeInstructionsDrawer,
          edit: function (value) {
            elements.instructionsEditor.value = value
            claudeInstructionsDirty = true
          },
          isDirty: function () { return claudeInstructionsDirty },
          isEditorDisabled: function () { return elements.instructionsEditor.disabled },
          isOpen: function () { return drawerOpen },
          save: saveClaudeInstructions,
          status: function () { return elements.instructionsSaveStatus.textContent }
        }
      `
    ) as (request: typeof requestJson) => {
      close: () => Promise<void>
      edit: (value: string) => void
      isDirty: () => boolean
      isEditorDisabled: () => boolean
      isOpen: () => boolean
      save: () => Promise<boolean>
      status: () => string
    }
    return factory(requestJson)
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

  it('keeps the Matrix boot loader configurable through CSS classes and named constants', () => {
    const loader = sourceBetween('function showLoadingOverlay()', 'function startLoadingRain')

    expect(loader).toContain("overlay.id = 'reup-loading'")
    expect(loader).toContain("canvas.className = 'rl-canvas'")
    expect(loader).toContain("panel.className = 'rl-panel'")
    expect(loader).toContain('class="rl-title"')
    expect(loader).not.toContain('style.cssText')
    expect(loader).not.toContain('style="font-size:')

    expect(source).toContain('var MATRIX_RAIN_COLUMN_WIDTH = 14')
    expect(source).toContain('var LOADING_BAR_WIDTH = 16')
    expect(stylesSource).toContain('--matrix-primary:')
    expect(stylesSource).toContain('#reup-loading {')
    expect(stylesSource).toContain('.rl-title {')
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

    expect(projectSearch).toContain('parseSearchQuery(searchQuery)')
    expect(projectSearch).toContain('projectMatchesSearch(project, searchSpec)')
    expect(projectSearch).toContain('deriveVisibleSessionsForProject(project).length > 0')
    expect(sessionSearch).toContain('[project.id, project.path]')
    expect(sessionSearch).toContain('session.id')
    expect(sessionSearch).toContain('session.projectPath')
    expect(sessionSearch).toContain('session.currentBranch')
    expect(sessionSearch).toContain('sessionMatchesReviewBuckets')
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
      'function sessionMatchesSearchText(',
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

  it('removes desktop-only footer hints and hover affordances in narrow layouts', () => {
    const narrowStyles = stylesSource.slice(stylesSource.indexOf('@media (max-width: 639px)'))

    expect(uiSource).toContain('ftr-item ftr-item-context')
    expect(narrowStyles).toContain('.ftr-item {')
    expect(narrowStyles).toContain('display: none;')
    expect(narrowStyles).not.toContain('.ftr-sync-btn {')
    expect(narrowStyles).toContain('.rail-info,')
    expect(narrowStyles).toContain('.rail-toggle {')
    expect(narrowStyles).not.toContain('.ftr-item-context {\n    display: flex;')
  })

  it('progressively trims footer shortcuts before they overflow', () => {
    const mediumStyles = stylesSource.slice(stylesSource.indexOf('@media (max-width: 1199px)'))
    const compactStyles = stylesSource.slice(stylesSource.indexOf('@media (max-width: 899px)'))

    expect(mediumStyles).toContain('.ftr-item:nth-of-type(n + 5)')
    expect(mediumStyles).toContain('display: none;')
    expect(compactStyles).toContain('.ftr-item:nth-of-type(n + 4)')
    expect(compactStyles).toContain('display: none;')
  })

  it('keeps the footer as a compact status bar without baseline hacks', () => {
    const footerStyles = stylesSource.slice(
      stylesSource.indexOf('.ftr {'),
      stylesSource.indexOf('.ftr-status.ok')
    )
    const footerRootStyles = stylesSource.slice(
      stylesSource.indexOf('.ftr {'),
      stylesSource.indexOf('.ftr-item {')
    )

    expect(stylesSource).toContain('--footer-height: 28px;')
    expect(stylesSource).toContain('--footer-pad-block: 5px;')
    expect(stylesSource).toContain('--footer-optical-shift: 3px;')
    expect(stylesSource).toContain('--footer-pad-top:')
    expect(stylesSource).toContain('--footer-pad-bottom:')
    expect(footerStyles).not.toContain('height: var(--footer-height);')
    expect(footerStyles).toContain('line-height: 1;')
    expect(footerStyles).toContain(
      'padding: var(--footer-pad-top) var(--space-md) var(--footer-pad-bottom);'
    )
    expect(footerRootStyles).not.toContain('align-items: center;')
    expect(footerStyles).toContain('overflow: hidden;')
    expect(footerStyles).toContain('white-space: nowrap;')
    expect(footerStyles).toContain('flex-shrink: 0;')
    expect(footerStyles).toContain('font-size: 10.5px;')
    expect(footerStyles).toContain('gap: 12px;')
    expect(footerStyles).toContain('height: var(--footer-control-height);')
    expect(footerStyles).not.toMatch(/\.ftr-item,\s*\.ftr-status/)
    expect(footerStyles).not.toContain('footer-baseline-shift')
    expect(footerStyles).not.toContain('translateY(')
    expect(footerStyles).toContain('height: 16px;')
    expect(footerStyles).toContain('display: inline-flex;')
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

  it('disables resume actions when the recorded project path is unavailable', () => {
    const inspectorActions = sourceBetween(
      'function buildInspectorActionsHtml(',
      'function buildPreviewLabelHtml('
    )
    const sessionActions = sourceBetween(
      'function sessionActionItems(',
      '// Event delegation keeps handlers valid'
    )
    const resumeFlow = sourceBetween(
      'function openResumeDialog(',
      'elements.resumeConfirmButton.addEventListener'
    )

    expect(inspectorActions).toContain('const resumeDisabled = !session.signals.pathExists')
    expect(inspectorActions).toContain("resumeDisabled ? ' disabled' : ''")
    expect(sessionActions).toContain('disabled: !session.signals.pathExists')
    expect(resumeFlow).toContain('if (!session.signals.pathExists)')
    expect(resumeFlow).toContain('if (!selectedSession.signals.pathExists)')
    expect(resumeFlow).toContain('elements.resumeConfirmButton.disabled = false')
    expect(resumeFlow).toContain("showToast(STRINGS.resumePathUnavailable, 'err')")
  })

  it('serializes CLAUDE.md writes and flushes dirty content before closing', () => {
    const saveFlow = sourceBetween(
      'async function saveClaudeInstructions()',
      "elements.instructionsTag.addEventListener('click'"
    )
    const closeFlow = sourceBetween(
      'async function closeClaudeInstructionsDrawer()',
      '// ---------------------------------------------------------------------------\n// Lost & Found panel'
    )

    expect(saveFlow).toContain('claudeInstructionsSaveQueue.then(')
    expect(saveFlow).toContain('const content = elements.instructionsEditor.value')
    expect(saveFlow).toContain('claudeInstructionsSaveQueue = result.then(')
    expect(saveFlow).toContain('elements.instructionsEditor.value === content')
    expect(saveFlow).toContain('if (!claudeInstructionsProjectId) return false')
    expect(saveFlow).not.toContain('selectedProject')
    expect(closeFlow).toContain('await saveClaudeInstructions()')
    expect(closeFlow.indexOf('await saveClaudeInstructions()')).toBeLessThan(
      closeFlow.indexOf("instructionsDrawer.classList.remove('open')")
    )
    expect(source).toContain('claudeInstructionsDirty = true')
  })

  it('keeps overlapping CLAUDE.md requests in editor order', async () => {
    const calls: string[] = []
    let releaseFirst!: () => void
    const firstRequest = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const harness = createClaudeInstructionsHarness(async (_url, options) => {
      const content = (JSON.parse(options.body) as { content: string }).content
      calls.push(content)
      if (calls.length === 1) await firstRequest
      return {}
    })

    harness.edit('first')
    const firstSave = harness.save()
    await Promise.resolve()
    harness.edit('second')
    const secondSave = harness.save()
    await Promise.resolve()

    expect(calls).toEqual(['first'])
    releaseFirst()
    await expect(Promise.all([firstSave, secondSave])).resolves.toEqual([true, true])
    expect(calls).toEqual(['first', 'second'])
    expect(harness.isDirty()).toBe(false)
    expect(harness.status()).toBe('saved')
  })

  it('waits for a dirty CLAUDE.md flush before closing the drawer', async () => {
    let releaseSave!: () => void
    const pendingSave = new Promise<void>((resolve) => {
      releaseSave = resolve
    })
    const harness = createClaudeInstructionsHarness(async () => pendingSave)
    harness.edit('latest')

    const closing = harness.close()
    await Promise.resolve()

    expect(harness.isOpen()).toBe(true)
    expect(harness.isEditorDisabled()).toBe(true)
    releaseSave()
    await closing
    expect(harness.isOpen()).toBe(false)
    expect(harness.isDirty()).toBe(false)
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

  it('installs global client error handlers with visible recovery feedback', () => {
    expect(source).toContain("window.addEventListener('error'")
    expect(source).toContain("window.addEventListener('unhandledrejection'")
    expect(source).toContain('function reportClientError(error, context)')
    expect(source).toContain('STRINGS.clientUnexpectedError')
    expect(source).toContain('elements.footerStatus.textContent = STRINGS.clientUnexpectedStatus')
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

  it('does not let an older project refresh overwrite newer client state', () => {
    const projectRefresh = sourceBetween(
      'async function refreshProjectData()',
      'function connectLiveUpdates()'
    )

    expect(source).toContain('let projectRefreshGeneration = 0')
    expect(projectRefresh).toContain('const refreshGeneration = ++projectRefreshGeneration')
    expect(projectRefresh).toContain('refreshGeneration !== projectRefreshGeneration')
  })

  it('refreshes both the live rail and selected inspector heartbeat', () => {
    const applyActivity = sourceBetween(
      'function applyLiveActivity(entries)',
      'async function refreshLiveActivity()'
    )
    const liveRefreshStart = source.indexOf('async function refreshLiveActivity()')
    const liveRefresh = source.slice(
      liveRefreshStart,
      source.indexOf('void refreshProjectData()', liveRefreshStart)
    )

    expect(applyActivity).toContain('liveActivity = entries')
    expect(applyActivity).toContain('renderRail()')
    expect(applyActivity).toContain('if (selectedSession) renderInspector(deriveVisibleSessions())')
    expect(liveRefresh).toContain('applyLiveActivity([])')
    expect(liveRefresh).toContain('applyLiveActivity(data)')
  })

  it('pins attention sessions in the strip and renders their message', () => {
    const activityRail = sourceBetween(
      'function activityDisplayRank(entry)',
      '/** Re-renders the org rail.'
    )

    // The label comes from the shared helper, so the rail cannot word an
    // attention entry differently from the list or the inspector.
    expect(activityRail).toContain('dotActivityLabel(stateClass)')
    expect(activityRail).toContain('activity-msg')
    expect(activityRail).toContain('activityDisplayRank(a) - activityDisplayRank(b)')
    expect(source).toContain("if (state === 'attention') return STRINGS.activityNeedsInput")
  })

  it('keeps attached-but-quiet sessions visible in the strip instead of flickering out', () => {
    const activityRail = sourceBetween(
      'function activityDisplayRank(entry)',
      '/** Re-renders the org rail.'
    )

    // The idle filter caused sessions to vanish mid-turn whenever transcript
    // events paused; quiet sessions now render dimmed at the bottom.
    expect(activityRail).not.toContain("if (state === 'idle' && !needsInput) continue")
    expect(activityRail).toContain("stateClass === 'idle' || stateClass === 'attached'")
    expect(stylesSource).toContain('.rail-live-item.idle')
  })

  /**
   * The row recedes by dimming its text only. Putting the opacity on the row
   * would darken the dot a second time on top of its own state colour, so the
   * same session's dot would look different in the rail than in the session
   * list — the surface disagreement the shared live state exists to prevent.
   */
  /**
   * The live-state palette and the link-lost overlay were built separately, and
   * meet on this selector. While the link is down every dot must read the same
   * — nothing is confirming any of them — so the offline rule has to outrank
   * the per-state ones rather than leaving `attached` a shade apart.
   */
  it('flattens every dot to one unknown reading while the link is down', () => {
    expect(stylesSource).toMatch(/body\.link-lost \.activity-dot \{[^}]*opacity/)
    expect(stylesSource).toMatch(/body\.link-lost \.activity-dot \{[^}]*animation: none/)
    // Specificity check, stated as the rule it protects: an element plus two
    // classes beats the two-class per-state selectors like `.activity-dot.attached`.
    expect(stylesSource).toContain('body.link-lost .activity-dot')
  })

  it('dims a quiet rail row without dimming its dot twice', () => {
    expect(stylesSource).toContain('.rail-live-item.idle .activity-copy')
    expect(stylesSource).not.toMatch(/\.rail-live-item\.idle \{[^}]*opacity/)
  })

  /**
   * The dot renders only for sessions holding a live lock, so "attached" is the
   * one fact behind it that is always known. running/waiting/idle come from
   * lock status, hook markers, or — when a session has neither, as VS Code
   * locks do — transcript recency, which cannot tell a long tool call from a
   * finished turn. Reported from use: an actively working session showed amber
   * "waiting" and then grey "idle" while the TUI correctly showed it as live.
   */
  it('keeps the established dot palette', () => {
    // Repainting these was itself a regression: the amber "waiting" dot is the
    // stall indication for sessions that report their turn boundaries, and
    // recolouring idle made the rail and the session list disagree about the
    // same session. Only *when* waiting applies changed — see below.
    const dot = stylesSource.slice(
      stylesSource.indexOf('.activity-dot {'),
      stylesSource.indexOf('.activity-state {')
    )

    expect(dot).toMatch(/\.activity-dot \{[^}]*background: var\(--muted\)/)
    expect(dot).toMatch(/\.activity-dot\.running \{[^}]*background: var\(--bucket-active\)/)
    expect(dot).toMatch(/\.activity-dot\.waiting \{[^}]*background: var\(--bucket-attention\)/)
    expect(dot).toMatch(/\.activity-dot\.attention \{[^}]*background: var\(--red\)/)

    // Attached is the live colour held back, matching how the TUI dims the
    // same green. A second green here would put the surfaces back out of step.
    expect(dot).toMatch(/\.activity-dot\.attached \{[^}]*background: var\(--bucket-active\)/)
    expect(dot).toMatch(/\.activity-dot\.attached \{[^}]*opacity: 0\.55/)
  })

  it('draws the shared live state, refining it only where it may', () => {
    const declaration = /^function dotActivityState\([\s\S]*?^}/m.exec(source)
    expect(declaration).not.toBeNull()
    const dotActivityState = new Function(
      `${declaration?.[0] ?? ''}; return dotActivityState;`
    )() as (entry: unknown) => string

    // The three states the core decides are drawn as the core decided them,
    // whatever the web's own finer reading says. This is what keeps the web
    // agreeing with the TUI and the extension.
    expect(dotActivityState({ liveState: 'working', activityState: 'idle' })).toBe('running')
    expect(dotActivityState({ liveState: 'needs-input', activityState: 'idle' })).toBe('attention')
    expect(dotActivityState({ liveState: 'detached', activityState: 'running' })).toBe('idle')

    // Attached is the one state the web may refine, and only into waiting.
    expect(dotActivityState({ liveState: 'attached', activityState: 'idle' })).toBe('attached')

    // Reported: a finished turn with an unanswered call really is blocked on
    // the user, and amber is the indication that says so.
    expect(
      dotActivityState({ liveState: 'attached', activityState: 'waiting', stateIsReported: true })
    ).toBe('waiting')

    // Inferred from transcript recency: a pause mid-tool-call looks exactly
    // like a finished turn, so it must not claim attention. The session falls
    // back to the shared reading rather than to grey.
    expect(
      dotActivityState({ liveState: 'attached', activityState: 'waiting', stateIsReported: false })
    ).toBe('attached')
    expect(dotActivityState({ liveState: 'attached', activityState: 'waiting' })).toBe('attached')

    // A session with no entry at all is the only thing that reads as absent.
    expect(dotActivityState(null)).toBe('idle')
  })

  /**
   * The division of labour that took two wrong turns to find. The server
   * reports *what* happened, because the page cannot witness both sides of a
   * transition it may be throttled through. The page decides *whether the user
   * needs telling*, because `document.hidden` is the one signal only it has —
   * and a local process guessing from "did they reply within 30 seconds"
   * mistook reading a long answer for walking away.
   */
  it('takes the boundary from the server and the audience question from the page', () => {
    const liveUpdates = sourceBetween('function connectLiveUpdates()', '// Narrow-mode back button')

    expect(liveUpdates).toContain("liveUpdatesSource.addEventListener('turn-finished'")
    expect(liveUpdates).toContain('STRINGS.notifyTurnCompleteTitle')
    expect(liveUpdates).toContain('!document.hidden')
    // The diffing this replaced misses transitions a throttled tab slept through.
    expect(source).not.toContain('previousActivityStates')
  })

  it('raises a needs-input desktop alert without duplicates', () => {
    expect(source).toContain('function raiseDesktopAlerts(entries)')
    expect(source).toContain('notifiedAttentionKeys')
    expect(source).toContain('document.hidden')
    expect(source).toContain('Notification.requestPermission()')
    expect(source).toContain('NOTIFY_PREFERENCE')
    expect(source).toContain(
      "addEventListener('click', function () {\n    void toggleDesktopAlerts()"
    )
  })

  it('applies pushed activity snapshots without a refetch and refreshes usage on its event', () => {
    const liveUpdates = sourceBetween('function connectLiveUpdates()', '// Narrow-mode back button')

    expect(liveUpdates).toContain("liveUpdatesSource.addEventListener('activity'")
    expect(liveUpdates).toContain('JSON.parse(event.data)')
    expect(liveUpdates).toContain('activeSessionIds = new Set(snapshot.activeSessionIds)')
    expect(liveUpdates).toContain('applyLiveActivity(snapshot.entries)')
    expect(liveUpdates).toContain("liveUpdatesSource.addEventListener('usage'")
    expect(source).toContain('LIVE_STRIP_TICK_MS')
  })

  it('keeps live activity rail copy explicit and in STRINGS', () => {
    const strings = sourceBetween('const STRINGS = {', 'function fmt(')
    const activityRail = sourceBetween(
      'function buildActivitySectionHtml()',
      '/** Re-renders the org rail.'
    )

    expect(strings).toContain("railActivity: 'LIVE ACTIVITY'")
    expect(strings).toContain('railActivityTooltip')
    expect(activityRail).toContain('STRINGS.railActivity')
    expect(activityRail).toContain('STRINGS.railActivityTooltip')
    expect(activityRail).not.toContain("'LIVE'")
    expect(activityRail).not.toContain('Current tool state for attached active sessions')
  })

  it('shows readable live activity rows without ghost placeholders', () => {
    const activityRail = sourceBetween(
      'function buildActivitySectionHtml()',
      '/** Re-renders the org rail.'
    )

    expect(activityRail).toContain('dotActivityLabel(stateClass)')
    expect(source).toContain("if (state === 'running') return STRINGS.activityRunning")
    expect(source).toContain("if (state === 'waiting') return STRINGS.activityWaiting")
    expect(source).toContain('return STRINGS.activityIdle')
    expect(activityRail).toContain('activity-state')
    expect(activityRail).toContain('rail-live-item')
    expect(activityRail).toContain('activity-title')
    expect(activityRail).toContain('activity-meta')
    expect(activityRail).toContain('if (!entry.sessionId) continue')
    expect(activityRail).not.toContain('live-placeholder')
    expect(activityRail).not.toContain('activityDetail')
  })

  it('debounces filesystem event bursts before refreshing the whole web model', () => {
    const config = sourceBetween('const AUTO_SAVE_DELAY_MS', 'const RISK_RANK')
    const liveUpdates = sourceBetween('function connectLiveUpdates()', '// Narrow-mode back button')

    expect(config).toContain('SSE_REFRESH_DEBOUNCE_MS')
    expect(source).toContain('let liveUpdatesRefreshTimer = null')
    expect(liveUpdates).toContain('function scheduleLiveDataRefresh()')
    expect(liveUpdates).toContain('clearTimeout(liveUpdatesRefreshTimer)')
    expect(liveUpdates).toContain('setTimeout(function ()')
    expect(liveUpdates).toContain('void refreshProjectData()')
    expect(liveUpdates).toContain('void refreshLiveActivity()')
  })

  it('refreshes live activity only after project data updated activeSessionIds', () => {
    const scheduleRefresh = sourceBetween(
      'function scheduleLiveDataRefresh()',
      'liveUpdatesSource = new EventSource'
    )

    expect(scheduleRefresh).toContain('void refreshProjectData().then(function () {')
    expect(scheduleRefresh).toContain('return refreshLiveActivity()')
  })

  it('gives the session-list dot the same working/waiting/idle/attention states as the rail', () => {
    const rowState = sourceBetween(
      'function liveSessionRowState(sessionId)',
      'function buildSessionRowHtml(session)'
    )
    const sessionRow = sourceBetween(
      'function buildSessionRowHtml(session)',
      'function buildEmptySessionListHtml'
    )

    // Same source of truth as the rail/inspector — findLiveActivity — and the
    // same resolver for both the state and its label, so the three surfaces
    // cannot disagree. Neither may re-derive attention on its own.
    expect(rowState).toContain('findLiveActivity(sessionId)')
    expect(rowState).toContain('dotActivityState(findLiveActivity(sessionId))')
    expect(rowState).toContain('dotActivityLabel(state)')
    expect(rowState).not.toContain('entry.attention')

    // A live session with no live-activity entry yet must not crash or show
    // a stale/wrong state. All three surfaces get that fallback from the one
    // shared resolver, which returns idle for a missing entry.
    expect(source).toContain('function dotActivityState(entry)')

    expect(sessionRow).toContain(
      'const liveState = isLive ? liveSessionRowState(session.id) : null'
    )
    expect(sessionRow).toContain(
      "(liveState ? '<span class=\"activity-dot ' + escapeHtml(liveState.state) + '\"></span>' : '')"
    )
    // A non-live session keeps the exact old markup: an empty, tooltip-less slot.
    expect(sessionRow).not.toContain("(isLive ? '◉' : '')")
  })

  it('reuses the rail activity-dot component for the session-list dot instead of duplicating its colours', () => {
    const sLiveStart = stylesSource.indexOf('.s-live {')
    const sLive = stylesSource.slice(sLiveStart, stylesSource.indexOf('}', sLiveStart))
    expect(sLive).toContain('display: flex')
    expect(sLive).toContain('justify-content: center')
    // No independent colour rules for .s-live — it only centers a child
    // .activity-dot, whose running/waiting/attention colours are defined once.
    expect(sLive).not.toContain('background')
    expect(sLive).not.toContain('color: var(--green)')
  })

  it('re-renders the session list (for the live dot) whenever live-activity data updates, not only on SSE pushes', () => {
    const applyActivity = sourceBetween(
      'function applyLiveActivity(entries)',
      'async function refreshLiveActivity()'
    )

    expect(applyActivity).toContain('renderSessions()')
  })
})

describe('web client org layer invariants', () => {
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

  it('renders review signal icons in the selected project header', () => {
    const reviewSignals = sourceBetween(
      'function renderReviewSignals()',
      'function renderSessions()'
    )
    expect(reviewSignals).toContain('countReviewBucketSessionsForProject(selectedProject, bucket)')
    expect(reviewSignals).toContain('if (count === 0) continue')
    expect(reviewSignals).toContain('review-signal')
    expect(reviewSignals).toContain('data-review-token')
    expect(reviewSignals).toContain('bucket.searchToken')
  })

  it('parses review search tokens and aliases', () => {
    const searchParsing = sourceBetween(
      'function normalizeReviewSearchToken(',
      '/** Returns true if the project'
    )
    expect(searchParsing).toContain("token === 'drift'")
    expect(searchParsing).toContain("'branch-drift'")
    expect(searchParsing).toContain("token === 'context'")
    expect(searchParsing).toContain("'high-context'")
    expect(searchParsing).toContain("part.toLowerCase().startsWith('is:')")
    expect(searchParsing).toContain('reviewBucketIds.push(bucketId)')
  })

  it('focuses by stack resolving project and session items separately', () => {
    const focusResolver = sourceBetween(
      'function getSessionsMatchingFocus(project)',
      'function isRailSectionCollapsed('
    )
    expect(focusResolver).toContain("focusFilter.kind === 'stack'")
    expect(focusResolver).toContain("item.kind === 'project'")
    expect(focusResolver).toContain("item.kind === 'session'")
    expect(focusResolver).toContain('return null')
    expect(focusResolver).toContain('return undefined')
  })

  it('focuses by group using projectGroupAssignments', () => {
    const focusResolver = sourceBetween(
      'function getSessionsMatchingFocus(project)',
      'function isRailSectionCollapsed('
    )
    expect(focusResolver).toContain("focusFilter.kind === 'group'")
    expect(focusResolver).toContain('orgData.projectGroupAssignments')
    expect(focusResolver).toContain('focusFilter.id')
  })

  it('focuses by tag on session-level tags and project-level tags', () => {
    const focusResolver = sourceBetween(
      'function getSessionsMatchingFocus(project)',
      'function isRailSectionCollapsed('
    )
    expect(focusResolver).toContain("focusFilter.kind === 'tag'")
    expect(focusResolver).toContain('project.projectTags')
    expect(focusResolver).toContain('s.tags')
    expect(focusResolver).toContain('indexOf(tag) !== -1')
  })

  it('derives visible projects through the focus filter before applying search', () => {
    const deriveProjects = sourceBetween(
      'function deriveVisibleProjects()',
      'function renderProjects()'
    )
    expect(deriveProjects).toContain('if (focusFilter)')
    expect(deriveProjects).toContain('getSessionsMatchingFocus(project)')
    expect(deriveProjects).toContain('if (focusSessions === undefined) return false')
    expect(deriveProjects).toContain('if (focusSessions === null) return true')
    expect(deriveProjects).toContain('focusSessions.length > 0')
  })

  it('review search tokens filter sessions through review buckets', () => {
    const deriveSessions = sourceBetween(
      'function deriveVisibleSessionsForProject(',
      'function deriveVisibleSessions()'
    )
    expect(deriveSessions).toContain('parseSearchQuery(searchQuery)')
    expect(deriveSessions).toContain('sessionMatchesReviewBuckets')
    expect(deriveSessions).toContain('projectTextMatches')
  })

  it('tag + stack focus intersects with pill filter', () => {
    const deriveSessions = sourceBetween(
      'function deriveVisibleSessionsForProject(',
      'function deriveVisibleSessions()'
    )
    expect(deriveSessions).toContain('var pilledIds = new Set(')
    expect(deriveSessions).toContain('sessionsMatchingFilter(project, selectedFilter)')
    expect(deriveSessions).toContain('pilledIds.has(s.id)')
  })

  it('clears focus filter and re-renders all panels', () => {
    const clearFocus = sourceBetween('function clearFocusFilter()', 'if (elements.focusClearBtn)')
    expect(clearFocus).toContain('focusFilter = null')
    expect(clearFocus).toContain('renderRail()')
    expect(clearFocus).toContain('renderFocusBar()')
    expect(clearFocus).toContain('renderProjects()')
    expect(clearFocus).toContain('renderSessions()')
  })

  it('tag chips render up to TAG_CHIPS_MAX tags with +N overflow', () => {
    const tagChips = sourceBetween('function buildTagChipsHtml(', 'function buildSessionRowHtml(')
    expect(tagChips).toContain('TAG_CHIPS_MAX')
    expect(tagChips).toContain('tags.slice(0, TAG_CHIPS_MAX)')
    expect(tagChips).toContain('tags.length - shown.length')
    expect(tagChips).toContain('">#')
    expect(tagChips).toContain('s-tag')
    expect(tagChips).toContain('tagChipOverflow')
  })

  it('clicking an s-tag chip in the session list sets a tag focus filter', () => {
    const clickHandler = sourceBetween(
      "elements.sessionList.addEventListener('click'",
      "elements.sessionList.addEventListener('keydown'"
    )
    expect(clickHandler).toContain("closest('.s-tag')")
    expect(clickHandler).toContain("focusFilter.kind === 'tag'")
    expect(clickHandler).toContain("kind: 'tag', tag: tag")
    expect(clickHandler).toContain('renderRail()')
    expect(clickHandler).toContain('event.stopPropagation()')
  })

  it('tag picker opens on t key and adds tags to the session via PUT', () => {
    const shortcuts = sourceBetween(
      "document.addEventListener('keydown'",
      '// j / k - navigate sessions up/down'
    )
    const tagPicker = sourceBetween('function openTagPicker(', 'function closeTagPicker(')
    const save = sourceBetween('async function persistTagPickerTags(', 'function addTagInPicker(')
    expect(shortcuts).toContain("event.key === 't'")
    expect(shortcuts).toContain('openTagPicker(selectedSession, selectedProject)')
    expect(tagPicker).toContain('tagPickerTags')
    expect(tagPicker).toContain('elements.tagPickerOverlay.classList.add')
    expect(save).toContain("'/api/projects/'")
    expect(save).toContain("'/sessions/'")
    expect(save).toContain("'/tags'")
    expect(save).toContain("method: 'PUT'")
    expect(save).toContain("'/api/projects/' + project.id + '/tags'")
    expect(tagPicker).toContain('openTagPickerTarget(project, session)')
  })

  it('renders an exclusive triage inbox and focuses a review bucket', () => {
    const rail = sourceBetween(
      'function countReviewBucketSessions(',
      'function buildGroupsSectionHtml('
    )
    expect(source).toContain('function primaryReviewBucket(session)')
    expect(rail).toContain('primaryReviewBucket(session)')
    expect(rail).toContain('function buildInboxSectionHtml()')
    expect(rail).toContain('data-rail-action="review"')
    expect(rail).toContain("focusFilter.kind === 'review'")
  })

  it('can save the current focus or search result as a session stack', () => {
    const saveStack = sourceBetween(
      'async function saveVisibleSessionsAsStack()',
      'if (elements.focusSaveBtn)'
    )
    expect(saveStack).toContain("requestJson('/api/org/stacks'")
    expect(saveStack).toContain("kind: 'session'")
    expect(saveStack).toContain('deriveVisibleSessionsForProject(project)')
    expect(uiSource).toContain('id="focus-save"')
  })

  it('keeps decorative project organization out of dense project rows', () => {
    const projectChips = sourceBetween(
      'function buildProjectOrgChipsHtml(',
      'function reconcileFocusFilterAfterOrgChange()'
    )
    expect(projectChips).toContain('decorative chips must not steal path')
    expect(projectChips).toContain("return ''")
    expect(projectChips).not.toContain('class="p-tag"')
    expect(projectChips).not.toContain('class="p-group"')
    expect(projectChips).not.toContain('orgData.projectGroupAssignments')
    expect(source).toContain('buildProjectOrgChipsHtml(project)')
  })

  it('keeps repeated project row metadata in fixed visual columns', () => {
    const projectRow = stylesSource.slice(
      stylesSource.indexOf('.proj-row {'),
      stylesSource.indexOf('.proj-row:hover')
    )
    const countStyles = stylesSource.slice(
      stylesSource.indexOf('.p-cnt {'),
      stylesSource.indexOf('/* ── Right panel')
    )

    expect(projectRow).toContain('display: grid;')
    expect(projectRow).toContain('grid-template-columns:')
    expect(projectRow).toContain('var(--project-row-gap)')
    expect(projectRow).not.toContain('var(--project-cloud-col)')
    expect(projectRow).toContain('var(--project-last-col)')
    expect(projectRow).toContain('var(--project-count-col)')
    expect(projectRow).not.toContain('var(--project-action-col)')
    expect(source).not.toContain('function buildProjectCloudHtml(project)')
    expect(stylesSource).not.toContain('.p-cloud {')
    expect(countStyles).toContain('font-variant-numeric: tabular-nums;')
    expect(countStyles).toContain('text-align: right;')
    expect(
      stylesSource.slice(
        stylesSource.indexOf('.p-actions {'),
        stylesSource.indexOf('.proj-row:hover .p-actions')
      )
    ).toContain('position: absolute;')
    expect(
      stylesSource.slice(
        stylesSource.indexOf('.p-actions {'),
        stylesSource.indexOf('.proj-row:hover .p-actions')
      )
    ).toContain('width: calc(var(--project-count-col) + var(--project-row-gap));')
  })

  it('uses compact project metadata columns on mobile so names keep priority', () => {
    const narrowStyles = stylesSource.slice(stylesSource.indexOf('@media (max-width: 639px)'))
    const mobileProjectRow = narrowStyles.slice(
      narrowStyles.indexOf('.proj-row {'),
      narrowStyles.indexOf('.p-actions {')
    )

    expect(stylesSource).not.toContain('--project-cloud-col: 16px;')
    expect(stylesSource).toContain('--project-last-col: 4ch;')
    expect(stylesSource).toContain('--project-count-col: 3ch;')
    expect(narrowStyles).toContain('--project-row-gap: var(--space-2xs);')
    expect(narrowStyles).toContain('--project-row-pad-inline: var(--space-md);')
    expect(narrowStyles).toContain('--project-row-pad-start: var(--space-md);')
    expect(mobileProjectRow).toContain('grid-template-columns:')
    expect(mobileProjectRow).toContain('minmax(0, 1fr)')
    expect(mobileProjectRow).not.toContain('var(--project-action-col)')
    expect(narrowStyles).toContain('.p-actions {')
    expect(narrowStyles).toContain('display: none;')
  })

  it('keeps repeated session row header metadata in fixed visual columns', () => {
    const sessionHeader = stylesSource.slice(
      stylesSource.indexOf('.s-line1 {'),
      stylesSource.indexOf('.s-line2 {')
    )

    expect(sessionHeader).toContain('display: grid;')
    expect(sessionHeader).toContain('var(--session-time-col)')
    expect(sessionHeader).toContain('--session-action-col')
    expect(sessionHeader).toContain('font-variant-numeric: tabular-nums;')
    expect(sessionHeader).toContain('text-align: right;')
  })

  it('toggles existing stack membership and supports keyboard picker navigation', () => {
    expect(source).toContain('function stackContainsOrgPickerTarget(')
    expect(source).toContain("method: 'DELETE'")
    expect(source).toContain("event.key === 'ArrowDown' || event.key === 'ArrowUp'")
    expect(source).toContain('item.click()')
  })

  it('org inspector section shows tags, group, and stack memberships', () => {
    const orgSection = sourceBetween('function buildOrgInspectorHtml(', 'function renderInspector(')
    expect(orgSection).toContain('session.tags')
    expect(orgSection).toContain('orgData.projectGroupAssignments')
    expect(orgSection).toContain('orgData.groups')
    expect(orgSection).toContain('orgData.stacks')
    expect(orgSection).toContain('data-inspector-action="session-tag"')
    expect(orgSection).toContain('insp-tag')
  })

  it('org rail fetches from /api/org in the project data refresh', () => {
    const refresh = sourceBetween(
      'async function refreshProjectData()',
      'function connectLiveUpdates()'
    )
    expect(refresh).toContain("requestJson('/api/org')")
    expect(refresh).toContain('loadedOrgData')
    expect(refresh).toContain('orgData = loadedOrgData')
    expect(refresh).toContain('reconcileFocusFilterAfterOrgChange()')
    expect(refresh).toContain('renderRail()')
    expect(refresh).toContain('renderFocusBar()')
  })

  it('rail persists collapse state in localStorage by section id', () => {
    const collapse = sourceBetween(
      'function isRailSectionCollapsed(',
      'function countStackSessionsForRail('
    )
    expect(collapse).toContain('RAIL_STORAGE_KEY')
    expect(collapse).toContain("':collapsed'")
    expect(collapse).toContain('localStorage.getItem(')
    expect(collapse).toContain('localStorage.setItem(')
    expect(collapse).toContain('localStorage.removeItem(')
  })

  it('hides empty stack and group rail sections and shows collapsed item counts', () => {
    const railBuilders = sourceBetween(
      'function buildRailSectionHtml(',
      '/** Re-renders the org rail.'
    )
    expect(railBuilders).toContain('rail-section-count')
    expect(railBuilders).toContain('visibleStacks.length === 0')
    expect(railBuilders).toContain('visibleGroups.length === 0')
    expect(railBuilders).not.toContain('rail-add')
  })

  it('clears stale group or stack focus after org membership changes', () => {
    const reconcile = sourceBetween(
      'function reconcileFocusFilterAfterOrgChange()',
      'function buildRailInfoHtml('
    )
    expect(reconcile).toContain("focusFilter.kind === 'stack'")
    expect(reconcile).toContain('countStackSessionsForRail(stack) === 0')
    expect(reconcile).toContain("focusFilter.kind === 'group'")
    expect(reconcile).toContain('countGroupProjectsForRail(focusFilter.id) === 0')
    expect(reconcile).toContain('focusFilter = null')
  })

  it('org picker calls PUT /api/projects/:id/group for group assignment', () => {
    const apply = sourceBetween(
      'async function applyOrgPickerSelection(',
      'async function removeProjectFromGroup('
    )
    expect(apply).toContain("'/api/projects/'")
    expect(apply).toContain("'/group'")
    expect(apply).toContain('groupId: itemId')
    expect(apply).toContain("method: 'PUT'")
  })

  it('org picker adds stack items via POST /api/org/stacks/:id/items', () => {
    const apply = sourceBetween(
      'async function applyOrgPickerSelection(',
      'async function removeProjectFromGroup('
    )
    expect(apply).toContain("'/api/org/stacks/'")
    expect(apply).toContain("'/items'")
    expect(apply).toContain("method: 'POST'")
  })

  it('org picker can create a group or stack and immediately apply it', () => {
    const pickerList = sourceBetween(
      'function renderOrgPickerList()',
      'async function applyOrgPickerSelection('
    )
    const create = sourceBetween(
      'async function createAndApplyOrgPickerItem(',
      'async function removeProjectFromGroup('
    )
    expect(pickerList).toContain('org-picker-create-trigger')
    expect(pickerList).toContain('org-picker-create-input')
    expect(create).toContain("mode === 'group' ? '/api/org/groups' : '/api/org/stacks'")
    expect(create).toContain('await applyOrgPickerSelection(item.id)')
  })

  it('project context menu exposes group and stack organization actions', () => {
    const projectMenu = sourceBetween(
      'function openProjectContextMenu(',
      "elements.contextMenu.addEventListener('click'"
    )
    expect(projectMenu).toContain('project-move-group')
    expect(projectMenu).toContain('project-add-stack')
    expect(projectMenu).toContain('projectCtxMoveToGroup')
    expect(projectMenu).toContain('projectCtxAddToStack')
  })

  it('HTML contains the rail, focus-bar, tag-picker, and org-picker elements', () => {
    expect(uiSource).toContain('id="rail"')
    expect(uiSource).toContain('id="focus-bar"')
    expect(uiSource).toContain('id="review-signals"')
    expect(uiSource).toContain('id="tag-picker-overlay"')
    expect(uiSource).toContain('id="tag-picker-input"')
    expect(uiSource).toContain('id="org-picker-overlay"')
    expect(uiSource).toContain('id="org-picker-list"')
  })

  it('keeps stream reconnection unconditional and independent of the link verdict', () => {
    // Gating the reconnect on the offline verdict made the live feed depend on
    // that verdict being right: one wrong "offline" and the stream never came
    // back, so the dots froze on stale state. The watcher observes only.
    const streamError = sourceBetween(
      "liveUpdatesSource.addEventListener('error'",
      'function applyLiveActivity'
    )

    expect(streamError).toContain('noteServerUnreachable()')
    expect(streamError).toContain('setTimeout(connectLiveUpdates, SSE_RECONNECT_DELAY_MS)')
    expect(streamError).not.toContain("serverLinkState === 'online'")
  })

  it('ships the offline overlay and its bootstrapped state', () => {
    expect(source).toContain('function markServerOffline()')
    expect(source).toContain('function markServerOnline()')
    expect(source).toContain("overlay.id = 'reup-offline'")
    // Registered in scripts/build-client.mjs — an unlisted segment would leave
    // every caller below referencing functions that do not exist.
    expect(source).toContain('function probeServerReachability()')
  })

  it('marks a confirmed outage without rewriting any live session state', () => {
    const offline = sourceBetween('function markServerOffline()', 'function markServerOnline()')

    // Presentation only. Clearing the active set here destroyed state the page
    // cannot refetch while the link is down, and left the feed reading idle
    // afterwards — the live data belongs to 15-data.js, not to this module.
    expect(offline).toContain("classList.add('link-lost')")
    expect(offline).toContain('STRINGS.offlineStatus')
    expect(offline).not.toContain('activeSessionIds')
    expect(offline).not.toContain('applyLiveActivity')
  })

  it('styles the offline overlay and honours reduced motion', () => {
    expect(stylesSource).toContain('#reup-offline {')
    expect(stylesSource).toContain('.ro-panel {')
    expect(stylesSource).toContain('.ro-term-err {')
    expect(stylesSource).toContain('--offline-rain-primary:')
    expect(stylesSource).toContain('@media (prefers-reduced-motion: reduce)')
  })

  it('styles contain rail section, focus bar, and tag chip rules', () => {
    expect(stylesSource).toContain('.org-rail {')
    expect(stylesSource).toContain('.rail-section {')
    expect(stylesSource).toContain('.rail-item {')
    expect(stylesSource).toContain('.focus-bar {')
    expect(stylesSource).toContain('.s-tags {')
    expect(stylesSource).toContain('.s-tag {')
    expect(stylesSource).toContain('.s-tag-overflow {')
    expect(stylesSource).toContain('.tag-picker-dlg {')
    expect(stylesSource).toContain('.org-picker-dlg {')
    expect(stylesSource).toContain('.insp-org-section {')
    expect(stylesSource).toContain('.rail-info {')
    expect(stylesSource).toContain('.review-signals {')
    expect(stylesSource).toContain('.ui-tooltip {')
    expect(stylesSource).toContain('.filter-scope-label {')
    expect(stylesSource).toContain(".filter-pill[data-filter='attention']")
  })
})
