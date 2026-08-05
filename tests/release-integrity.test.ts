import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'

import { describe, expect, it } from 'vitest'

import {
  relativeTarPath,
  tarExtractInvocation,
  tarReadEntryInvocation,
} from '../scripts/tar-path.mjs'

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

describe('cross-shell tar paths', () => {
  it('keeps generated archive operands relative and slash-separated', () => {
    const releaseRoot = resolve('release', 'reup-v0.4.3-fixture')
    const packagePath = join(releaseRoot, 'artifacts', 'reup-fixture.tgz')
    const extractionRoot = join(releaseRoot, '.installer-work', '.npm-package')

    expect(relativeTarPath(releaseRoot, packagePath)).toBe('artifacts/reup-fixture.tgz')
    expect(relativeTarPath(releaseRoot, extractionRoot)).toBe('.installer-work/.npm-package')
    expect(relativeTarPath(releaseRoot, releaseRoot)).toBe('.')

    if (process.platform === 'win32') {
      expect(() => relativeTarPath('C:\\release', 'D:\\artifact.tgz')).toThrow(
        'without a drive path'
      )
    }
  })

  it('builds drive-free tarball read and extraction invocations', () => {
    const releaseRoot = resolve('release', 'reup-v0.4.3-fixture')
    const packagePath = join(releaseRoot, 'artifacts', 'reup-fixture.tgz')
    const extractionRoot = join(releaseRoot, '.installer-work', '.npm-package')

    expect(tarReadEntryInvocation(packagePath, 'package/package.json')).toEqual({
      args: ['-xOf', 'reup-fixture.tgz', 'package/package.json'],
      cwd: join(releaseRoot, 'artifacts'),
    })
    expect(tarExtractInvocation(releaseRoot, packagePath, extractionRoot)).toEqual({
      args: ['-xzf', 'artifacts/reup-fixture.tgz', '-C', '.installer-work/.npm-package'],
      cwd: releaseRoot,
    })
  })

  it('routes tarball reads and installer extraction through the invocation boundary', () => {
    const releaseSource = readFileSync('scripts/build-release.mjs', 'utf8')
    const installerSource = readFileSync('scripts/build-installers.mjs', 'utf8')

    expect(releaseSource).toContain('tarReadEntryInvocation(packagePath, entryPath)')
    expect(releaseSource).not.toContain("runCapture('tar', ['-xOf', packagePath")
    expect(installerSource).toContain(
      'tarExtractInvocation(releaseRoot, packagePath, extractionRoot)'
    )
    expect(installerSource).not.toContain("run('tar', ['-xzf', packagePath")
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
    expect(source).toContain('tarExtractInvocation(releaseRoot, packagePath, extractionRoot)')
    expect(source).toContain('buildCurrentPlatformPackage(runtimeApp)')
    expect(source).not.toContain("id: 'macos-universal'")
  })
})

describe('Windows installation contract', () => {
  it('installs only the candidate built from the current clean commit', () => {
    const source = readFileSync('scripts/install-local.ps1', 'utf8')

    expect(source).toContain('rev-parse --short=12 HEAD')
    expect(source).toContain('status --porcelain=v1 --untracked-files=all')
    expect(source).toContain('$releaseName = "reup-v$expectedVersion-$commit"')
    expect(source).toContain('Get-FileHash -LiteralPath $zipPath.FullName -Algorithm SHA256')
    expect(source).toContain("(Join-Path $candidateStagingDir 'bin\\reup')")
    expect(source).toContain("'Programs\\reup-dev'")
    expect(source).toContain('-InstallDir $localInstallDir')
    expect(source).toContain('$candidateStagingDir')
    expect(source).toContain('$stagingBackupDir')
    expect(source).not.toContain('Sort-Object LastWriteTime')
  })

  it('prepends one owned PATH entry in both Windows installer forms', () => {
    const packageInstaller = readFileSync('scripts/install-windows-package.ps1', 'utf8')
    const builder = readFileSync('scripts/build-installers.mjs', 'utf8')

    expect(packageInstaller).toContain(
      '$nextTargetParts = @($bin) + @(Get-PathWithoutEntry $originalTargetPath $bin)'
    )
    expect(packageInstaller).toContain(
      "[Environment]::SetEnvironmentVariable('Path', $Value, 'User')"
    )
    expect(packageInstaller).toContain("Set-TargetPathValue ($nextTargetParts -join ';')")
    expect(packageInstaller).toContain('Get-NormalizedPathEntry $persistedFirstEntry')
    expect(builder).toContain("'  NextValue := Entry;'")
    expect(builder).toContain("'      NextValue := NextValue + PathSeparator + Part;'")
    expect(builder).toContain("Pos('%LOCALAPPDATA%', UpperValue) = 1")
    expect(builder).toContain('NormalizePathPart(Value)')
    expect(builder).not.toContain('PathValue + Entry);')
  })

  it('removes obsolete launchers and portable ownership before an Inno upgrade', () => {
    const source = readFileSync('scripts/build-installers.mjs', 'utf8')

    expect(source).toContain("'[InstallDelete]'")
    expect(source).toContain(String.raw`Type: files; Name: "{app}\\bin\\reup.ps1"`)
    expect(source).toContain(String.raw`Type: files; Name: "{app}\\.reup-portable-install.json"`)
  })

  it('replaces the portable runtime transactionally and marks its ownership', () => {
    const installer = readFileSync('scripts/install-windows-package.ps1', 'utf8')
    const uninstaller = readFileSync('scripts/uninstall-windows-package.ps1', 'utf8')
    const localUninstaller = readFileSync('scripts/uninstall-local.ps1', 'utf8')

    expect(installer).toContain("Invoke-VersionCheck 'the packaged Windows launcher'")
    expect(installer).toContain('$transactionRoot = Join-Path $installParent')
    expect(installer).toContain('Move-Item -LiteralPath $installedApp -Destination $backupApp')
    expect(installer).toContain("installKind = 'portable-windows'")
    expect(installer).toContain('Rollback was incomplete')
    expect(installer).toContain(
      'Refusing to overlay the portable package on an Inno Setup installation'
    )
    expect(installer).toContain('$env:Path = $originalProcessPath')
    expect(installer).not.toContain(
      "Remove-Item -LiteralPath (Join-Path $InstallDir 'app') -Recurse"
    )

    for (const source of [uninstaller, localUninstaller]) {
      expect(source).toContain("installKind -ne 'portable-windows'")
      expect(source).toContain('.reup-portable-install.json')
    }
    expect(uninstaller).not.toContain('Remove-Item -LiteralPath $InstallDir -Recurse -Force')
  })

  it('verifies supported shells and reports foreign launchers without removing them', () => {
    const source = readFileSync('scripts/install-windows-package.ps1', 'utf8')

    expect(source).toContain("Invoke-VersionCheck 'cmd.exe'")
    expect(source).toContain("Invoke-VersionCheck 'PowerShell'")
    expect(source).toContain("Invoke-VersionCheck 'Git Bash'")
    expect(source).toContain('Get-Command reup -All')
    expect(source).toContain('npm uninstall --global @patriziofilloramo/reup')
    expect(source).toContain('never removes a separately managed npm installation automatically')
    expect(source).not.toMatch(/(?:Remove-Item|npm\s+uninstall).*Roaming\\npm/i)
  })
})
