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

  it('does not replace an existing candidate before the release gate passes', () => {
    const source = readFileSync('scripts/build-release.mjs', 'utf8')

    expect(source.indexOf('runReleaseValidationCommands(root)')).toBeLessThan(
      source.indexOf('rmSync(releaseRoot')
    )
  })
})

describe('beta distribution contract', () => {
  it('configures the scoped npm package for explicit public publication', () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8'))

    expect(manifest.name).toBe('@patriziofilloramo/reup')
    expect(manifest.private).not.toBe(true)
    expect(manifest.publishConfig).toEqual({
      access: 'public',
      registry: 'https://registry.npmjs.org/',
    })
    expect(manifest.repository.url).toContain('patriziofilloramo/claude-code-reup')
    expect(manifest.bugs.url).toMatch(/^https:\/\//)
    expect(manifest.scripts.postinstall).toBeUndefined()
    expect(manifest.scripts['release:package:check']).toBe('node scripts/check-package.mjs')
  })

  it('keeps the beta candidate workflow artifact-only', () => {
    const workflow = readFileSync('.github/workflows/beta-candidate.yml', 'utf8')

    expect(workflow).toContain('workflow_dispatch:')
    expect(workflow).toContain('npm run release:local')
    expect(workflow).toContain('actions/upload-artifact@v4')
    expect(workflow).toContain('contents: read')
    expect(workflow).not.toContain('npm publish')
    expect(workflow).not.toContain('gh release')
    expect(workflow).not.toContain('contents: write')
    expect(workflow).not.toContain('id-token: write')
  })

  it('derives host-only installables from the packed npm artifact', () => {
    const source = readFileSync('scripts/build-installers.mjs', 'utf8')

    expect(source).toContain('findNpmPackageArtifact()')
    expect(source).toContain("run('tar', ['-xzf', packagePath, '-C', extractionRoot])")
    expect(source).toContain('buildCurrentPlatformPackage(runtimeApp)')
    expect(source).not.toContain("id: 'macos-universal'")
  })
})
