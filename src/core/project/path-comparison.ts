import { normalize, parse } from 'node:path'

/**
 * Normalizes an absolute filesystem path for identity comparisons.
 *
 * Linux paths remain case-sensitive. Windows and macOS comparisons are
 * case-insensitive to match their common filesystem behavior and, more
 * importantly, to avoid missing an active project before a destructive
 * storage transition.
 */
export function normalizePathForComparison(path: string): string {
  const normalizedPath = normalize(path)
  const pathWithoutTrailingSeparators =
    normalizedPath === parse(normalizedPath).root
      ? normalizedPath
      : normalizedPath.replace(/[/\\]+$/, '')

  return process.platform === 'linux'
    ? pathWithoutTrailingSeparators
    : pathWithoutTrailingSeparators.toLowerCase()
}

/** Returns whether two filesystem paths identify the same location. */
export function pathsReferToSameLocation(leftPath: string, rightPath: string): boolean {
  return normalizePathForComparison(leftPath) === normalizePathForComparison(rightPath)
}
