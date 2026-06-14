import { access, cp, lstat, mkdir, readdir, readFile, readlink, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { APP } from '../config/app.js'
import { syncBidirectional } from '../core/cloud-sync.js'
import { encodeProjectPath, getClaudeProjectsDirectory } from '../core/claude-paths.js'
import { loadProjects } from '../core/project-discovery.js'
import type { Project } from '../core/session-model.js'
import { releaseTerminalInput } from '../tui/terminal-input.js'
import { failCommand, writeOutput } from './output.js'

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
    // Include legacy junctions (isShared=true, no cloudPath) so users can migrate them.
    const linkable = projects.filter((p) => !p.cloudPath)
    if (linkable.length === 0) {
      writeOutput('all projects are already using local-first cloud sync')
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
  const cloudDir = join(projectPath, APP.cloudMemoryDir)

  if (project?.cloudPath) {
    writeOutput(`already linked — ${projectPath} syncs sessions with:\n  ${project.cloudPath}`)
    return
  }

  const projectId = project?.id ?? encodeProjectPath(projectPath)
  const localDir = join(getClaudeProjectsDirectory(), projectId)

  // If the local dir is currently a legacy junction, convert it to a real dir
  // so it can hold the .ccm-link file without routing writes to the cloud.
  const localStat = await lstat(localDir).catch(() => null)
  if (localStat?.isSymbolicLink()) {
    let junctionTarget = await readlink(localDir).catch(() => cloudDir)
    if (junctionTarget.startsWith('\\\\?\\')) junctionTarget = junctionTarget.slice(4)
    await removeLink(localDir)
    await mkdir(localDir, { recursive: true })
    await syncBidirectional(localDir, junctionTarget).catch(() => {})
  }

  // Ensure both directories exist.
  await mkdir(cloudDir, { recursive: true })
  await mkdir(localDir, { recursive: true })

  // Copy any existing local sessions into the cloud dir so the other device
  // can pick them up. Skip .ccm-link itself and any symbolic links.
  for (const name of await readdir(localDir).catch(() => [])) {
    if (name === APP.cloudLinkFile) continue
    const entryStat = await lstat(join(localDir, name)).catch(() => null)
    if (!entryStat || entryStat.isSymbolicLink()) continue
    await cp(join(localDir, name), join(cloudDir, name), { recursive: true, force: true })
  }

  // Write the .ccm-link marker and pull any cloud-only sessions to local.
  await writeFile(join(localDir, APP.cloudLinkFile), cloudDir, 'utf8')
  await syncBidirectional(localDir, cloudDir).catch(() => {})

  writeOutput(
    [
      `✓ linked: ${projectPath}`,
      `  sessions will sync with ${cloudDir}`,
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
  const project = projects.find((p) => samePath(p.path, projectPath))

  if (!project?.isShared) {
    writeOutput(`not linked — ${projectPath} already uses local-only storage`)
    return
  }

  const localDir = join(getClaudeProjectsDirectory(), project.id)
  const localStat = await lstat(localDir).catch(() => null)

  if (localStat?.isSymbolicLink()) {
    // Legacy junction: restore as a real directory with sessions from the target.
    let junctionTarget = await readlink(localDir).catch(() => null)
    if (junctionTarget?.startsWith('\\\\?\\')) junctionTarget = junctionTarget.slice(4)
    await removeLink(localDir)
    await mkdir(localDir, { recursive: true })
    if (junctionTarget) {
      for (const name of await readdir(junctionTarget).catch(() => [])) {
        await cp(join(junctionTarget, name), join(localDir, name), { recursive: true, force: true }).catch(() => {})
      }
    }
  } else {
    // New .ccm-link model: simply remove the marker file.
    await rm(join(localDir, APP.cloudLinkFile), { force: true })
  }

  writeOutput(
    [
      `✓ unlinked: ${projectPath}`,
      `  sessions remain in local storage.`,
      `  note: ${join(projectPath, APP.cloudMemoryDir)} still exists — remove it manually if no longer needed.`,
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
    if (p.cloudPath) {
      lines.push(`       → ${p.cloudPath}  (local-first sync)`)
    } else {
      lines.push(`       → (legacy junction — run \`ccm link ${p.path}\` to migrate)`)
    }
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

function samePath(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/[/\\]+$/, '')
  // Windows and macOS (default HFS+/APFS) are case-insensitive; Linux is not.
  return process.platform === 'linux'
    ? norm(a) === norm(b)
    : norm(a).toLowerCase() === norm(b).toLowerCase()
}
