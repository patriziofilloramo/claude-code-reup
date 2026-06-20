import { access, lstat, readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, parse, resolve, sep } from 'node:path'

const SESSION_TRANSCRIPT_FILE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i

import { APP } from '../../config/app.js'
import { encodeProjectPath } from '../project/claude-paths.js'
import { normalizePathForComparison } from '../project/path-comparison.js'

type AsyncLimiter = <T>(task: () => Promise<T>) => Promise<T>

export interface CloudLinkedProject {
  cloudPath: string
  id: string
  linkedDevices: string[]
  path: string
  unlinkedDevices: string[]
}

export interface CloudProjectDiscoveryOptions {
  scanMode?: 'fast' | 'full'
}

/**
 * Scans cloud roots for project directories that were linked by another device
 * but are not present in the caller's known local project set.
 */
export async function discoverCloudLinkedProjectPaths(
  cloudRoots: string[],
  knownPaths: Set<string>,
  options: CloudProjectDiscoveryOptions = {}
): Promise<CloudLinkedProject[]> {
  const projects: CloudLinkedProject[] = []
  const seenPaths = new Set<string>()
  const normalizedKnownPaths = new Set([...knownPaths].map(normalizePathForComparison))
  const limitFs = createAsyncLimiter(CLOUD_SCAN_CONCURRENCY)
  const scanRoots =
    options.scanMode === 'fast'
      ? await resolveFastCloudScanRoots(cloudRoots, limitFs)
      : cloudRoots.map(normalizeCloudRoot)

  for (const root of scanRoots) {
    for (const project of await scanForLinkedProjects(root, normalizedKnownPaths, 0, limitFs)) {
      const normalizedPath = normalizePathForComparison(project.path)
      if (seenPaths.has(normalizedPath)) continue
      seenPaths.add(normalizedPath)
      projects.push(project)
    }
  }

  return projects
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

  return [...new Set(roots.map(normalizeCloudRoot))]
}

export function isUnderCloudRoot(projectPath: string, roots: string[]): boolean {
  const normalizedProjectPath = normalizePathForComparison(projectPath)
  return roots.some((root) => {
    const normalizedRoot = normalizePathForComparison(normalizeCloudRoot(root))
    return (
      normalizedProjectPath === normalizedRoot ||
      normalizedProjectPath.startsWith(ensureTrailingSeparator(normalizedRoot))
    )
  })
}

export function normalizeCloudRoot(root: string): string {
  const expandedRoot =
    root === '~'
      ? homedir()
      : root.startsWith('~/') || root.startsWith('~\\')
        ? join(homedir(), root.slice(2))
        : root
  const driveRoot = expandedRoot.match(/^([a-zA-Z]):[\\/]?$/)
  if (process.platform === 'win32' && driveRoot) return `${driveRoot[1].toUpperCase()}:\\`

  const resolvedRoot = resolve(expandedRoot)
  const filesystemRoot = parse(resolvedRoot).root
  return resolvedRoot === filesystemRoot ? resolvedRoot : resolvedRoot.replace(/[/\\]+$/, '')
}

const CLOUD_SCAN_CONCURRENCY = 32
const CLOUD_SCAN_MAX_DEPTH = 4
const FAST_SCAN_ROOT_DIRECTORY_NAMES = [
  'Projects',
  'projects',
  'Code',
  'code',
  'Workspace',
  'workspace',
  'Work',
  'work',
  'Repos',
  'repos',
  'Dev',
  'dev',
]
const CLOUD_SCAN_IGNORED_DIRECTORIES = new Set([
  '.claude-memory',
  '.git',
  'build',
  'dist',
  'node_modules',
  'out',
  'target',
  'vendor',
])

async function resolveFastCloudScanRoots(
  cloudRoots: string[],
  limitFs: AsyncLimiter
): Promise<string[]> {
  const scanRoots: string[] = []

  for (const root of cloudRoots.map(normalizeCloudRoot)) {
    const focusedRoots = await existingFocusedScanRoots(root, limitFs)
    if (focusedRoots.length > 0) {
      scanRoots.push(...focusedRoots)
    } else {
      scanRoots.push(root)
    }
  }

  return dedupePaths(scanRoots)
}

async function existingFocusedScanRoots(root: string, limitFs: AsyncLimiter): Promise<string[]> {
  const roots: string[] = []
  for (const directoryName of FAST_SCAN_ROOT_DIRECTORY_NAMES) {
    const candidate = join(root, directoryName)
    const st = await limitFs(() => lstat(candidate).catch(() => null))
    if (st?.isDirectory() && !st.isSymbolicLink()) roots.push(candidate)
  }
  return dedupePaths(roots)
}

