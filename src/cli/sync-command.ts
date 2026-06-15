import { access, lstat, mkdir, readFile, readlink, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { APP } from '../config/app.js'
import {
  createLinkAt,
  replaceDirectoryWithLink,
  replaceLinkWithDirectory,
  repointLink,
  syncBidirectional,
} from '../core/sync/cloud-sync.js'
import { encodeProjectPath, getClaudeProjectsDirectory } from '../core/project/claude-paths.js'
import { getOrCreateDeviceId } from '../core/sync/device-id.js'
import { getLiveSessionRecords } from '../core/session/active-sessions.js'
import { pathsReferToSameLocation } from '../core/project/path-comparison.js'
import { loadProjects } from '../core/project/project-discovery.js'
import type { Project } from '../core/session/session-model.js'
import { releaseTerminalInput } from '../tui/terminal-input.js'
import { failCommand, writeOutput } from './output.js'
import { openConfigInterface } from './open-config-interface.js'

type OutputFn = (msg: string) => void

// ---------------------------------------------------------------------------
// TUI-friendly wrappers (silent — no writeOutput side effects)
// ---------------------------------------------------------------------------

export async function linkProjectForTUI(
  projectPath: string,
  knownProjects: Project[]
): Promise<{ ok: boolean; message: string }> {
  const collected: string[] = []
  try {
    await linkProject(resolve(projectPath), knownProjects, (m) => collected.push(m))
    return { ok: true, message: collected[collected.length - 1] ?? 'linked' }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

export async function unlinkProjectForTUI(
  projectPath: string,
  knownProjects: Project[]
): Promise<{ ok: boolean; message: string }> {
  const collected: string[] = []
  try {
    await unlinkProject(resolve(projectPath), knownProjects, (m) => collected.push(m))
    return { ok: true, message: collected[collected.length - 1] ?? 'unlinked' }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

export async function runSyncCommand(args: string[]): Promise<void> {
  const [action, ...rest] = args
  switch (action) {
    case 'link':
      await linkSync(rest)
      return
    case 'unlink':
      await unlinkSync(rest)
      return
    case undefined: {
      await openConfigInterface({
        commandName: 'swoop sync',
        initialTab: 'Sync',
        nonInteractiveAlternative:
          'use `swoop sync link <path>` or `swoop sync unlink <path>` in scripts',
      })
      return
    }
    default:
      failCommand('usage: swoop sync [link|unlink] [path]')
  }
}

// ---------------------------------------------------------------------------
// link
// ---------------------------------------------------------------------------

async function linkSync(args: string[]): Promise<void> {
  if (args.length > 1) {
    failCommand('usage: swoop sync link [project-path]')
    return
  }

  writeOutput(
    [
      '⚠  swoop sync is experimental — use at your own risk.',
      '   Sessions are moved into the cloud directory via a filesystem junction.',
      '   Back up ~/.claude/projects/<id> before proceeding.',
      '   Run `swoop sync unlink <path>` to safely restore to local-only storage.',
      '',
    ].join('\n')
  )

  const projects = await loadProjects()

  if (args.length === 0) {
    const linkable = projects.filter((p) => !p.isShared)
    if (linkable.length === 0) {
      writeOutput('all projects are already synced to cloud storage')
      return
    }
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      failCommand('a project path is required outside an interactive terminal')
      return
    }
    const roots = await detectCloudRoots()
    const cloudProjects =
      roots.length > 0 ? linkable.filter((p) => isUnderCloudRoot(p.path, roots)) : []
    const pickerProjects = cloudProjects.length > 0 ? cloudProjects : linkable
    const note =
      cloudProjects.length === 0 && roots.length === 0
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
 * etc.) see those sessions without needing swoop installed.
 */
async function linkProject(
  projectPath: string,
  projects: Project[],
  out: OutputFn = writeOutput
): Promise<void> {
  const project = projects.find((p) => samePath(p.path, projectPath))
  const cloudDir = join(projectPath, APP.cloudMemoryDir)

  if (project?.isShared) {
    const desc = project.cloudPath
      ? `already linked — sessions sync with ${project.cloudPath}`
      : 'already linked (junction in place)'
    out(desc)
    return
  }

  await assertProjectPathIsInactive(projectPath)

  const projectId = project?.id ?? encodeProjectPath(projectPath)
  const localDir = join(getClaudeProjectsDirectory(), projectId)

  await mkdir(cloudDir, { recursive: true })

  const localStat = await lstat(localDir).catch(() => null)

  if (localStat?.isSymbolicLink()) {
    // Existing junction to a different target — update it
    const existing = (await readlink(localDir)).replace(/^\\\\\?\\/, '')
    if (samePath(existing, cloudDir)) {
      out(`already synced — ${projectPath}`)
      return
    }
    // Different target: sync existing → new cloud, then re-point
    await syncBidirectional(existing, cloudDir)
    await repointLink(localDir, existing, cloudDir)
    out([`✓ re-linked: ${projectPath}`, `  sessions now write to ${cloudDir}`].join('\n'))
    return
  }

  if (localStat?.isDirectory()) {
    // Real local dir: copy sessions to cloud, then replace with junction
    await syncBidirectional(localDir, cloudDir)
    await replaceDirectoryWithLink(localDir, cloudDir)
  } else {
    await createLinkAt(localDir, cloudDir)
  }

  const deviceId = await getOrCreateDeviceId()
  await writeLinkedMarker(cloudDir, deviceId)
  await injectClaudeMdSection(projectPath, cloudDir, deviceId)

  out(
    [
      `✓ linked: ${projectPath}`,
      `  sessions write directly to ${cloudDir}`,
      `  CLAUDE.md updated — other devices will be prompted to run swoop sync`,
      `  start swoop to enable offline backup and conflict detection`,
    ].join('\n')
  )
}

// ---------------------------------------------------------------------------
// unlink
// ---------------------------------------------------------------------------

async function unlinkSync(args: string[]): Promise<void> {
  if (args.length > 1) {
    failCommand('usage: swoop sync unlink [project-path]')
    return
  }

  writeOutput(
    [
      '⚠  swoop sync is experimental — use at your own risk.',
      '   Sessions will be copied from the cloud directory back to local storage.',
      '',
    ].join('\n')
  )

  const projects = await loadProjects()

  if (args.length === 0) {
    const linked = projects.filter((p) => p.isShared)
    if (linked.length === 0) {
      writeOutput('no projects are using cloud sync')
      return
    }
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      failCommand('a project path is required outside an interactive terminal')
      return
    }
    const { runProjectPicker } = await import('../tui/ProjectPicker.js')
    const picked = await runProjectPicker(
      linked,
      undefined,
      'Swoop SYNC UNLINK',
      'select a project to unlink'
    )
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
async function unlinkProject(
  projectPath: string,
  projects: Project[],
  out: OutputFn = writeOutput
): Promise<void> {
  const project = projects.find((p) => samePath(p.path, projectPath))

  if (!project?.isShared) {
    out(`not linked — ${projectPath} already uses local-only storage`)
    return
  }

  await assertProjectPathIsInactive(project.path)

  const cloudDir = join(projectPath, APP.cloudMemoryDir)
  const localDir = join(getClaudeProjectsDirectory(), project.id)
  const localStat = await lstat(localDir).catch(() => null)

  if (localStat?.isSymbolicLink()) {
    // Junction: restore as real dir populated with cloud sessions
    const cloudTarget = (await readlink(localDir)).replace(/^\\\\\?\\/, '')
    await replaceLinkWithDirectory(localDir, cloudTarget, cloudTarget)
  } else if (localStat?.isDirectory()) {
    // Offline-mode local dir: remove the legacy .swoop-link marker if present
    await rm(join(localDir, APP.cloudLinkFile), { force: true })
  }

  const deviceId = await getOrCreateDeviceId()
  await removeLinkedMarker(cloudDir, deviceId)
  await removeClaudeMdSection(projectPath)

  out(
    [
      `✓ unlinked: ${projectPath}`,
      `  sessions remain in local storage.`,
      `  note: ${join(projectPath, APP.cloudMemoryDir)} still exists — remove manually if no longer needed.`,
    ].join('\n')
  )
}

// ---------------------------------------------------------------------------
// CLAUDE.md cross-device sync section
// ---------------------------------------------------------------------------

const SWOOP_MARKER_START = '<!-- swoop:sync:start -->'
const SWOOP_MARKER_END = '<!-- swoop:sync:end -->'

/**
 * Writes (or replaces) the swoop sync section in the project's CLAUDE.md.
 *
 * The section instructs the Claude Code agent (on any device) to:
 *   1. Detect whether this device has run `swoop sync link` by checking a marker file
 *      inside the cloud directory (already accessible — no extra permissions).
 *   2. If not linked → write a presence file so Device B can detect it, then warn.
 *   3. If linked → read shared memories from the cloud directory.
 *
 * All file paths are inside the project's cloud directory so Claude Code needs
 * no extra path permissions beyond its normal project access.
 */
async function injectClaudeMdSection(
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
    '## Swoop: Cross-device Sync',
    '',
    `Cloud storage for this project: \`${cloudDir}\``,
    `Linked from device: \`${deviceId}\``,
    '',
    '**At the start of every session (new or resumed):**',
    '',
    "1. Run `hostname` in Bash to get this device's name (call it HOSTNAME)",
    `2. Check if \`${linkedDir}\\HOSTNAME\` exists (use your Read tool with the actual hostname)`,
    `3. **File exists** — sync is configured on this device:`,
    `   Read all \`.md\` files in \`${memoryDir}\` for shared context from other devices.`,
    `4. **File missing** — this device is not set up for sync:`,
    `   - If \`${ignoredDir}\\HOSTNAME\` exists, skip the warning silently.`,
    `   - Write \`${presenceDir}\\HOSTNAME.json\` with \`{"device":"HOSTNAME","lastSeen":"<today date>"}\` using real values.`,
    `   - Tell the user: "⚠ Questo device non è configurato per il sync cross-device swoop.`,
    `     Esegui \`swoop sync link \\"${projectPath}\\"\` per condividere sessioni e memoria tra dispositivi,`,
    `     oppure dimmi \\"ignora sync\\" per non mostrare più questo avviso."`,
    `   - If the user replies "ignora sync", write \`ignored\` to \`${ignoredDir}\\HOSTNAME\`,`,
    `     delete \`${presenceDir}\\HOSTNAME.json\` if it exists, then confirm the warning is disabled.`,
    `   - Append important shared context to \`${memoryDir}\\shared.md\`.`,
    `     Use append-only writes and format entries as \`## HOSTNAME — <date>\\n<notes>\`.`,
    '',
    SWOOP_MARKER_END,
  ].join('\n')

  let existing = ''
  try {
    existing = await readFile(claudeMdPath, 'utf8')
  } catch {
    /* file does not exist yet */
  }

  const startIdx = existing.indexOf(SWOOP_MARKER_START)
  const endIdx = existing.indexOf(SWOOP_MARKER_END)

  let updated: string
  if (startIdx !== -1 && endIdx !== -1) {
    // Replace existing section
    updated =
      existing.slice(0, startIdx) + section + existing.slice(endIdx + SWOOP_MARKER_END.length)
  } else {
    // Append new section (with blank line separator if file has content)
    updated = existing ? existing.trimEnd() + '\n\n' + section + '\n' : section + '\n'
  }

  await writeFile(claudeMdPath, updated, 'utf8')
}

/**
 * Removes the swoop sync section from the project's CLAUDE.md on unlink.
 * Leaves the rest of the file intact.
 */
/**
 * Writes {cloudDir}/linked/{deviceId} so the Claude Code agent on this device
 * can confirm it is set up for sync without reading any file outside the project.
 * Also removes any stale presence file left from before the device was linked.
 */
async function writeLinkedMarker(cloudDir: string, deviceId: string): Promise<void> {
  const linkedDir = join(cloudDir, 'linked')
  await mkdir(linkedDir, { recursive: true })
  await writeFile(join(linkedDir, deviceId), JSON.stringify({ device: deviceId }), 'utf8')
  // Remove presence file if it exists (device is now properly linked)
  await rm(join(cloudDir, 'device-presence', `${deviceId}.json`), { force: true })
}

/** Removes {cloudDir}/linked/{deviceId} when unlinking. */
async function removeLinkedMarker(cloudDir: string, deviceId: string): Promise<void> {
  await rm(join(cloudDir, 'linked', deviceId), { force: true })
}

async function removeClaudeMdSection(projectPath: string): Promise<void> {
  const claudeMdPath = join(projectPath, 'CLAUDE.md')
  let content: string
  try {
    content = await readFile(claudeMdPath, 'utf8')
  } catch {
    return // file doesn't exist, nothing to remove
  }

  const startIdx = content.indexOf(SWOOP_MARKER_START)
  const endIdx = content.indexOf(SWOOP_MARKER_END)
  if (startIdx === -1 || endIdx === -1) return

  const before = content.slice(0, startIdx).trimEnd()
  const after = content.slice(endIdx + SWOOP_MARKER_END.length).trimStart()
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
  return access(p)
    .then(() => true)
    .catch(() => false)
}

async function detectCloudRoots(): Promise<string[]> {
  const home = homedir()
  const roots: string[] = []

  for (const key of ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial', 'ONEDRIVE']) {
    const v = process.env[key]
    if (v) roots.push(v)
  }

  const dropboxInfo =
    process.platform === 'win32'
      ? join(process.env['LOCALAPPDATA'] ?? home, 'Dropbox', 'info.json')
      : join(home, '.dropbox', 'info.json')
  try {
    const info = JSON.parse(await readFile(dropboxInfo, 'utf8')) as Record<string, unknown>
    for (const account of Object.values(info)) {
      const p = (account as Record<string, unknown>)?.['path']
      if (typeof p === 'string') roots.push(p)
    }
  } catch {
    /* not installed */
  }

  const pcloudCandidates =
    process.platform === 'win32'
      ? [join(home, 'pCloud Drive'), 'P:\\']
      : [join(home, 'pCloud Drive'), join(home, 'pCloudDrive')]
  for (const p of pcloudCandidates) {
    if (await pathExists(p)) roots.push(p)
  }

  for (const p of [join(home, 'Google Drive'), join(home, 'My Drive')]) {
    if (await pathExists(p)) roots.push(p)
  }

  const icloud =
    process.platform === 'win32'
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
  return pathsReferToSameLocation(a, b)
}

async function assertProjectPathIsInactive(projectPath: string): Promise<void> {
  const liveSessions = await getLiveSessionRecords()
  if (liveSessions.some((session) => session.cwd !== null && samePath(session.cwd, projectPath))) {
    throw new Error('cannot change sync configuration while this project has an active session')
  }
}
