import { access, lstat, mkdir, readFile, readlink, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { APP } from '../../config/app.js'
import { log } from '../../utils/logger.js'
import { encodeProjectPath, getClaudeProjectsDirectory } from '../project/claude-paths.js'
import { pathsReferToSameLocation } from '../project/path-comparison.js'
import { loadProjects } from '../project/project-discovery.js'
import { getLiveSessionRecords } from '../session/active-sessions.js'
import type { Project } from '../session/session-model.js'
import { readUserPrefsSync } from '../user-prefs.js'
import {
  createLinkAt,
  replaceDirectoryWithLink,
  replaceLinkWithDirectory,
  repointLink,
  syncBidirectional,
} from './cloud-sync.js'
import { getOrCreateDeviceId } from './device-id.js'

export type SyncProjectKind = 'linked' | 'cloud-candidate' | 'local-candidate' | 'active-disabled'
export type SyncOperationStatus =
  | 'already-linked'
  | 'already-local'
  | 'failed'
  | 'linked'
  | 're-linked'
  | 'skipped-active'
  | 'unlinked'

export interface SyncSetupOptions {
  updateClaudeMd?: boolean
  updateGitignore?: boolean
  updatePermissionRules?: boolean
}

export interface SyncProjectReport {
  cloudOffline: boolean
  cloudPath?: string
  id: string
  isActive: boolean
  isCloudProject: boolean
  isShared: boolean
  kind: SyncProjectKind
  path: string
  unlinkedDevices: string[]
}

export interface SyncOverview {
  cloudProjectCandidates: SyncProjectReport[]
  cloudRoots: string[]
  enabled: boolean
  linkedProjects: SyncProjectReport[]
  localProjectCandidates: SyncProjectReport[]
  projects: SyncProjectReport[]
  skippedActiveProjects: SyncProjectReport[]
}

export interface SyncOperationResult {
  error?: string
  message: string
  path: string
  projectId?: string
  status: SyncOperationStatus
}

export interface SyncBulkResult {
  message: string
  results: SyncOperationResult[]
}

export const MANAGED_PERMISSION_RULES = [
  `Read(${APP.cloudMemoryDir}/**)`,
  `Write(${APP.cloudMemoryDir}/device-presence/**)`,
  `Write(${APP.cloudMemoryDir}/sync-ignored/**)`,
  `Edit(${APP.cloudMemoryDir}/memory/shared.md)`,
] as const

export class SyncProjectActiveError extends Error {
  readonly projectPath: string

  constructor(projectPath: string) {
    super('cannot change sync configuration while this project has an active session')
    this.name = 'SyncProjectActiveError'
    this.projectPath = projectPath
  }
}

export class SyncNoCloudProjectsError extends Error {
  constructor() {
    super('no projects were found under a detected cloud folder')
    this.name = 'SyncNoCloudProjectsError'
  }
}

export class SyncSetupPatchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SyncSetupPatchError'
  }
}

export async function buildSyncOverview(projects?: Project[]): Promise<SyncOverview> {
  const discoveredProjects = projects ?? (await loadProjects())
  const [cloudRoots, liveSessions] = await Promise.all([
    detectCloudRoots(),
    getLiveSessionRecords(),
  ])
  const activeProjectPaths = liveSessions
    .map((session) => session.cwd)
    .filter((cwd): cwd is string => cwd !== null)

  const reports = discoveredProjects.map((project) =>
    classifyProjectForSync(project, cloudRoots, activeProjectPaths)
  )

  return {
    cloudProjectCandidates: reports.filter((project) => project.kind === 'cloud-candidate'),
    cloudRoots,
    enabled: readUserPrefsSync().experimentalSharedSync === 'on',
    linkedProjects: reports.filter((project) => project.kind === 'linked'),
    localProjectCandidates: reports.filter((project) => project.kind === 'local-candidate'),
    projects: reports,
    skippedActiveProjects: reports.filter((project) => project.kind === 'active-disabled'),
  }
}

