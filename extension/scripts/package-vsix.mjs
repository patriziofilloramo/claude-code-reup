import { spawnSync } from 'node:child_process'
import console from 'node:console'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const extensionRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(extensionRoot, 'package.json'), 'utf8'))
const outputPath = join(extensionRoot, 'dist', `swoop-vscode-${manifest.version}.vsix`)
const command = process.platform === 'win32' ? 'vsce.cmd' : 'vsce'

const result = spawnSync(command, ['package', '--out', outputPath], {
  cwd: extensionRoot,
  encoding: 'utf8',
  shell: process.platform === 'win32',
  stdio: 'inherit',
})

if (result.error) {
  console.error(`Unable to run ${command}. Run "npm ci --prefix extension" first.`)
  throw result.error
}

if (result.status !== 0) process.exitCode = result.status ?? 1
else console.log(`VSIX ready: ${outputPath}`)
