import { spawnSync } from 'node:child_process'
import console from 'node:console'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const extensionRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(extensionRoot, 'package.json'), 'utf8'))
const vsixPath = join(extensionRoot, 'dist', `reup-vscode-${manifest.version}.vsix`)
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const codeCommand =
  process.env.REUP_VSCODE_CLI || (process.platform === 'win32' ? 'code.cmd' : 'code')
const vsceCommand = join(
  extensionRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'vsce.cmd' : 'vsce'
)

function run(command, args, failureMessage) {
  const result = spawnSync(command, args, {
    cwd: extensionRoot,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: 'inherit',
  })

  if (result.error || result.status !== 0) {
    if (failureMessage) console.error(failureMessage)
    if (result.error) console.error(result.error.message)
    process.exit(result.status ?? 1)
  }
}

if (!existsSync(vsceCommand)) {
  console.log('Installing VS Code extension build dependencies...')
  run(npmCommand, ['ci'], 'Unable to install extension dependencies.')
}

run(npmCommand, ['run', 'package:vsix'], 'Unable to build the local VSIX.')
run(
  codeCommand,
  ['--install-extension', vsixPath, '--force'],
  [
    `Unable to run "${codeCommand}".`,
    'Install the VS Code shell command, or set REUP_VSCODE_CLI to its executable path.',
    'You can also install the generated VSIX with "Extensions: Install from VSIX...".',
  ].join('\n')
)

console.log(`Installed Reup for Claude Code ${manifest.version}. Reload VS Code to activate it.`)
