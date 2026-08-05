import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

/**
 * Returns a slash-separated path for a tar child process running from `workingDirectory`.
 * GNU tar on Windows treats drive-colon archive operands as remote host references.
 */
export function relativeTarPath(workingDirectory, targetPath) {
  const relativePath = relative(resolve(workingDirectory), resolve(targetPath))
  if (relativePath === '') return '.'
  if (isAbsolute(relativePath) || /^[A-Za-z]:/.test(relativePath)) {
    throw new Error('tar target must be reachable from its working directory without a drive path.')
  }
  return relativePath.split(sep).join('/')
}

export function tarReadEntryInvocation(archivePath, entryPath) {
  const cwd = dirname(resolve(archivePath))
  return {
    args: ['-xOf', relativeTarPath(cwd, archivePath), entryPath],
    cwd,
  }
}

export function tarExtractInvocation(workingDirectory, archivePath, targetDirectory) {
  const cwd = resolve(workingDirectory)
  return {
    args: ['-xzf', relativeTarPath(cwd, archivePath), '-C', relativeTarPath(cwd, targetDirectory)],
    cwd,
  }
}
