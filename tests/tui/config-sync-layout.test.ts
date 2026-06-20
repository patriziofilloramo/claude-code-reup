import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const CONFIG_APP_PATH = join(process.cwd(), 'src', 'tui', 'ConfigApp.tsx')

describe('cross-device configuration layout', () => {
  it('groups projects into collapsed linked, local, and remote sections', async () => {
    const source = await readFile(CONFIG_APP_PATH, 'utf8')

    expect(source).toContain("type SyncSection = 'linked' | 'local' | 'remote'")
    expect(source).toContain('configSyncLinkedProjectsTitle')
    expect(source).toContain('configSyncUnlinkedProjectsTitle')
    expect(source).toContain('configSyncRemoteProjectsTitle')
    expect(source).toContain('expandedSyncSections')
    expect(source).toContain('SyncProjectSection')
    expect(source).toContain("linked: shouldExpand && item.section === 'linked'")
    expect(source).toContain("remote: shouldExpand && item.section === 'remote'")
  })

  it('starts remote discovery on tab entry and shows a spinner', async () => {
    const source = await readFile(CONFIG_APP_PATH, 'utf8')

    expect(source).toContain("if (currentTab === 'Features') void refreshProjectsAndSync(true)")
    expect(source).toContain('SPINNER_FRAMES')
    expect(source).toContain('configSyncRemoteScanning')
    expect(source).toContain('remoteScanning')
    expect(source).toContain("const SPINNER_FRAMES = ['|', '/', '-', '\\\\']")
    expect(source).toContain("{expanded ? '[-]' : '[+]'}")
    expect(source).not.toMatch(/â|Ã|Â/)
  })

  it('derives the current-project action from the reusable sync report', async () => {
    const source = await readFile(CONFIG_APP_PATH, 'utf8')

    expect(source).toContain('pathsReferToSameLocation(project.path, process.cwd())')
    expect(source).toContain('getCurrentProjectSyncAction(currentSyncProject)')
    expect(source).toContain('configSyncUnlinkCurrent')
    expect(source).toContain('configSyncCurrentLinkedActive')
  })

  it('pushes refreshed sync projects back into the main TUI', async () => {
    const source = await readFile(CONFIG_APP_PATH, 'utf8')
    const appSource = await readFile(join(process.cwd(), 'src', 'tui', 'App.tsx'), 'utf8')

    expect(source).toContain('onProjectsChanged?: (projects: Project[]) => void')
    expect(source).toContain('onProjectsChanged?.(updatedProjects)')
    expect(appSource).toContain('onProjectsChanged={setProjects}')
  })

  it('offers recoverable forget only for eligible local Project Memory', async () => {
    const source = await readFile(CONFIG_APP_PATH, 'utf8')
    const actionMenu = await readFile(
      join(process.cwd(), 'src', 'tui', 'components', 'ProjectActionMenu.tsx'),
      'utf8'
    )

    expect(source).toContain("if (input === 'f' && !busy)")
    expect(source).toContain('forgetProjectForSync(item.project.path')
    expect(source).toContain('!item.project.cloudPath')
    expect(actionMenu).toContain("'forget-project'")
    expect(actionMenu).toContain('project.cloudPath && !project.isShared')
  })

  it('shows actions on card focus and expands legend details on legend focus', async () => {
    const source = await readFile(CONFIG_APP_PATH, 'utf8')

    expect(source).toContain('cursor === 1')
    expect(source).toContain('configSyncFeatureDescriptionExpanded')
    expect(source).toContain("items.push({ kind: 'legend' })")
    expect(source).toContain('const syncCardFocused = cursor >= 1')
    expect(source).toContain('syncEnabled && syncCardFocused')
    expect(source).toContain('<CloudIconLegend focused={false} />')
    expect(source).toContain('focused={cursor === legendCursor}')
    expect(source).not.toContain('setSyncLegendExpanded')
  })
})
