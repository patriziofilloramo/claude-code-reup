import { resolve } from 'node:path'

import { loadProjects } from '../core/project/project-discovery.js'
import {
  buildSyncOverview,
  linkAllCloudProjectsForSync,
  linkProjectForSync,
  SyncNoCloudProjectsError,
  type SyncBulkResult,
  type SyncOperationResult,
  unlinkAllSyncedProjectsForSync,
  unlinkProjectForSync,
} from '../core/sync/sync-actions.js'
import type { Project } from '../core/session/session-model.js'
import { releaseTerminalInput } from '../tui/terminal-input.js'
import { failCommand, writeOutput } from './output.js'
import { openConfigInterface } from './open-config-interface.js'

const MANAGED_SETUP = {
  updateClaudeMd: true,
  updateGitignore: true,
  updatePermissionRules: true,
} as const

export async function linkProjectForTUI(
  projectPath: string,
  knownProjects: Project[]
): Promise<{ ok: boolean; message: string }> {
  try {
    const result = await linkProjectForSync(resolve(projectPath), {
      projects: knownProjects,
      setupOptions: MANAGED_SETUP,
    })
    return { ok: isSuccessfulResult(result), message: result.message }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export async function unlinkProjectForTUI(
  projectPath: string,
  knownProjects: Project[]
): Promise<{ ok: boolean; message: string }> {
  try {
    const result = await unlinkProjectForSync(resolve(projectPath), { projects: knownProjects })
    return { ok: isSuccessfulResult(result), message: result.message }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export async function runSyncCommand(args: string[]): Promise<void> {
  const [action, ...rest] = args
  switch (action) {
    case 'link':
      await linkSync(rest)
      return
    case 'status':
      await printSyncStatus()
      return
    case 'unlink':
      await unlinkSync(rest)
      return
    case undefined:
      await openConfigInterface({
        commandName: 'swoop sync',
        initialTab: 'Features',
        nonInteractiveAlternative:
          'use `swoop sync link <path>` or `swoop sync unlink <path>` in scripts',
      })
      return
    default:
      failCommand('usage: swoop sync [link|unlink|status] [path]')
  }
}

async function linkSync(args: string[]): Promise<void> {
  const allCloud = args.includes('--all-cloud')
  const paths = args.filter((arg) => arg !== '--all-cloud')
  if (paths.length > 1 || (allCloud && paths.length > 0)) {
    failCommand('usage: swoop sync link [project-path] [--all-cloud]')
    return
  }

  printAlphaWarning([
    'Sessions are moved into the cloud directory through a filesystem link.',
    'Swoop updates CLAUDE.md. Managed .gitignore and permission rules are only added from the Features UI.',
    'Run `swoop sync unlink <path>` to restore local-only storage.',
  ])

  const projects = await loadProjects()

  if (allCloud) {
    try {
      printBulkReport(await linkAllCloudProjectsForSync({ projects }))
    } catch (error) {
      if (error instanceof SyncNoCloudProjectsError) {
        writeOutput(
          'no cloud projects found - put projects under OneDrive, Dropbox, pCloud, Google Drive, or iCloud and try again'
        )
        return
      }
      throw error
    }
    return
  }

  if (paths.length === 0) {
    await linkInteractively(projects)
    return
  }

  printResult(await linkProjectSafely(resolve(paths[0]!), projects))
}

async function unlinkSync(args: string[]): Promise<void> {
  const all = args.includes('--all')
  const paths = args.filter((arg) => arg !== '--all')
  if (paths.length > 1 || (all && paths.length > 0)) {
    failCommand('usage: swoop sync unlink [project-path] [--all]')
    return
  }

  printAlphaWarning(['Sessions are copied from the cloud directory back to local storage.'])

  const projects = await loadProjects()

  if (all) {
    printBulkReport(await unlinkAllSyncedProjectsForSync({ projects }))
    return
  }

  if (paths.length === 0) {
    await unlinkInteractively(projects)
    return
  }

  printResult(await unlinkProjectSafely(resolve(paths[0]!), projects))
}

async function linkInteractively(projects: Project[]): Promise<void> {
  const overview = await buildSyncOverview(projects)
  const pickerProjects = [
    ...overview.cloudProjectCandidates,
    ...overview.localProjectCandidates,
  ].map((report) => projects.find((project) => project.id === report.id)!)

  if (pickerProjects.length === 0) {
    writeOutput('all projects are already synced to cloud storage')
    return
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    failCommand('a project path is required outside an interactive terminal')
    return
  }

  const note =
    overview.cloudProjectCandidates.length === 0
      ? overview.cloudRoots.length === 0
        ? 'no cloud storage detected - showing all projects'
        : 'no projects found in cloud folders - showing all projects'
      : undefined

  const { runProjectPicker } = await import('../tui/ProjectPicker.js')
  const picked = await runProjectPicker(pickerProjects, note)
  releaseTerminalInput()
  if (!picked) return

  for (const project of picked) printResult(await linkProjectSafely(project.path, projects))
}

async function unlinkInteractively(projects: Project[]): Promise<void> {
  const linkedProjects = projects.filter((project) => project.isShared)
  if (linkedProjects.length === 0) {
    writeOutput('no projects are using cloud sync')
    return
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    failCommand('a project path is required outside an interactive terminal')
    return
  }

  const { runProjectPicker } = await import('../tui/ProjectPicker.js')
  const picked = await runProjectPicker(
    linkedProjects,
    undefined,
    'Swoop SYNC UNLINK',
    'select a project to unlink'
  )
  releaseTerminalInput()
  if (!picked) return

  for (const project of picked) printResult(await unlinkProjectSafely(project.path, projects))
}

async function printSyncStatus(): Promise<void> {
  const overview = await buildSyncOverview()
  writeOutput(
    [
      `cross-device session storage: ${overview.enabled ? 'on' : 'off'}`,
      `cloud roots: ${overview.cloudRoots.length === 0 ? 'none detected' : overview.cloudRoots.join(', ')}`,
      `linked projects: ${overview.linkedProjects.length}`,
      `cloud candidates: ${overview.cloudProjectCandidates.length}`,
      `active disabled: ${overview.skippedActiveProjects.length}`,
    ].join('\n')
  )
}

async function linkProjectSafely(
  projectPath: string,
  projects: Project[]
): Promise<SyncOperationResult> {
  try {
    return await linkProjectForSync(projectPath, { projects })
  } catch (error) {
    return failureResult(projectPath, error)
  }
}

async function unlinkProjectSafely(
  projectPath: string,
  projects: Project[]
): Promise<SyncOperationResult> {
  try {
    return await unlinkProjectForSync(projectPath, { projects })
  } catch (error) {
    return failureResult(projectPath, error)
  }
}

function printAlphaWarning(lines: string[]): void {
  writeOutput(['Alpha: cross-device session storage sync.', ...lines, ''].join('\n'))
}

function printBulkReport(report: SyncBulkResult): void {
  writeOutput([report.message, ...report.results.map(formatResultLine)].join('\n'))
}

function printResult(result: SyncOperationResult): void {
  writeOutput(formatResultLine(result))
}

function formatResultLine(result: SyncOperationResult): string {
  const prefix = isSuccessfulResult(result)
    ? 'ok'
    : result.status === 'skipped-active'
      ? 'skip'
      : 'error'
  return `${prefix}: ${result.path || '(unknown project)'} - ${result.message}`
}

function failureResult(projectPath: string, error: unknown): SyncOperationResult {
  return {
    error: error instanceof Error ? error.message : String(error),
    message: error instanceof Error ? error.message : String(error),
    path: projectPath,
    status:
      error instanceof Error && error.name === 'SyncProjectActiveError'
        ? 'skipped-active'
        : 'failed',
  }
}

function isSuccessfulResult(result: SyncOperationResult): boolean {
  return !['failed', 'skipped-active'].includes(result.status)
}
