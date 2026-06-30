import { describe, expect, it } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const ROUTES_DIRECTORY = join(process.cwd(), 'src', 'web', 'routes')

describe('web route security guardrails', () => {
  it('keeps every mutating route behind guardedRoute', async () => {
    const files = (await readdir(ROUTES_DIRECTORY))
      .filter((file) => file.endsWith('.ts'))
      .sort((left, right) => left.localeCompare(right))
    const unguardedMutations: string[] = []

    for (const file of files) {
      const relativePath = join('src', 'web', 'routes', file)
      const source = await readFile(join(ROUTES_DIRECTORY, file), 'utf8')
      const matches = source.matchAll(/\bapp\.(post|put|delete|patch)\s*\(/g)

      for (const match of matches) {
        const routeBlock = source.slice(match.index, nextRouteIndex(source, match.index + 1))
        if (!routeBlock.includes('guardedRoute(')) {
          unguardedMutations.push(`${relativePath}: app.${match[1]}`)
        }
      }
    }

    expect(unguardedMutations).toEqual([])
  })
})

function nextRouteIndex(source: string, startIndex: number): number {
  const next = source.slice(startIndex).search(/\bapp\.(get|post|put|delete|patch)\s*\(/)
  return next === -1 ? source.length : startIndex + next
}
