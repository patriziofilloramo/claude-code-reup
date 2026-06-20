import { lstat, readFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'

/** Resolves the real Git metadata directory for normal repos and worktrees. */
export async function resolveGitDirectory(workspacePath: string): Promise<string | null> {
  const dotGitPath = join(workspacePath, '.git')
  const stat = await lstat(dotGitPath).catch(() => null)
  if (stat?.isDirectory()) return dotGitPath
  if (!stat?.isFile()) return null

  const content = await readFile(dotGitPath, 'utf8').catch(() => '')
  const match = content.match(/^\s*gitdir:\s*(.+)\s*$/im)
  if (!match) return null
  const configuredPath = match[1]!.trim()
  return resolve(
    isAbsolute(configuredPath) ? configuredPath : join(dirname(dotGitPath), configuredPath)
  )
}
