import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'

import { describe, expect, it } from 'vitest'

import { windowsCmdLauncher, windowsPosixLauncher } from '../scripts/windows-launchers.mjs'

const CURRENT_VERSION = '9.8.7-current'
const OLD_VERSION = '0.2.1-old'

interface PosixShell {
  args: string[]
  command: string
}

interface LauncherFixture {
  currentBin: string
  oldBin: string
  root: string
}

function findPosixShell(): PosixShell | undefined {
  if (process.platform !== 'win32') {
    for (const command of ['sh', 'bash']) {
      const result = spawnSync(command, ['-c', 'exit 0'], { stdio: 'ignore' })
      if (!result.error && result.status === 0) return { command, args: ['-c'] }
    }
    return undefined
  }

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

  for (const command of [...new Set(candidates)]) {
    if (!existsSync(command)) continue
    const result = spawnSync(command, ['--noprofile', '--norc', '-c', 'exit 0'], {
      stdio: 'ignore',
    })
    if (!result.error && result.status === 0) {
      return { command, args: ['--noprofile', '--norc', '-c'] }
    }
  }

  return undefined
}

function environmentWithPath(entries: string[]): NodeJS.ProcessEnv {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'path')
  )
  const inheritedPath =
    Object.entries(process.env).find(([key]) => key.toLowerCase() === 'path')?.[1] ?? ''
  const pathValue = [...entries, inheritedPath].filter(Boolean).join(delimiter)
  environment[process.platform === 'win32' ? 'Path' : 'PATH'] = pathValue
  return environment
}

function createFixture(): LauncherFixture {
  const root = mkdtempSync(join(tmpdir(), 'reup-windows-launchers-'))
  const currentBin = join(root, 'current', 'bin')
  const currentDist = join(root, 'current', 'app', 'dist')
  const oldBin = join(root, 'old-npm-bin')

  mkdirSync(currentBin, { recursive: true })
  mkdirSync(currentDist, { recursive: true })
  mkdirSync(oldBin, { recursive: true })

  writeFileSync(join(currentDist, 'index.js'), `process.stdout.write('${CURRENT_VERSION}\\n')\n`)
  writeFileSync(join(currentBin, 'reup.cmd'), windowsCmdLauncher())
  writeFileSync(join(currentBin, 'reup'), windowsPosixLauncher())
  writeFileSync(join(oldBin, 'reup'), `#!/bin/sh\nprintf '%s\\n' '${OLD_VERSION}'\n`)
  writeFileSync(join(oldBin, 'reup.cmd'), `@echo off\r\necho ${OLD_VERSION}\r\n`)
  writeFileSync(join(oldBin, 'reup.ps1'), `Write-Output '${OLD_VERSION}'\r\n`)

  chmodSync(join(currentBin, 'reup'), 0o755)
  chmodSync(join(oldBin, 'reup'), 0o755)

  return { currentBin, oldBin, root }
}

function runPosix(shell: PosixShell, command: string, environment: NodeJS.ProcessEnv) {
  return spawnSync(shell.command, [...shell.args, command], {
    encoding: 'utf8',
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

describe('Windows launcher compatibility', () => {
  const posixShell = findPosixShell()
  const posixTest = posixShell ? it : it.skip

  posixTest('lets the extensionless launcher win over an older npm shim later on PATH', () => {
    const fixture = createFixture()
    try {
      const oldOnly = runPosix(posixShell!, 'reup --version', environmentWithPath([fixture.oldBin]))
      expect(oldOnly.status, oldOnly.stderr).toBe(0)
      expect(oldOnly.stdout.trim()).toBe(OLD_VERSION)

      const currentFirst = runPosix(
        posixShell!,
        'reup --version',
        environmentWithPath([fixture.currentBin, fixture.oldBin])
      )
      expect(currentFirst.status, currentFirst.stderr).toBe(0)
      expect(currentFirst.stdout.trim()).toBe(CURRENT_VERSION)
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  it.skipIf(process.platform !== 'win32')(
    'keeps cmd and Windows PowerShell on the execution-policy-independent cmd launcher',
    () => {
      const fixture = createFixture()
      const environment = environmentWithPath([fixture.currentBin, fixture.oldBin])
      try {
        const commandPrompt = spawnSync(
          process.env['ComSpec'] ?? 'cmd.exe',
          ['/d', '/s', '/c', 'reup --version'],
          {
            encoding: 'utf8',
            env: environment,
            stdio: ['ignore', 'pipe', 'pipe'],
          }
        )
        expect(commandPrompt.status, commandPrompt.stderr).toBe(0)
        expect(commandPrompt.stdout.trim()).toBe(CURRENT_VERSION)

        const powerShell = spawnSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Restricted',
            '-Command',
            '(Get-Command reup -ErrorAction Stop).Path; reup --version; exit $LASTEXITCODE',
          ],
          {
            encoding: 'utf8',
            env: environment,
            stdio: ['ignore', 'pipe', 'pipe'],
          }
        )
        expect(powerShell.status, powerShell.stderr).toBe(0)
        const output = powerShell.stdout.trim().split(/\r?\n/)
        expect(resolve(output[0]).toLowerCase()).toBe(
          resolve(fixture.currentBin, 'reup.cmd').toLowerCase()
        )
        expect(output.at(-1)).toBe(CURRENT_VERSION)
      } finally {
        rmSync(fixture.root, { force: true, recursive: true })
      }
    }
  )

  it('packages cmd and POSIX launchers without a PowerShell launcher', () => {
    const source = readFileSync('scripts/build-installers.mjs', 'utf8')

    expect(source).toMatch(/join\(binDir, ['"]reup\.cmd['"]\)/)
    expect(source).toMatch(/join\(binDir, ['"]reup['"]\)/)
    expect(source).not.toMatch(/join\(binDir, ['"]reup\.ps1['"]\)/)
  })
})
