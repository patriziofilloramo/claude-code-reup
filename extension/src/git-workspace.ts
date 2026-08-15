import { lstat, readFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, parse, resolve } from 'node:path'

/**
 * Walks up from a folder to the repository that contains it, or returns the
 * folder itself when it is not inside one.
 *
 * Opening a subfolder of a repository is ordinary — one package of a monorepo,
 * one service of a polyrepo checkout — and the folder alone then answers no
 * useful question: it holds no `.git`, so Git metadata and any session Claude
 * recorded at the repository root both look absent from it.
 *
 * The walk stops at the first `.git` entry, which is a directory in a normal
 * clone and a file in a linked worktree or submodule. Both are real roots for
 * this purpose: a worktree's own sessions belong to that worktree.
 */
export async function resolveRepositoryRoot(folderPath: string): Promise<string> {
  let candidate = resolve(folderPath)
  const filesystemRoot = parse(candidate).root

  for (;;) {
    if (await lstat(join(candidate, '.git')).catch(() => null)) return candidate
    if (candidate === filesystemRoot) return resolve(folderPath)
    const parent = dirname(candidate)
    if (parent === candidate) return resolve(folderPath)
    candidate = parent
  }
}

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
