import { access, cp, lstat, mkdir, readdir, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { encodeProjectPath, getClaudeProjectsDirectory } from '../core/claude-paths.js'
import { loadProjects } from '../core/project-discovery.js'
import type { Project } from '../core/session-model.js'
import { releaseTerminalInput } from '../tui/terminal-input.js'
import { log } from '../utils/logger.js'
import { failCommand, writeOutput } from './output.js'

const SHARED_DIR = '.claude-memory'
/** Marker file written inside a local fallback directory to record the original junction target. */
const OFFLINE_MARKER = '.ccm-offline'

export async function runMemoryCommand(args: string[]): Promise<void> {
  const [action, ...rest] = args
  switch (action) {
    case 'link':
      await linkMemory(rest)
      return
    case 'unlink':
      await unlinkMemory(rest)
      return
    case 'status':
    case undefined:
      await showMemoryStatus()
      return
    default:
      failCommand('usage: ccm memory [link|unlink|status] [path]')
  }
}

// ---------------------------------------------------------------------------
// link
// ---------------------------------------------------------------------------

async function linkMemory(args: string[]): Promise<void> {
  if (args.length > 1) { failCommand('usage: ccm link [project-path]'); return }

  const projects = await loadProjects()

  // No path given — show interactive picker filtered to cloud-synced projects
  if (args.length === 0) {
    const linkable = projects.filter((p) => !p.isShared)
    if (linkable.length === 0) {
      writeOutput('all projects are already using shared storage')
      return
    }
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      failCommand('a project path is required outside an interactive terminal')
      return
    }
    const roots = await detectCloudRoots()
    const cloudProjects = roots.length > 0
      ? linkable.filter((p) => isUnderCloudRoot(p.path, roots))
      : []
    const pickerProjects = cloudProjects.length > 0 ? cloudProjects : linkable
    const note = cloudProjects.length === 0 && roots.length === 0
      ? 'no cloud storage detected — showing all projects'
      : cloudProjects.length === 0
        ? 'no projects found in cloud folders — showing all projects'
        : undefined
    const { runProjectPicker } = await import('../tui/ProjectPicker.js')
    const picked = await runProjectPicker(pickerProjects, note)
    releaseTerminalInput()
    if (!picked) return
    for (const project of picked) await linkProjectSafe(project.path, projects)
    return
  }

  await linkProjectSafe(resolve(args[0]), projects)
}

