import console from 'node:console'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import process from 'node:process'

import { resolveReleaseCommand } from './release-command.mjs'

export const releaseValidationCommands = [
  ['npm', ['run', 'check:version']],
  ['npm', ['run', 'format:check']],
  ['npm', ['run', 'lint']],
  ['npm', ['run', 'build']],
  ['npm', ['test']],
  ['npm', ['run', 'build:extension']],
  ['npm', ['run', 'package:extension']],
  ['npm', ['run', 'release:extension:check']],
  ['npm', ['run', 'test:extension-host']],
  ['node', ['--check', 'src/web/client.js']],
  ['npm', ['audit']],
  ['npm', ['audit', '--prefix', 'extension']],
  ['npm', ['run', 'release:package:check']],
  ['git', ['diff', '--check']],
]

export function runReleaseValidationCommands(root = process.cwd()) {
  for (const [command, args] of releaseValidationCommands) {
    console.log(`\n> ${[command, ...args].join(' ')}`)
    const invocation = resolveReleaseCommand(command, args)
    const result = spawnSync(invocation.command, invocation.args, {
      cwd: root,
      stdio: 'inherit',
      shell: false,
    })

    if (result.error) throw result.error
    if (result.status !== 0) process.exit(result.status ?? 1)
  }
}

function isMainModule() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
}

if (isMainModule()) runReleaseValidationCommands()