export function classifyProjectForSync(
  project: Project,
  cloudRoots: string[],
  activeProjectPaths: string[]
): SyncProjectReport {
  const isActive = activeProjectPaths.some((activePath) => samePath(activePath, project.path))
  const isCloudProject = isUnderCloudRoot(project.path, cloudRoots)

  return {
    cloudOffline: project.cloudOffline === true,
    cloudPath: project.cloudPath,
    id: project.id,
    isActive,
    isCloudProject,
    isShared: project.isShared,
    kind: project.isShared
      ? 'linked'
      : isActive
        ? 'active-disabled'
        : isCloudProject
          ? 'cloud-candidate'
          : 'local-candidate',
    path: project.path,
    unlinkedDevices: project.unlinkedDevices ?? [],
  }
}

export async function linkProjectForSync(
  projectPath: string,
  options: { projects?: Project[]; setupOptions?: SyncSetupOptions } = {}
): Promise<SyncOperationResult> {
  const projects = options.projects ?? (await loadProjects())
  const resolvedProjectPath = resolve(projectPath)
  const project = projects.find((candidate) => samePath(candidate.path, resolvedProjectPath))
  const cloudDir = join(resolvedProjectPath, APP.cloudMemoryDir)

  if (project?.isShared) {
    return {
      message: project.cloudPath
        ? `already linked - sessions sync with ${project.cloudPath}`
        : 'already linked',
      path: resolvedProjectPath,
      projectId: project.id,
      status: 'already-linked',
    }
  }

  await assertProjectPathIsInactive(resolvedProjectPath)

  const projectId = project?.id ?? encodeProjectPath(resolvedProjectPath)
  const localDir = join(getClaudeProjectsDirectory(), projectId)

  await mkdir(cloudDir, { recursive: true })
  await mkdir(join(cloudDir, 'memory'), { recursive: true })

  const localStat = await lstat(localDir).catch(() => null)
  let status: SyncOperationStatus = 'linked'

  if (localStat?.isSymbolicLink()) {
    const existingTarget = stripWindowsLinkPrefix(await readlink(localDir))
    if (!samePath(existingTarget, cloudDir)) {
      await syncBidirectional(existingTarget, cloudDir)
      await repointLink(localDir, existingTarget, cloudDir)
      status = 're-linked'
    }
  } else if (localStat?.isDirectory()) {
    await syncBidirectional(localDir, cloudDir)
    await replaceDirectoryWithLink(localDir, cloudDir)
  } else {
    await createLinkAt(localDir, cloudDir)
  }

  const deviceId = await getOrCreateDeviceId()
  await writeLinkedMarker(cloudDir, deviceId)
  await setupManagedProjectFiles(resolvedProjectPath, cloudDir, deviceId, {
    updateClaudeMd: true,
    updateGitignore: false,
    updatePermissionRules: false,
    ...options.setupOptions,
  })

  log.debug('sync project linked', { projectId, projectPath: resolvedProjectPath, status })
  return {
    message:
      status === 're-linked'
        ? `re-linked: ${resolvedProjectPath}`
        : `linked: ${resolvedProjectPath}`,
    path: resolvedProjectPath,
    projectId,
    status,
  }
}

export async function unlinkProjectForSync(
  projectPath: string,
  options: { projects?: Project[] } = {}
): Promise<SyncOperationResult> {
  const projects = options.projects ?? (await loadProjects())
  const resolvedProjectPath = resolve(projectPath)
  const project = projects.find((candidate) => samePath(candidate.path, resolvedProjectPath))

  if (!project?.isShared) {
    return {
      message: `not linked - ${resolvedProjectPath} already uses local-only storage`,
      path: resolvedProjectPath,
      projectId: project?.id,
      status: 'already-local',
    }
  }

  await assertProjectPathIsInactive(project.path)

  const cloudDir = join(project.path, APP.cloudMemoryDir)
  const localDir = join(getClaudeProjectsDirectory(), project.id)
  const localStat = await lstat(localDir).catch(() => null)

  if (localStat?.isSymbolicLink()) {
    const cloudTarget = stripWindowsLinkPrefix(await readlink(localDir))
    await replaceLinkWithDirectory(localDir, cloudTarget, cloudTarget)
  } else if (localStat?.isDirectory()) {
    await rm(join(localDir, APP.cloudLinkFile), { force: true })
  }

  const deviceId = await getOrCreateDeviceId()
  await removeLinkedMarker(cloudDir, deviceId)
  await removeClaudeMdSection(project.path)

  log.debug('sync project unlinked', { projectId: project.id, projectPath: project.path })
  return {
    message: `unlinked: ${project.path}`,
    path: project.path,
    projectId: project.id,
    status: 'unlinked',
  }
}

