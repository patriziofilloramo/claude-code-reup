import { access, lstat, mkdir, readFile, readlink, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { APP } from '../config/app.js'
import {
  createLinkAt,
  removeLinkAt,
  syncBidirectional,
} from '../core/cloud-sync.js'
import { encodeProjectPath, getCcmDirectory, getClaudeProjectsDirectory } from '../core/claude-paths.js'
import { getOrCreateDeviceId } from '../core/device-id.js'
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

  if (args.length === 0) {
    const linkable = projects.filter((p) => !p.isShared)
    if (linkable.length === 0) {
      writeOutput('all projects are already linked to cloud storage')
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

/**
 * Links a project to cloud storage by:
 *   1. Creating (or confirming) the cloud .claude-memory/ directory.
 *   2. Merging any existing local sessions into it.
 *   3. Replacing the local project directory with an NTFS junction (Windows)
 *      / symlink (Unix) that points at the cloud directory.
 *
 * After linking, Claude Code writes sessions directly to cloud storage.
 * Other devices with access to the same cloud directory (via pCloud, OneDrive,
 * etc.) see those sessions without needing ccm installed.
 */
async function linkProject(projectPath: string, projects: Project[]): Promise<void> {
  const project = projects.find((p) => samePath(p.path, projectPath))
  const cloudDir = join(projectPath, APP.cloudMemoryDir)

  if (project?.isShared) {
    const desc = project.cloudPath
      ? `already linked — sessions sync with ${project.cloudPath}`
      : 'already linked (junction in place)'
    writeOutput(desc)
    return
  }

  const projectId = project?.id ?? encodeProjectPath(projectPath)
  const localDir = join(getClaudeProjectsDirectory(), projectId)

  await mkdir(cloudDir, { recursive: true })

  const localStat = await lstat(localDir).catch(() => null)

  if (localStat?.isSymbolicLink()) {
    // Existing junction to a different target — update it
    const existing = (await readlink(localDir)).replace(/^\\\\\?\\/, '')
    if (samePath(existing, cloudDir)) {
      writeOutput(`already linked — ${projectPath}`)
      return
    }
    // Different target: sync existing → new cloud, then re-point
    await syncBidirectional(existing, cloudDir).catch(() => {})
    await removeLinkAt(localDir)
    await createLinkAt(localDir, cloudDir)
    writeOutput([
      `✓ re-linked: ${projectPath}`,
      `  sessions now write to ${cloudDir}`,
    ].join('\n'))
    return
  }

  if (localStat?.isDirectory()) {
    // Real local dir: copy sessions to cloud, then replace with junction
    await syncBidirectional(localDir, cloudDir).catch(() => {})
    await rm(localDir, { recursive: true, force: true })
  }

  await createLinkAt(localDir, cloudDir)

  const deviceId = await getOrCreateDeviceId()
  await injectClaudeMdSection(projectPath, cloudDir, deviceId)

  writeOutput([
    `✓ linked: ${projectPath}`,
    `  sessions write directly to ${cloudDir}`,
    `  CLAUDE.md updated — other devices will be prompted to run ccm link`,
    `  start ccm to enable offline backup and automatic conflict merge`,
  ].join('\n'))
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

/**
 * Unlinks a project from cloud storage.
 * The junction is removed and replaced with a real local directory populated
 * from the cloud dir (so existing sessions are preserved locally).
 */
async function unlinkProject(projectPath: string, projects: Project[]): Promise<void> {
  const project = projects.find((p) => samePath(p.path, projectPath))

  if (!project?.isShared) {
    writeOutput(`not linked — ${projectPath} already uses local-only storage`)
    return
  }

  const localDir = join(getClaudeProjectsDirectory(), project.id)
  const localStat = await lstat(localDir).catch(() => null)

  if (localStat?.isSymbolicLink()) {
    // Junction: restore as real dir populated with cloud sessions
    const cloudTarget = (await readlink(localDir)).replace(/^\\\\\?\\/, '')
    await removeLinkAt(localDir)
    await mkdir(localDir, { recursive: true })
    await syncBidirectional(localDir, cloudTarget).catch(() => {})
  } else if (localStat?.isDirectory()) {
    // Offline-mode local dir: remove the legacy .ccm-link marker if present
    await rm(join(localDir, APP.cloudLinkFile), { force: true })
  }

  await removeClaudeMdSection(projectPath)

  writeOutput([
    `✓ unlinked: ${projectPath}`,
    `  sessions remain in local storage.`,
    `  note: ${join(projectPath, APP.cloudMemoryDir)} still exists — remove manually if no longer needed.`,
  ].join('\n'))
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
    const status = p.cloudOffline
      ? '⚠ OFFLINE'
      : p.cloudPath
        ? '✓ online'
        : '✓ linked'
    lines.push(`  ⊙  ${p.path}`)
    if (p.cloudPath) {
      lines.push(`       → ${p.cloudPath}  [${status}]`)
    } else {
      lines.push(`       → (junction — run \`ccm link ${p.path}\` to re-register)`)
    }
    if (p.cloudOffline) {
      lines.push(`       ℹ sessions written while offline will sync when cloud returns`)
    }
  }
  writeOutput(lines.join('\n'))
}

// ---------------------------------------------------------------------------
// CLAUDE.md cross-device sync section
// ---------------------------------------------------------------------------

const CCM_MARKER_START = '<!-- ccm:sync:start -->'
const CCM_MARKER_END = '<!-- ccm:sync:end -->'

/**
 * Writes (or replaces) the ccm sync section in the project's CLAUDE.md.
 *
 * The section instructs the Claude Code agent to:
 *   1. Check for the local device-id file every session (new or resumed).
 *   2. If missing → warn the user and offer to set up or suppress forever.
 *   3. If present → load shared memories from the cloud directory.
 *
 * Using markers allows safe idempotent re-runs and clean removal on unlink.
 */
async function injectClaudeMdSection(
  projectPath: string,
  cloudDir: string,
  deviceId: string,
): Promise<void> {
  const claudeMdPath = join(projectPath, 'CLAUDE.md')
  const home = homedir()
  const deviceIdPath = process.platform === 'win32'
    ? join(home, '.claude', 'ccm', 'device-id').replace(/\\/g, '\\\\')
    : join(home, '.claude', 'ccm', 'device-id')
  const ignorePath = process.platform === 'win32'
    ? join(home, '.claude', 'ccm', 'sync-warning-ignored').replace(/\\/g, '\\\\')
    : join(home, '.claude', 'ccm', 'sync-warning-ignored')
  const memoryDir = join(cloudDir, 'memory')

  const section = [
    CCM_MARKER_START,
    '## CCM: Cross-device Sync',
    '',
    `Cloud storage for this project: \`${cloudDir}\``,
    `Linked from device: \`${deviceId}\``,
    '',
    '**At the start of every session (new or resumed), run this check:**',
    '',
    `1. Try to read \`${deviceIdPath}\``,
    `2. **File missing** — this device is not set up for sync:`,
    `   - Try to read \`${ignorePath}\``,
    `   - If that file also does not exist: tell the user —`,
    `     "⚠ Questo device non è configurato per il sync cross-device ccm.`,
    `     Esegui \`ccm link \\"${projectPath}\\"\` per condividere sessioni e memoria`,
    `     tra dispositivi, oppure dimmi \\"ignora sync\\" per non mostrare più questo avviso."`,
    `   - If the user replies with "ignora sync" (or similar):`,
    `     Write the text \`ignored\` to \`${ignorePath}\` using your Write tool,`,
    `     then confirm: "Avviso sync disattivato su questo device."`,
    `   - If the ignore file already exists: skip the warning silently.`,
    `3. **File present** — sync is active on this device:`,
    `   Read all \`.md\` files in \`${memoryDir}\` for shared context from other devices.`,
    CCM_MARKER_END,
  ].join('\n')

  let existing = ''
  try {
    existing = await readFile(claudeMdPath, 'utf8')
  } catch { /* file does not exist yet */ }

  const startIdx = existing.indexOf(CCM_MARKER_START)
  const endIdx = existing.indexOf(CCM_MARKER_END)

  let updated: string
  if (startIdx !== -1 && endIdx !== -1) {
    // Replace existing section
    updated = existing.slice(0, startIdx) + section + existing.slice(endIdx + CCM_MARKER_END.length)
  } else {
    // Append new section (with blank line separator if file has content)
    updated = existing ? existing.trimEnd() + '\n\n' + section + '\n' : section + '\n'
  }

  await writeFile(claudeMdPath, updated, 'utf8')
}

/**
 * Removes the ccm sync section from the project's CLAUDE.md on unlink.
 * Leaves the rest of the file intact.
 */
async function removeClaudeMdSection(projectPath: string): Promise<void> {
  const claudeMdPath = join(projectPath, 'CLAUDE.md')
  let content: string
  try {
    content = await readFile(claudeMdPath, 'utf8')
  } catch {
    return  // file doesn't exist, nothing to remove
  }

  const startIdx = content.indexOf(CCM_MARKER_START)
  const endIdx = content.indexOf(CCM_MARKER_END)
  if (startIdx === -1 || endIdx === -1) return

  const before = content.slice(0, startIdx).trimEnd()
  const after = content.slice(endIdx + CCM_MARKER_END.length).trimStart()
  const updated = before && after ? before + '\n\n' + after : before || after

  if (updated.trim()) {
    await writeFile(claudeMdPath, updated + '\n', 'utf8')
  } else {
    await rm(claudeMdPath, { force: true })
  }
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

  for (const key of ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial', 'ONEDRIVE']) {
    const v = process.env[key]
    if (v) roots.push(v)
  }

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

  const pcloudCandidates = process.platform === 'win32'
    ? [join(home, 'pCloud Drive'), 'P:\\']
    : [join(home, 'pCloud Drive'), join(home, 'pCloudDrive')]
  for (const p of pcloudCandidates) {
    if (await pathExists(p)) roots.push(p)
  }

  for (const p of [join(home, 'Google Drive'), join(home, 'My Drive')]) {
    if (await pathExists(p)) roots.push(p)
  }

  const icloud = process.platform === 'win32'
    ? join(home, 'iCloudDrive')
    : join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs')
  if (await pathExists(icloud)) roots.push(icloud)

  return [...new Set(roots.map((r) => r.replace(/[/\\]+$/, '')))]
}

function isUnderCloudRoot(projectPath: string, roots: string[]): boolean {
  const norm = projectPath.replace(/[/\\]+$/, '').toLowerCase()
  return roots.some(
    (r) =>
      norm.startsWith(r.toLowerCase() + '/') ||
      norm.startsWith(r.toLowerCase() + '\\') ||
      norm === r.toLowerCase()
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function samePath(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/[/\\]+$/, '')
  return process.platform === 'linux'
    ? norm(a) === norm(b)
    : norm(a).toLowerCase() === norm(b).toLowerCase()
}
