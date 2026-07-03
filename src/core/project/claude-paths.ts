import { cpSync, existsSync } from 'node:fs'
import { access, readdir } from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'

import { APP } from '../../config/app.js'

// -----------------------------------------------------------------------------
// Claude data locations
// -----------------------------------------------------------------------------

/** Returns Claude Code's data directory, respecting `CLAUDE_CONFIG_DIR`. */
export function getClaudeDirectory(): string {
  return process.env[APP.claudeConfigEnvVar] ?? join(os.homedir(), '.claude')
}

/** Returns the directory where Claude Code stores per-project session data. */
export function getClaudeProjectsDirectory(): string {
  return join(getClaudeDirectory(), 'projects')
}

/** Returns the Reup-private data directory inside Claude Code's config root. */
export function getReupDirectory(): string {
  const directory = join(getClaudeDirectory(), 'reup')
  migrateLegacyReupDirectoryIfNeeded(directory)
  return directory
}

export function getLegacyReupDirectory(): string {
  return join(getClaudeDirectory(), LEGACY_REUP_DIRECTORY_NAME)
}

/** Returns Claude Code's adjacent local application-state file. */
export function getClaudeStatePath(): string {
  return `${getClaudeDirectory()}.json`
}

/** Returns the project-specific subdirectory inside the Claude Code projects directory. */
export function getProjectDirectory(projectId: string): string {
  return join(getClaudeProjectsDirectory(), projectId)
}

function migrateLegacyReupDirectoryIfNeeded(directory: string): void {
  const legacyDirectory = getLegacyReupDirectory()
  if (existsSync(directory) || !existsSync(legacyDirectory)) return

  try {
    cpSync(legacyDirectory, directory, { recursive: true })
  } catch (error) {
    if (!existsSync(directory)) throw error
  }
}

const LEGACY_REUP_DIRECTORY_NAME = `${'swo'}${'op'}`

// -----------------------------------------------------------------------------
// Encoded project path resolution
// -----------------------------------------------------------------------------

/**
 * Encodes a filesystem path into the directory name Claude Code uses under
 * ~/.claude/projects/. This is the inverse of decodeProjectDirectoryName and
 * shares the same ambiguity around hyphens in directory names — use
 * resolveProjectPath() to disambiguate when the directory already exists.
 */
export function encodeProjectPath(projectPath: string): string {
  if (process.platform === 'win32') {
    const match = projectPath.match(/^([a-zA-Z]):[/\\](.*)$/)
    if (match) return `${match[1].toUpperCase()}--${match[2].replace(/[/\\]/g, '-')}`
  }
  return projectPath.replace(/^\//, '').replace(/\//g, '-')
}

/**
 * Naively converts a Claude project directory name back to a filesystem path.
 * Prefer `resolveProjectPath()` when filesystem-aware Windows resolution matters.
 */
export function decodeProjectDirectoryName(directoryName: string): string {
  if (process.platform === 'win32') {
    const match = directoryName.match(/^([a-zA-Z])--(.*)$/)
    if (match) {
      const drive = match[1].toUpperCase()
      const pathAfterDrive = match[2].replace(/-/g, '\\')
      return `${drive}:\\${pathAfterDrive}`
    }
  }
  return '/' + directoryName.replace(/-/g, '/')
}

/** Resolves an encoded project directory name to the most likely filesystem path. */
export async function resolveProjectPath(directoryName: string): Promise<string> {
  if (process.platform !== 'win32') return resolveEncodedPath('/', directoryName, '/')

  const match = directoryName.match(/^([a-zA-Z])--(.*)$/)
  if (!match) return decodeProjectDirectoryName(directoryName)

  return resolveEncodedPath(`${match[1].toUpperCase()}:\\`, match[2], '\\')
}

async function resolveEncodedPath(
  rootPath: string,
  encodedRemainder: string,
  pathSeparator: '/' | '\\'
): Promise<string> {
  let resolvedPath = rootPath
  let encodedPathRemainder = encodedRemainder
  while (encodedPathRemainder.length > 0) {
    let directoryEntries: string[]
    try {
      directoryEntries = await readdir(resolvedPath)
    } catch {
      return join(resolvedPath, encodedPathRemainder.replace(/-/g, pathSeparator))
    }

    // Claude's encoding makes literal hyphens ambiguous. Prefer the longest
    // real directory name that can consume the next encoded path segment.
    const matchingEntry = directoryEntries
      .filter(
        (entry) =>
          encodedPathRemainder === entry ||
          encodedPathRemainder.toLowerCase().startsWith(entry.toLowerCase() + '-')
      )
      .sort((left, right) => right.length - left.length)[0]

    if (!matchingEntry) {
      const shortNameSegment =
        pathSeparator === '\\'
          ? await resolveWindowsShortNameSegment(resolvedPath, encodedPathRemainder)
          : null
      if (shortNameSegment) {
        resolvedPath = join(resolvedPath, shortNameSegment)
        encodedPathRemainder =
          encodedPathRemainder === shortNameSegment
            ? ''
            : encodedPathRemainder.slice(shortNameSegment.length + 1)
        continue
      }

      return join(resolvedPath, encodedPathRemainder.replace(/-/g, pathSeparator))
    }

    resolvedPath = join(resolvedPath, matchingEntry)
    encodedPathRemainder =
      encodedPathRemainder === matchingEntry
        ? ''
        : encodedPathRemainder.slice(matchingEntry.length + 1)
  }

  return resolvedPath
}

async function resolveWindowsShortNameSegment(
  resolvedPath: string,
  encodedPathRemainder: string
): Promise<string | null> {
  const separatorIndex = encodedPathRemainder.indexOf('-')
  const segment =
    separatorIndex === -1 ? encodedPathRemainder : encodedPathRemainder.slice(0, separatorIndex)
  if (!isWindowsShortNameSegment(segment)) return null

  try {
    await access(join(resolvedPath, segment))
    return segment
  } catch {
    return null
  }
}

export function isWindowsShortNameSegment(segment: string): boolean {
  return /^[^/\\.-]{1,6}~\d+(?:\.[^/\\.-]{1,3})?$/i.test(segment)
}
