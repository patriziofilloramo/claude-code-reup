import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'

import { describe, expect, it } from 'vitest'

import { windowsCmdLauncher, windowsPosixLauncher } from '../scripts/windows-launchers.mjs'

const CURRENT_VERSION = '9.8.7'
const OLD_VERSION = '0.2.1'
const PACKAGE_NAME = '@patriziofilloramo/reup'

interface InstallerFixture {
  installDir: string
  root: string
  source: string
}

function findGitBash(): string | undefined {
  if (process.platform !== 'win32') return undefined

  const candidates = [
    process.env['ProgramFiles'] && join(process.env['ProgramFiles'], 'Git', 'bin', 'bash.exe'),
    process.env['ProgramFiles(x86)'] &&
      join(process.env['ProgramFiles(x86)'], 'Git', 'bin', 'bash.exe'),
    process.env['LOCALAPPDATA'] &&
      join(process.env['LOCALAPPDATA'], 'Programs', 'Git', 'bin', 'bash.exe'),
  ].filter((candidate): candidate is string => Boolean(candidate))

  const gitLookup = spawnSync('where.exe', ['git.exe'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  if (!gitLookup.error && gitLookup.status === 0) {
    for (const gitPath of gitLookup.stdout.split(/\r?\n/).filter(Boolean)) {
      candidates.push(resolve(dirname(gitPath), '..', 'bin', 'bash.exe'))
    }
  }
  return [...new Set(candidates)].find((candidate) => existsSync(candidate))
}

function writeManifest(path: string, version: string) {
  writeFileSync(path, `${JSON.stringify({ name: PACKAGE_NAME, version })}\n`)
}

function createFixture(
  options: { brokenPosixLauncher?: boolean; withInnoMetadata?: boolean } = {}
): InstallerFixture {
  const root = mkdtempSync(join(tmpdir(), 'reup-windows-installer-'))
  const source = join(root, 'package with spaces')
  const sourceApp = join(source, 'app')
  const sourceDist = join(sourceApp, 'dist')
  const sourceBin = join(source, 'bin')
  const installDir = join(root, 'installed Reup')
  const oldApp = join(installDir, 'app')
  const oldBin = join(installDir, 'bin')

  mkdirSync(sourceDist, { recursive: true })
  mkdirSync(sourceBin, { recursive: true })
  mkdirSync(join(oldApp, 'dist'), { recursive: true })
  mkdirSync(oldBin, { recursive: true })

  writeManifest(join(sourceApp, 'package.json'), CURRENT_VERSION)
  writeFileSync(
    join(sourceDist, 'index.js'),
    [
      "if (!process.argv.includes('--version')) process.exit(2)",
      `process.stdout.write('${CURRENT_VERSION}\\n')`,
      '',
    ].join('\n')
  )
  writeFileSync(join(sourceBin, 'reup.cmd'), windowsCmdLauncher())
  writeFileSync(
    join(sourceBin, 'reup'),
    options.brokenPosixLauncher
      ? `#!/usr/bin/env sh\nprintf '%s\\n' 'wrong-version'\n`
      : windowsPosixLauncher()
  )

  writeManifest(join(oldApp, 'package.json'), OLD_VERSION)
  writeFileSync(join(oldApp, 'dist', 'index.js'), `process.stdout.write('${OLD_VERSION}\\n')\n`)
  writeFileSync(join(oldBin, 'reup.cmd'), `@echo off\r\necho ${OLD_VERSION}\r\n`)
  writeFileSync(join(oldBin, 'reup.ps1'), `Write-Output '${OLD_VERSION}'\r\n`)
  writeFileSync(
    join(installDir, '.reup-portable-install.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      installKind: 'portable-windows',
      packageName: PACKAGE_NAME,
      pathTarget: 'Process',
      version: OLD_VERSION,
    })}\n`
  )
  writeFileSync(join(installDir, 'user-note.txt'), 'preserve me')
  if (options.withInnoMetadata) {
    writeFileSync(join(installDir, 'unins000.exe'), 'native installer metadata')
  }

  return { installDir, root, source }
}

function runPackageScript(script: string, fixture: InstallerFixture) {
  return spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      resolve(script),
      '-InstallDir',
      fixture.installDir,
      '-Source',
      fixture.source,
      '-PathTarget',
      'Process',
    ],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  )
}

function readJson(path: string) {
  return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''))
}

describe.skipIf(process.platform !== 'win32')('Windows portable installer', () => {
  it('upgrades and uninstalls only its owned runtime while preserving unrelated files', () => {
    const fixture = createFixture()
    try {
      const install = runPackageScript('scripts/install-windows-package.ps1', fixture)
      expect(install.status, `${install.stdout}\n${install.stderr}`).toBe(0)
      expect(readJson(join(fixture.installDir, 'app', 'package.json')).version).toBe(
        CURRENT_VERSION
      )
      expect(readJson(join(fixture.installDir, '.reup-portable-install.json'))).toMatchObject({
        installKind: 'portable-windows',
        packageName: PACKAGE_NAME,
        pathTarget: 'Process',
        version: CURRENT_VERSION,
      })
      expect(existsSync(join(fixture.installDir, 'bin', 'reup'))).toBe(true)
      expect(existsSync(join(fixture.installDir, 'bin', 'reup.cmd'))).toBe(true)
      expect(existsSync(join(fixture.installDir, 'bin', 'reup.ps1'))).toBe(false)
      expect(existsSync(join(fixture.installDir, 'user-note.txt'))).toBe(true)

      const uninstall = runPackageScript('scripts/uninstall-windows-package.ps1', fixture)
      expect(uninstall.status, `${uninstall.stdout}\n${uninstall.stderr}`).toBe(0)
      expect(existsSync(join(fixture.installDir, 'app'))).toBe(false)
      expect(existsSync(join(fixture.installDir, 'bin'))).toBe(false)
      expect(existsSync(join(fixture.installDir, '.reup-portable-install.json'))).toBe(false)
      expect(readFileSync(join(fixture.installDir, 'user-note.txt'), 'utf8')).toBe('preserve me')
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  }, 60_000)

  it('refuses to overlay a runtime owned by Inno Setup', () => {
    const fixture = createFixture({ withInnoMetadata: true })
    try {
      const install = runPackageScript('scripts/install-windows-package.ps1', fixture)
      expect(install.status).not.toBe(0)
      expect(`${install.stdout}\n${install.stderr}`).toContain(
        'Refusing to overlay the portable package on an Inno Setup installation'
      )
      expect(readJson(join(fixture.installDir, 'app', 'package.json')).version).toBe(OLD_VERSION)
      expect(existsSync(join(fixture.installDir, 'bin', 'reup.ps1'))).toBe(true)
      expect(readFileSync(join(fixture.installDir, 'unins000.exe'), 'utf8')).toBe(
        'native installer metadata'
      )
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  const rollbackTest = findGitBash() ? it : it.skip
  rollbackTest(
    'restores the previous runtime and marker when a post-swap shell check fails',
    () => {
      const fixture = createFixture({ brokenPosixLauncher: true })
      try {
        const install = runPackageScript('scripts/install-windows-package.ps1', fixture)
        expect(install.status).not.toBe(0)
        expect(`${install.stdout}\n${install.stderr}`).toContain('Git Bash resolved the wrong Reup')
        expect(readJson(join(fixture.installDir, 'app', 'package.json')).version).toBe(OLD_VERSION)
        expect(readJson(join(fixture.installDir, '.reup-portable-install.json')).version).toBe(
          OLD_VERSION
        )
        expect(existsSync(join(fixture.installDir, 'bin', 'reup.ps1'))).toBe(true)
        expect(readdirSync(fixture.root).some((name) => name.startsWith('.reup-install-'))).toBe(
          false
        )
      } finally {
        rmSync(fixture.root, { force: true, recursive: true })
      }
    },
    60_000
  )
})