export async function linkAllCloudProjectsForSync(
  options: { projects?: Project[]; setupOptions?: SyncSetupOptions } = {}
): Promise<SyncBulkResult> {
  const projects = options.projects ?? (await loadProjects())
  const overview = await buildSyncOverview(projects)
  const syncPlan = overview.cloudProjectCandidates

  if (syncPlan.length === 0) throw new SyncNoCloudProjectsError()

  const results: SyncOperationResult[] = []
  for (const project of syncPlan) {
    results.push(
      await runOperationForReport(() =>
        linkProjectForSync(project.path, {
          projects,
          setupOptions: options.setupOptions,
        })
      )
    )
  }

  return { message: summarizeBulkResults('link all cloud projects', results), results }
}

export async function unlinkAllSyncedProjectsForSync(
  options: { projects?: Project[] } = {}
): Promise<SyncBulkResult> {
  const projects = options.projects ?? (await loadProjects())
  const overview = await buildSyncOverview(projects)
  const syncPlan = overview.linkedProjects
  const results: SyncOperationResult[] = []

  for (const project of syncPlan) {
    results.push(
      await runOperationForReport(() => unlinkProjectForSync(project.path, { projects }))
    )
  }

  return { message: summarizeBulkResults('unlink all synced projects', results), results }
}

export async function setupManagedProjectFiles(
  projectPath: string,
  cloudDir: string,
  deviceId: string,
  options: SyncSetupOptions
): Promise<void> {
  if (options.updateClaudeMd !== false) await patchClaudeMdSection(projectPath, cloudDir, deviceId)
  if (options.updateGitignore) await patchGitignoreForSync(projectPath)
  if (options.updatePermissionRules) await patchClaudeLocalSettingsForSync(projectPath)
}

export async function patchClaudeMdSection(
  projectPath: string,
  cloudDir: string,
  deviceId: string
): Promise<void> {
  const claudeMdPath = join(projectPath, 'CLAUDE.md')
  const linkedDir = join(cloudDir, 'linked')
  const presenceDir = join(cloudDir, 'device-presence')
  const ignoredDir = join(cloudDir, 'sync-ignored')
  const memoryDir = join(cloudDir, 'memory')

  const section = [
    SWOOP_MARKER_START,
    '## Swoop: Shared Session Sync',
    '',
    `Cloud storage for this project: \`${cloudDir}\``,
    `Linked from device: \`${deviceId}\``,
    '',
    'Swoop manages these project files for experimental cross-device sync:',
    '- CLAUDE.md, this bounded section only',
    '- .claude/settings.local.json, optional scoped permission rules only',
    '- .gitignore, the .claude-memory/ entry only',
    '- .claude-memory/, linked/device markers, presence files, and shared memory notes',
    '',
    'Operational protocol for Claude Code sessions:',
    '',
    '1. Run `hostname` in Bash to get this device name.',
    `2. Check whether \`${linkedDir}/HOSTNAME\` exists, replacing HOSTNAME with the real value.`,
    '3. If the marker exists, this device is linked. Read markdown files in the shared memory folder when useful.',
    `4. If the marker is missing and \`${ignoredDir}/HOSTNAME\` exists, skip the warning.`,
    `5. If both are missing, write \`${presenceDir}/HOSTNAME.json\` with device and timestamp, then tell the user to run \`swoop sync link "${projectPath}"\` or ask to ignore sync.`,
    `6. If the user asks to ignore sync, write \`ignored\` to \`${ignoredDir}/HOSTNAME\` and remove the presence JSON if it exists.`,
    `7. Append only important shared context to \`${memoryDir}/shared.md\`; do not copy prompts or transcript content.`,
    '',
    'This protocol does not bypass Claude Code permissions. Ask for normal approval whenever the tool runtime requires it.',
    SWOOP_MARKER_END,
  ].join('\n')

  await replaceBoundedSection(claudeMdPath, section)
}