async function linkProjectSafe(projectPath: string, projects: Project[]): Promise<void> {
  try {
    await linkProject(projectPath, projects)
  } catch (error) {
    writeOutput(`✗ ${projectPath}\n  ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function linkProject(projectPath: string, projects: Project[]): Promise<void> {
  const project = projects.find((p) => samePath(p.path, projectPath))
  const sharedDir = join(projectPath, SHARED_DIR)

  if (project?.isShared) {
    writeOutput(`already linked — ${projectPath} uses shared storage at:\n  ${sharedDir}`)
    return
  }

  // Compute the project storage directory. Use the known ID when sessions exist
  // locally; fall back to encoding the path for a fresh device that has no
  // local sessions but has a synced .claude-memory/ from another machine.
  const projectId = project?.id ?? encodeProjectPath(projectPath)
  const projectDir = join(getClaudeProjectsDirectory(), projectId)

  // Ensure .claude-memory/ exists in the project root (idempotent).
  await mkdir(sharedDir, { recursive: true })

  // Migrate any existing local sessions into the shared directory first.
  // Skip symlinks/junctions — they are stale artifacts from broken previous runs.
  if (project && !project.isShared) {
    for (const name of await readdir(projectDir).catch(() => [])) {
      const entryStat = await lstat(join(projectDir, name)).catch(() => null)
      if (!entryStat || entryStat.isSymbolicLink()) continue
      await cp(join(projectDir, name), join(sharedDir, name), { recursive: true, force: true })
    }
    // Remove the real directory before creating the junction in its place.
    await rm(projectDir, { recursive: true, force: true })
  }

  await createLink(sharedDir, projectDir)

  writeOutput(
    [
      `✓ linked: ${projectPath}`,
      `  sessions → ${sharedDir}`,
    ].join('\n')
  )
}

// ---------------------------------------------------------------------------
// unlink
// ---------------------------------------------------------------------------

async function unlinkMemory(args: string[]): Promise<void> {
  if (args.length > 1) { failCommand('usage: ccm unlink [project-path]'); return }

  const projects = await loadProjects()

  if (args.length === 0) {
    const linked = projects.filter((p) => p.isShared)
    if (linked.length === 0) {
      writeOutput('no projects are using shared storage')
      return
    }
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      failCommand('a project path is required outside an interactive terminal')
      return
    }
    const { runProjectPicker } = await import('../tui/ProjectPicker.js')
    const picked = await runProjectPicker(linked, undefined, 'CCM MEMORY UNLINK', 'select a project to unlink')
    releaseTerminalInput()
    if (!picked) return
    for (const project of picked) await unlinkProjectSafe(project.path, projects)
    return
  }

  await unlinkProjectSafe(resolve(args[0]), projects)
}

async function unlinkProjectSafe(projectPath: string, projects: Project[]): Promise<void> {
  try {
    await unlinkProject(projectPath, projects)
  } catch (error) {
    writeOutput(`✗ ${projectPath}\n  ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function unlinkProject(projectPath: string, projects: Project[]): Promise<void> {
  const sharedDir = join(projectPath, SHARED_DIR)
  const project = projects.find((p) => samePath(p.path, projectPath))

  if (!project?.isShared) {
    writeOutput(`not linked — ${projectPath} already uses local storage`)
    return
  }

  const projectDir = join(getClaudeProjectsDirectory(), project.id)

  // Remove only the junction/symlink; the shared directory and its contents are untouched.
  await removeLink(projectDir)

  // Restore sessions into a real local directory.
  await mkdir(projectDir, { recursive: true })
  for (const name of await readdir(sharedDir).catch(() => [])) {
    await cp(join(sharedDir, name), join(projectDir, name), { recursive: true, force: true })
  }

  writeOutput(
    [
      `✓ unlinked: ${projectPath}`,
      ``,
      `  sessions restored to local storage.`,
      `  note: ${sharedDir} still exists — remove it manually if no longer needed.`,
    ].join('\n')
  )
}

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

async function showMemoryStatus(): Promise<void> {
  const projects = await loadProjects()
  const shared = projects.filter((p) => p.isShared)

  if (shared.length === 0) {
    writeOutput(
      `${projects.length} project(s) found, none using shared storage.\n` +
        `Run \`ccm memory link [path]\` to share sessions across devices.`
    )
    return
  }

  const lines = [`${shared.length}/${projects.length} project(s) using shared storage:`, '']
  for (const p of shared) {
    lines.push(`  ⊙  ${p.path}`)
    lines.push(`       → ${join(p.path, SHARED_DIR)}`)
  }
  writeOutput(lines.join('\n'))
}

// ---------------------------------------------------------------------------
// Cloud root detection
// ---------------------------------------------------------------------------

async function pathExists(p: string): Promise<boolean> {
  return access(p).then(() => true).catch(() => false)
}

async function detectCloudRoots(): Promise<string[]> {
  const home = homedir()
  const roots: string[] = []

  // OneDrive — env vars set by the client on Windows and macOS
  for (const key of ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial', 'ONEDRIVE']) {
    const v = process.env[key]
    if (v) roots.push(v)
  }

  // Dropbox — reads its own config file
  const dropboxInfo = process.platform === 'win32'
    ? join(process.env['LOCALAPPDATA'] ?? home, 'Dropbox', 'info.json')
    : join(home, '.dropbox', 'info.json')
  try {
    const info = JSON.parse(await readFile(dropboxInfo, 'utf8')) as Record<string, unknown>
    for (const account of Object.values(info)) {
      const p = (account as Record<string, unknown>)?.['path']
      if (typeof p === 'string') roots.push(p)
    }
  } catch { /* not installed */ }

  // pCloud — no config file; check common mount locations
  const pcloudCandidates = process.platform === 'win32'
    ? [join(home, 'pCloud Drive'), 'P:\\']
    : [join(home, 'pCloud Drive'), join(home, 'pCloudDrive')]
  for (const p of pcloudCandidates) {
    if (await pathExists(p)) roots.push(p)
  }

  // Google Drive
  for (const p of [join(home, 'Google Drive'), join(home, 'My Drive')]) {
    if (await pathExists(p)) roots.push(p)
  }

  // iCloud
  const icloud = process.platform === 'win32'
    ? join(home, 'iCloudDrive')
    : join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs')
  if (await pathExists(icloud)) roots.push(icloud)

  // Deduplicate
  return [...new Set(roots.map((r) => r.replace(/[/\\]+$/, '')))]
}

function isUnderCloudRoot(projectPath: string, roots: string[]): boolean {
  const norm = projectPath.replace(/[/\\]+$/, '').toLowerCase()
  return roots.some((r) => norm.startsWith(r.toLowerCase() + '/') || norm.startsWith(r.toLowerCase() + '\\') || norm === r.toLowerCase())
}

// ---------------------------------------------------------------------------
// Platform helpers
// ---------------------------------------------------------------------------

async function createLink(target: string, linkPath: string): Promise<void> {
  if (process.platform === 'win32') {
    // Directory junctions require no elevation and survive across reboots.
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    await promisify(execFile)('cmd', ['/c', 'mklink', '/J', linkPath, target])
  } else {
    await symlink(target, linkPath)
  }
}

async function removeLink(linkPath: string): Promise<void> {
  if (process.platform === 'win32') {
    // rmdir without /s removes only the junction reparse point, not the target.
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    await promisify(execFile)('cmd', ['/c', 'rmdir', linkPath])
  } else {
    const { unlink } = await import('node:fs/promises')
    await unlink(linkPath)
  }
}

// ---------------------------------------------------------------------------
// Offline guard — runs at ccm startup to protect against data loss when the
// cloud drive that backs a junction/symlink is temporarily unavailable.
// ---------------------------------------------------------------------------

/**
 * Scans all project storage directories and:
 * - If a junction/symlink target is unreachable (cloud offline): replaces the
 *   junction with a real local directory so Claude Code can still write sessions.
 *   A `.ccm-offline` marker records the original target for later restoration.
 * - If a local directory carries a `.ccm-offline` marker and the cloud target is
 *   now reachable again: syncs locally-written sessions back to cloud storage and
 *   restores the junction.
 *
 * Designed to be called silently at startup — only logs; never throws.
 */
export async function guardOfflineLinks(): Promise<void> {
  const projectsDir = getClaudeProjectsDirectory()
  const entries = await readdir(projectsDir, { withFileTypes: true }).catch(() => null)
  if (!entries) return

  for (const entry of entries) {
    const projectDir = join(projectsDir, entry.name)

    // Real local directory — check for offline fallback marker (cloud may be back).
    if (!entry.isSymbolicLink()) {
      const markerPath = join(projectDir, OFFLINE_MARKER)
      let savedTarget: string | null = null
      try {
        savedTarget = (await readFile(markerPath, 'utf8')).trim()
      } catch {
        continue // No marker — normal local project, nothing to do.
      }
      if (savedTarget) await tryRestoreFromFallback(projectDir, savedTarget)
      continue
    }

    // Junction / symlink — check if the target is reachable.
    const online = await isLinkTargetAccessible(projectDir)
    if (!online) await activateLocalFallback(projectDir)
  }
}

/**
 * Checks if following a junction/symlink reaches an accessible path.
 * Uses readdir rather than access because some cloud drivers (pCloud) return
 * success from access() on unmounted drives but fail on actual I/O.
 */
async function isLinkTargetAccessible(linkPath: string): Promise<boolean> {
  try {
    await readdir(linkPath)
    return true
  } catch {
    return false
  }
}

/**
 * Replaces an offline junction with a real local directory so Claude Code
 * can still write sessions. Records the original target in `.ccm-offline`.
 */
async function activateLocalFallback(junctionPath: string): Promise<void> {
  let target: string
  try {
    target = await readlink(junctionPath)
  } catch {
    return // Can't read the target path — skip.
  }
  try {
    await removeLink(junctionPath)
    await mkdir(junctionPath, { recursive: true })
    await writeFile(join(junctionPath, OFFLINE_MARKER), target, 'utf8')
    log.debug('guardOfflineLinks: cloud offline — switched to local fallback', junctionPath)
  } catch (error) {
    log.debug('guardOfflineLinks: failed to activate fallback', junctionPath, error)
  }
}

/**
 * When cloud storage comes back online: syncs locally-written sessions to the
 * cloud directory, removes the local fallback, and restores the junction.
 */
async function tryRestoreFromFallback(localDir: string, cloudTarget: string): Promise<void> {
  // Verify the cloud target is actually reachable before touching anything.
  try {
    await readdir(cloudTarget)
  } catch {
    return // Still offline.
  }

  // Copy any locally-written sessions to cloud storage.
  for (const name of await readdir(localDir).catch(() => [])) {
    if (name === OFFLINE_MARKER) continue
    await cp(join(localDir, name), join(cloudTarget, name), { recursive: true, force: true }).catch(
      (error) => log.debug('guardOfflineLinks: sync error', name, error)
    )
  }

  // Restore the junction.
  try {
    await rm(localDir, { recursive: true, force: true })
    await createLink(cloudTarget, localDir)
    log.debug('guardOfflineLinks: cloud restored — junction reinstated', localDir)
  } catch (error) {
    log.debug('guardOfflineLinks: failed to restore junction', localDir, error)
    // Sessions remain safe in localDir; user can run `ccm link` to retry.
  }
}

function samePath(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/[/\\]+$/, '')
  // Windows and macOS (default HFS+/APFS) are case-insensitive; Linux is not.
  return process.platform === 'linux'
    ? norm(a) === norm(b)
    : norm(a).toLowerCase() === norm(b).toLowerCase()
}
