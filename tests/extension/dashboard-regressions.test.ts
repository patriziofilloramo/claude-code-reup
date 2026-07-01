import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const source = readFileSync('extension/src/dashboard.ts', 'utf8')
const resumeTargetSource = readFileSync('extension/src/resume-target.ts', 'utf8')
const extensionSource = readFileSync('extension/src/extension.ts', 'utf8')
const inspectorSource = readFileSync('extension/src/session-detail.ts', 'utf8')
const pickerSource = readFileSync('extension/src/resume-picker.ts', 'utf8')
const searchSource = readFileSync('extension/src/session-search.ts', 'utf8')
const manifest = JSON.parse(readFileSync('extension/package.json', 'utf8')) as {
  activationEvents: string[]
  contributes: {
    commands: Array<{ command: string }>
    menus: { 'view/title': Array<{ command: string; group: string }> }
  }
}

describe('full-screen dashboard guardrails', () => {
  it('declares a primary singleton dashboard command', () => {
    expect(manifest.contributes.commands).toContainEqual(
      expect.objectContaining({ command: 'reup.openDashboard' })
    )
    expect(manifest.activationEvents).toContain('onCommand:reup.openDashboard')
    expect(manifest.contributes.menus['view/title'][0]).toEqual(
      expect.objectContaining({ command: 'reup.openDashboard' })
    )
    expect(extensionSource).toContain('let dashboard: ReupDashboard | null = null')
    expect(source).toContain('this.panel.reveal(vscode.ViewColumn.One)')
  })

  it('keeps title-bar actions compact and exposes archived sessions in the dashboard', () => {
    expect(manifest.contributes.commands).toContainEqual(
      expect.objectContaining({ command: 'reup.resumeHere', icon: '$(play)' })
    )
    expect(manifest.contributes.commands).toContainEqual(
      expect.objectContaining({ command: 'reup.resumeSession', icon: '$(history)' })
    )
    expect(source).toContain("focusNav('archived','Archived'")
    expect(source).toContain('data-filter="archived"')
    expect(source).toContain('includeArchived: true')
  })

  it('keeps the webview local, stateful, progressive, and race-safe', () => {
    expect(source).toContain("default-src 'none'")
    expect(source).toContain('retainContextWhenHidden: true')
    expect(source).toContain('vscode.setState')
    expect(source).toContain('previewRequestId')
    expect(source).toContain('searchRequestId')
    expect(source).toContain('loadPreview')
    expect(source).toContain('searchTranscriptContent')
    expect(source).toContain('isDashboardMessage')
  })

  it('provides branded project and session context menus', () => {
    expect(source).toContain('brand-subtitle">claude code')
    expect(source).toContain('project-kicker')
    expect(source).toContain('showProjectMenu')
    expect(source).toContain('showSessionMenu')
    expect(source).toContain('copyProjectPath')
    expect(source).toContain('openProject')
  })

  it('keeps project rail names primary with a stable count column and no sync badge', () => {
    expect(source).not.toContain("import { projectMemoryDescription } from './formatting.js'")
    expect(source).not.toContain('const PROJECT_MEMORY_DESCRIPTIONS')
    expect(source).not.toContain('--project-memory-col:16px')
    expect(source).toContain('--project-count-col:3ch')
    expect(source).toContain(
      '.project{display:grid;grid-template-columns:minmax(0,1fr) var(--project-count-col)}'
    )
    expect(source).toContain(`<span class="name">'+esc(p.name)+'</span><span class="count">`)
    expect(source).not.toContain('function projectCloud(p)')
    expect(source).not.toContain('class="cloud empty"')
    expect(source).not.toContain("PROJECT_MEMORY_DESCRIPTIONS[status]||''")
    expect(source).not.toContain("?'☁':'□'")
  })

  it('keeps projects primary and focus controls secondary in the extension rail', () => {
    const rail = source.slice(source.indexOf('function rail()'), source.indexOf('function hero()'))

    expect(rail).toContain(
      'return \'<aside class="rail"><div class="section-title">Projects</div>\'+projectRows+focusBlock+\'</aside>\''
    )
    expect(rail).toContain('focusBlock=focusRows?\'<div class="rail-focus"')
    expect(source).toContain(
      '.rail-focus{margin-top:10px;padding-top:8px;border-top:1px solid var(--line)}'
    )
    expect(source).toContain('.rail-focus .nav{color:var(--muted)}')
  })

  it('omits zero-count focus rows and hides the focus group when empty', () => {
    const rail = source.slice(source.indexOf('function rail()'), source.indexOf('function hero()'))

    expect(rail).toContain('secondaryFocusRows=[')
    expect(rail).toContain("focusNav('workspace','Current workspace',workspaceCount)")
    expect(rail).toContain("focusNav('active','Active now',model.summary.active)")
    expect(rail).toContain("focusNav('attention','Needs attention',model.summary.attention)")
    expect(rail).toContain("focusNav('archived','Archived',model.summary.archived)")
    expect(rail).toContain('focusBlock=focusRows?\'<div class="rail-focus"')
    expect(source).toContain(
      "function focusNav(id,label,count){return count>0?nav(id,label,count):''}"
    )
  })

  it('keeps the All sessions reset stable while any focus row is visible', () => {
    const rail = source.slice(source.indexOf('function rail()'), source.indexOf('function hero()'))

    expect(rail).toContain("showAll=allCount>0&&(secondaryFocusRows||project||filter!=='all')")
    expect(rail).toContain(
      "focusRows=(showAll?nav('all','All sessions',allCount):'')+secondaryFocusRows"
    )
    expect(rail).not.toContain("project||filter!=='all'?nav('all','All sessions',allCount):''")
  })

  it('uses one shared brand lockup for loading and the dashboard header', () => {
    expect(source).toContain("from '../../src/brand.js'")
    expect(source).not.toContain("from './brand.js'")
    expect(source).toContain('renderReupMarkSvg')
    expect(source).toContain('function renderBrandMarkup()')
    expect(source).toContain('${brandMarkup}<p>Mapping your Claude work')
    expect(source).toContain("'+BRAND_MARKUP+'")
    expect(source).not.toContain('aria-hidden="true">✱</span>')
    expect(source.match(/class="brand-title">Reup/g)).toHaveLength(1)
  })

  it('shows and polls live usage by default only while visible', () => {
    expect(source).toContain('readLiveUsageSummary')
    expect(source).toContain('APP.usagePollMs')
    expect(source).toContain('startUsagePolling')
    expect(source).toContain('stopUsagePolling')
    expect(source).toContain("m.type==='usage'")
    expect(source).toContain("usageLimit('5h'")
    expect(source).toContain("usageLimit('7d'")
    expect(source).toContain('credits on')
  })

  it('keeps the search caret stable and the deep-search button inside its field', () => {
    expect(source).toContain('persist();requestMetadataSearch()')
    expect(source).toContain('filterDashboardSessions(')
    expect(source).toContain("post('metadataSearch'")
    expect(source).toContain('function renderSearchResults()')
    expect(source).not.toContain('metadataSessionIds=null;if(selected')
    expect(source).not.toContain("document.getElementById('search').focus()")
    expect(source).not.toContain('function parseQuery(')
    expect(source).toContain('.search{flex:1;max-width:700px;position:relative;height:36px}')
    expect(source).toContain('.deep{position:absolute;right:4px;top:4px;height:28px')
  })

  it('preserves focus, caret, scroll, and explicit deselection across automatic updates', () => {
    expect(source).toContain('function captureUiState()')
    expect(source).toContain('function restoreUiState(state)')
    expect(source).toContain('element.focus({preventScroll:true})')
    expect(source).toContain('element.setSelectionRange(focus.start,focus.end)')
    expect(source).toContain("for(const name of ['rail','sessions','detail'])")
    expect(source).toContain('if(firstModel&&!hadSavedSelection&&!selected&&model.continueNow)')
    expect(source).toContain("Object.prototype.hasOwnProperty.call(saved,'selected')")
    expect(source).not.toContain('if(!selected&&model.continueNow)')
    expect(source).toContain('renderPreservingUiState()')
  })

  it('shows the full project path in the detail panel', () => {
    expect(source).toContain('attr(s.projectPath)')
    expect(source).toContain('esc(s.projectPath)')
    expect(source).toContain('overflow-wrap:anywhere')
  })

  it('keeps dashboard controls actionable and visibly responsive', () => {
    expect(source).toContain('<progress class="usage-bar"')
    expect(source).not.toContain('class="usage-fill" style=')
    expect(source).toContain('.fact.active{color:var(--good)}')
    expect(source).toContain('<span class="fact active">')
    expect(source).not.toContain('style="color:var(--good)"')
    expect(source).toContain('display:flex;align-items:center;justify-content:center')
    expect(source).toContain("setRefreshState(true);post('refresh')")
    expect(source).toContain("type: 'refreshState'")
    expect(source).toContain('if(!menu.contains(event.target))closeMenu()')
  })

  it('uses shared Reup semantic theme tokens with a visible usage accent', () => {
    expect(source).toContain('resolveTheme(')
    expect(source).toContain('process.env[APP.themeEnvVar]')
    expect(source).toContain('process.env[APP.legacyThemeEnvVar]')
    expect(source).toContain('getStoredThemeName()')
    expect(source).toContain('--reup-accent:${theme.accent}')
    expect(source).toContain('--good:${theme.green}')
    expect(source).toContain('--accent:var(--vscode-focusBorder')
    expect(source).toContain('appearance:none;opacity:1')
    expect(source).toContain('var(--reup-accent)')
  })

  it('offers one validated remembered resume policy across every extension surface', () => {
    expect(source).toContain('resumeCapabilities')
    expect(source).toContain('function resumeButtons(')
    expect(source).toContain('function showResumeMenu(')
    expect(source).toContain("add('✻','Claude Code Extension','claude-extension')")
    expect(source).toContain("add('>_','VS Code Terminal','terminal')")
    expect(source).toContain('Remember my choice')
    expect(source).toContain('remember:remember.checked')
    expect(source).toContain('preferredTarget:null')
    expect(resumeTargetSource).toContain("const CLAUDE_EXTENSION_ID = 'anthropic.claude-code'")
    expect(resumeTargetSource).toContain(
      "const CLAUDE_RESUME_COMMAND = 'claude-vscode.editor.open'"
    )
    expect(resumeTargetSource).toContain('async function openSessionInClaudeExtension')
    expect(resumeTargetSource).toContain('vscode.ViewColumn.Active')
    expect(resumeTargetSource).not.toContain('executeCommand(CLAUDE_RESUME_COMMAND, session.id)')
    expect(resumeTargetSource).toContain('falling back to terminal')
    expect(resumeTargetSource).toContain('context.globalState.update')
    expect(resumeTargetSource).toContain('isResumeTarget(storedValue)')
    expect(resumeTargetSource).toContain("remember ? 'check' : 'circle-large-outline'")
    expect(resumeTargetSource).toContain('if (remember) await this.setPreferredTarget')
    expect(resumeTargetSource).toContain("if (session.advice.code === 'already-active')")
    expect(source).toContain("'Open active session'")
    expect(extensionSource).toContain('const resumeService = new SessionResumeService')
    expect(extensionSource).toContain('resumeService.resume(sessionNode.session)')
    expect(inspectorSource).toContain('this.resumeService.resume(current)')
    expect(pickerSource).toContain('.resume(selected.session)')
    expect(searchSource).toContain('.resume(session)')
    expect(extensionSource).not.toContain('resumeSessionInTerminal')
    expect(inspectorSource).not.toContain('resumeSessionInTerminal')
    expect(pickerSource).not.toContain('resumeSessionInTerminal')
    expect(searchSource).not.toContain('resumeSessionInTerminal')
  })

  it('opens onboarding once per dashboard generation rather than every patch release', () => {
    expect(extensionSource).toContain("const key = 'reup.dashboard.onboardingGeneration'")
    expect(extensionSource).toContain('const onboardingGeneration = 1')
    expect(extensionSource).not.toContain('reup.dashboard.onboardingVersion')
  })
})
