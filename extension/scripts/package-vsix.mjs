import { spawnSync } from 'node:child_process'
import console from 'node:console'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const extensionRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(extensionRoot, 'package.json'), 'utf8'))
const outputPath = join(extensionRoot, 'dist', `reup-vscode-${manifest.version}.vsix`)
const vsceEntryPoint = join(extensionRoot, 'node_modules', '@vscode', 'vsce', 'vsce')

const result = spawnSync(process.execPath, [vsceEntryPoint, 'package', '--out', outputPath], {
  cwd: extensionRoot,
  encoding: 'utf8',
  shell: false,
  stdio: 'inherit',
})

if (result.error) {
  console.error('Unable to run VSCE. Run "npm ci --prefix extension" first.')
  throw result.error
}

if (result.status !== 0) process.exitCode = result.status ?? 1
else console.log(`VSIX ready: ${outputPath}`)