export async function removeClaudeMdSection(projectPath: string): Promise<void> {
  const claudeMdPath = join(projectPath, 'CLAUDE.md')
  let content: string
  try {
    content = await readFile(claudeMdPath, 'utf8')
  } catch {
    return
  }

  const startIdx = content.indexOf(SWOOP_MARKER_START)
  const endIdx = content.indexOf(SWOOP_MARKER_END)
  if (startIdx === -1 || endIdx === -1) return

  const before = content.slice(0, startIdx).trimEnd()
  const after = content.slice(endIdx + SWOOP_MARKER_END.length).trimStart()
  const updated = before && after ? `${before}\n\n${after}` : before || after

  if (updated.trim()) await writeFile(claudeMdPath, `${updated.trimEnd()}\n`, 'utf8')
  else await rm(claudeMdPath, { force: true })
}

export async function patchGitignoreForSync(projectPath: string): Promise<void> {
  const gitignorePath = join(projectPath, '.gitignore')
  const entry = `${APP.cloudMemoryDir}/`
  let content = ''

  try {
    content = await readFile(gitignorePath, 'utf8')
  } catch {
    // Missing .gitignore is fine; create the smallest safe file.
  }

  const hasEntry = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .some((line) => line === entry || line === APP.cloudMemoryDir)
  if (hasEntry) return

  const next = content.trimEnd() ? `${content.trimEnd()}\n${entry}\n` : `${entry}\n`
  await writeFile(gitignorePath, next, 'utf8')
}

export async function patchClaudeLocalSettingsForSync(projectPath: string): Promise<void> {
  const claudeDirectory = join(projectPath, '.claude')
  const settingsPath = join(claudeDirectory, 'settings.local.json')
  let settings: Record<string, unknown> = {}

  try {
    const raw = await readFile(settingsPath, 'utf8')
    settings = JSON.parse(raw) as Record<string, unknown>
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new SyncSetupPatchError(`cannot parse ${settingsPath}`)
    }
  }

  const permissions = ensureObject(settings['permissions'], 'permissions')
  const allow = permissions['allow']
  if (allow !== undefined && !Array.isArray(allow)) {
    throw new SyncSetupPatchError('permissions.allow must be an array before Swoop can merge rules')
  }

  const allowRules = new Set((Array.isArray(allow) ? allow : []).filter(isString))
  for (const rule of MANAGED_PERMISSION_RULES) allowRules.add(rule)

  settings['permissions'] = { ...permissions, allow: [...allowRules].sort() }

  await mkdir(claudeDirectory, { recursive: true })
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
}

export async function detectCloudRoots(): Promise<string[]> {
  const home = homedir()
  const roots: string[] = []

  for (const key of ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial', 'ONEDRIVE']) {
    const value = process.env[key]
    if (value) roots.push(value)
  }

  const dropboxInfo =
    process.platform === 'win32'
      ? join(process.env['LOCALAPPDATA'] ?? home, 'Dropbox', 'info.json')
      : join(home, '.dropbox', 'info.json')
  try {
    const info = JSON.parse(await readFile(dropboxInfo, 'utf8')) as Record<string, unknown>
    for (const account of Object.values(info)) {
      const path = (account as Record<string, unknown>)?.['path']
      if (typeof path === 'string') roots.push(path)
    }
  } catch {
    /* cloud provider not installed */
  }

  const pcloudCandidates =
    process.platform === 'win32'
      ? [join(home, 'pCloud Drive'), 'P:\\']
      : [join(home, 'pCloud Drive'), join(home, 'pCloudDrive')]
  for (const candidate of pcloudCandidates) {
    if (await pathExists(candidate)) roots.push(candidate)
  }

  for (const candidate of [join(home, 'Google Drive'), join(home, 'My Drive')]) {
    if (await pathExists(candidate)) roots.push(candidate)
  }

  const icloud =
    process.platform === 'win32'
      ? join(home, 'iCloudDrive')
      : join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs')
  if (await pathExists(icloud)) roots.push(icloud)

  return [...new Set(roots.map((root) => root.replace(/[/\\]+$/, '')))]
}