async function scanForLinkedProjects(
  dir: string,
  knownPaths: Set<string>,
  depth: number,
  limitFs: AsyncLimiter
): Promise<CloudLinkedProject[]> {
  if (depth > CLOUD_SCAN_MAX_DEPTH) return []

  const projects: CloudLinkedProject[] = []
  const normalizedCurrentPath = normalizePathForComparison(dir)
  const isKnownPath = knownPaths.has(normalizedCurrentPath)
  if (!isKnownPath) {
    const cloudState = await readCloudProjectState(dir, limitFs)
    if (cloudState.isCloudProject) {
      projects.push(
        cloudLinkedProjectForPath(dir, cloudState.linkedDevices, cloudState.unlinkedDevices)
      )
    }
  }

  if (depth === CLOUD_SCAN_MAX_DEPTH) return projects

  let entries: string[]
  try {
    entries = await limitFs(() => readdir(dir))
  } catch {
    return projects
  }

  const nestedProjects = await Promise.all(
    entries.map(async (entry) => {
      if (shouldSkipCloudScanDirectory(entry)) return []

      const candidatePath = join(dir, entry)
      const st = await limitFs(() => lstat(candidatePath).catch(() => null))
      if (!st?.isDirectory() || st.isSymbolicLink()) return []

      return scanForLinkedProjects(candidatePath, knownPaths, depth + 1, limitFs)
    })
  )

  for (const nested of nestedProjects) {
    projects.push(...nested)
  }

  return projects
}

function cloudLinkedProjectForPath(
  projectPath: string,
  linkedDevices: string[],
  unlinkedDevices: string[]
): CloudLinkedProject {
  return {
    cloudPath: join(projectPath, APP.sharedMemoryDir),
    id: encodeProjectPath(projectPath),
    linkedDevices,
    path: projectPath,
    unlinkedDevices,
  }
}

function shouldSkipCloudScanDirectory(directoryName: string): boolean {
  return directoryName.startsWith('.') || CLOUD_SCAN_IGNORED_DIRECTORIES.has(directoryName)
}

async function readCloudProjectState(
  projectPath: string,
  limitFs: AsyncLimiter
): Promise<{
  isCloudProject: boolean
  linkedDevices: string[]
  unlinkedDevices: string[]
}> {
  const cloudMemoryPath = join(projectPath, APP.sharedMemoryDir)
  const cloudMemoryStat = await limitFs(() => lstat(cloudMemoryPath).catch(() => null))
  if (!cloudMemoryStat?.isDirectory()) {
    return { isCloudProject: false, linkedDevices: [], unlinkedDevices: [] }
  }

  const [linkedDevices, observedUnlinkedDevices, hasTranscripts] = await Promise.all([
    readLinkedDeviceMarkers(cloudMemoryPath, limitFs),
    readUnlinkedDeviceMarkers(cloudMemoryPath, limitFs),
    cloudMemoryHasTranscripts(cloudMemoryPath, limitFs),
  ])
  const linkedDeviceSet = new Set(linkedDevices)
  const unlinkedDevices = observedUnlinkedDevices.filter((device) => !linkedDeviceSet.has(device))
  // Surface the project when it has active link markers OR session transcripts.
  // Transcripts without markers cover sessions created before device markers were introduced.
  // Link markers without transcripts are insufficient — a stale marker with no sessions
  // has nothing meaningful to sync.
  return {
    isCloudProject: linkedDevices.length > 0 || unlinkedDevices.length > 0 || hasTranscripts,
    linkedDevices,
    unlinkedDevices,
  }
}

async function cloudMemoryHasTranscripts(
  cloudMemoryPath: string,
  limitFs: AsyncLimiter
): Promise<boolean> {
  try {
    const entries = await limitFs(() => readdir(cloudMemoryPath))
    return entries.some((entry) => SESSION_TRANSCRIPT_FILE_PATTERN.test(entry))
  } catch {
    return false
  }
}

async function readLinkedDeviceMarkers(
  cloudMemoryPath: string,
  limitFs: AsyncLimiter
): Promise<string[]> {
  const linkedDir = join(cloudMemoryPath, 'linked')
  try {
    const entries = await limitFs(() => readdir(linkedDir, { withFileTypes: true }))
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right))
  } catch {
    return []
  }
}

async function readUnlinkedDeviceMarkers(
  cloudMemoryPath: string,
  limitFs: AsyncLimiter
): Promise<string[]> {
  const presenceDir = join(cloudMemoryPath, 'device-presence')
  try {
    const entries = await limitFs(() => readdir(presenceDir, { withFileTypes: true }))
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => entry.name.slice(0, -5))
      .sort((left, right) => left.localeCompare(right))
  } catch {
    return []
  }
}

function createAsyncLimiter(maxConcurrency: number): AsyncLimiter {
  let activeCount = 0
  const queue: Array<() => void> = []

  return async function limit<T>(task: () => Promise<T>): Promise<T> {
    if (activeCount >= maxConcurrency) {
      await new Promise<void>((resolve) => queue.push(resolve))
    }

    activeCount++
    try {
      return await task()
    } finally {
      activeCount--
      queue.shift()?.()
    }
  }
}

function dedupePaths(paths: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const path of paths) {
    const normalizedPath = normalizePathForComparison(path)
    if (seen.has(normalizedPath)) continue
    seen.add(normalizedPath)
    result.push(path)
  }

  return result
}

function ensureTrailingSeparator(path: string): string {
  return path.endsWith('/') || path.endsWith('\\') ? path : `${path}${sep}`
}

async function pathExists(path: string): Promise<boolean> {
  return access(path)
    .then(() => true)
    .catch(() => false)
}
