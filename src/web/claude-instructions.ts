import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { loadProjectById } from '../core/project/project-discovery.js'

export interface ClaudeInstructions {
  content: string | null
  path: string
}

export async function readClaudeInstructions(
  projectId: string
): Promise<ClaudeInstructions | null> {
  const project = await loadProjectById(projectId)
  if (!project) return null

  return resolveClaudeInstructions(project.path)
}

export async function writeClaudeInstructions(
  projectId: string,
  content: string
): Promise<string | null> {
  const project = await loadProjectById(projectId)
  if (!project) return null

  const instructions = await resolveClaudeInstructions(project.path)
  await writeFile(instructions.path, content, 'utf8')
  return instructions.path
}

async function resolveClaudeInstructions(projectPath: string): Promise<ClaudeInstructions> {
  for (const candidatePath of instructionPaths(projectPath)) {
    try {
      return { content: await readFile(candidatePath, 'utf8'), path: candidatePath }
    } catch {
      // Try the next supported location.
    }
  }

  return { content: null, path: join(projectPath, 'CLAUDE.md') }
}

function instructionPaths(projectPath: string): string[] {
  return [join(projectPath, '.claude', 'CLAUDE.md'), join(projectPath, 'CLAUDE.md')]
}