export function isUnderCloudRoot(projectPath: string, roots: string[]): boolean {
  const normalizedProjectPath = projectPath.replace(/[/\\]+$/, '').toLowerCase()
  return roots.some((root) => {
    const normalizedRoot = root.replace(/[/\\]+$/, '').toLowerCase()
    return (
      normalizedProjectPath === normalizedRoot ||
      normalizedProjectPath.startsWith(`${normalizedRoot}/`) ||
      normalizedProjectPath.startsWith(`${normalizedRoot}\\`)
    )
  })
}

async function runOperationForReport(
  operation: () => Promise<SyncOperationResult>
): Promise<SyncOperationResult> {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof SyncProjectActiveError) {
      return {
        error: error.message,
        message: error.message,
        path: error.projectPath,
        status: 'skipped-active',
      }
    }
    return {
      error: error instanceof Error ? error.message : String(error),
      message: error instanceof Error ? error.message : String(error),
      path: '',
      status: 'failed',
    }
  }
}

function summarizeBulkResults(action: string, results: SyncOperationResult[]): string {
  const linked = results.filter((result) => result.status === 'linked').length
  const relinked = results.filter((result) => result.status === 're-linked').length
  const unlinked = results.filter((result) => result.status === 'unlinked').length
  const skipped = results.filter((result) => result.status === 'skipped-active').length
  const failed = results.filter((result) => result.status === 'failed').length
  return `${action}: ${linked + relinked + unlinked} changed, ${skipped} skipped active, ${failed} failed`
}

async function assertProjectPathIsInactive(projectPath: string): Promise<void> {
  const liveSessions = await getLiveSessionRecords()
  if (liveSessions.some((session) => session.cwd !== null && samePath(session.cwd, projectPath))) {
    throw new SyncProjectActiveError(projectPath)
  }
}

async function replaceBoundedSection(filePath: string, section: string): Promise<void> {
  let existing = ''
  try {
    existing = await readFile(filePath, 'utf8')
  } catch {
    /* missing file is created below */
  }

  const startIdx = existing.indexOf(SWOOP_MARKER_START)
  const endIdx = existing.indexOf(SWOOP_MARKER_END)

  const updated =
    startIdx !== -1 && endIdx !== -1
      ? existing.slice(0, startIdx) + section + existing.slice(endIdx + SWOOP_MARKER_END.length)
      : existing
        ? `${existing.trimEnd()}\n\n${section}\n`
        : `${section}\n`

  await writeFile(filePath, updated, 'utf8')
}

async function writeLinkedMarker(cloudDir: string, deviceId: string): Promise<void> {
  const linkedDir = join(cloudDir, 'linked')
  await mkdir(linkedDir, { recursive: true })
  await writeFile(join(linkedDir, deviceId), JSON.stringify({ device: deviceId }), 'utf8')
  await rm(join(cloudDir, 'device-presence', `${deviceId}.json`), { force: true })
}

async function removeLinkedMarker(cloudDir: string, deviceId: string): Promise<void> {
  await rm(join(cloudDir, 'linked', deviceId), { force: true })
}

async function pathExists(path: string): Promise<boolean> {
  return access(path)
    .then(() => true)
    .catch(() => false)
}

function samePath(leftPath: string, rightPath: string): boolean {
  return pathsReferToSameLocation(leftPath, rightPath)
}

function stripWindowsLinkPrefix(path: string): string {
  return path.replace(/^\\\\\?\\/, '')
}

function ensureObject(value: unknown, label: string): Record<string, unknown> {
  if (value === undefined) return {}
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  throw new SyncSetupPatchError(`${label} must be an object before Swoop can merge settings`)
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

const SWOOP_MARKER_START = '<!-- swoop:sync:start -->'
const SWOOP_MARKER_END = '<!-- swoop:sync:end -->'
