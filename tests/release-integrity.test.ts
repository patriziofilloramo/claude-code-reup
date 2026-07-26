import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const releaseScripts = ['scripts/build-release.mjs', 'scripts/build-installers.mjs']

describe('release working-tree guard', () => {
  for (const scriptPath of releaseScripts) {
    it(`includes staged and untracked files in ${scriptPath}`, () => {
      const source = readFileSync(scriptPath, 'utf8')

      expect(source).toContain("['status', '--porcelain=v1', '--untracked-files=normal']")
      expect(source).not.toContain("['diff', '--quiet']")
    })
  }

  it('does not replace or remove a Unix launcher owned by another install', () => {
    const source = readFileSync('scripts/build-installers.mjs', 'utf8')

    expect(source).toContain('Refusing to replace a launcher not owned by this Reup install')
    expect(source).toContain('Refusing to replace an existing file')
    expect(source).toContain('Leaving launcher not owned by this Reup install')
    expect(source).toContain('"$(readlink "$LAUNCHER")" = "$INSTALL_DIR/bin/reup"')
  })
})
