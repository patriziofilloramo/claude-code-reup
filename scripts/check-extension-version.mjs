import { execFileSync } from 'node:child_process'
import console from 'node:console'
import { readFileSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import process from 'node:process'

const ZERO_SHA = /^0+$/
const base = process.argv[2] || process.env.EXTENSION_VERSION_BASE
const sourceMapPath = process.argv[3] || 'extension/dist/extension.cjs.map'

if (!base || ZERO_SHA.test(base)) {
  console.log('Extension version check skipped: no comparable base commit.')
  process.exit(0)
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

function normalizePath(path) {
  return path.split(sep).join('/')
}

function parseVersion(value, label) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/.exec(value)
  if (!match) throw new Error(`${label} extension version is not valid SemVer: ${value}`)
  return match.slice(1, 4).map(Number)
}

function isGreaterVersion(current, previous) {
  const currentParts = parseVersion(current, 'Current')
  const previousParts = parseVersion(previous, 'Base')
  for (let index = 0; index < currentParts.length; index += 1) {
    if (currentParts[index] !== previousParts[index]) {
      return currentParts[index] > previousParts[index]
    }
  }
  return false
}

try {
  git(['cat-file', '-e', `${base}^{commit}`])
} catch {
  console.log(`Extension version check skipped: base commit ${base} is unavailable.`)
  process.exit(0)
}

let baseManifest
try {
  baseManifest = JSON.parse(git(['show', `${base}:extension/package.json`]))
} catch {
  console.log('Extension version check skipped: the base commit has no extension manifest.')
  process.exit(0)
}

const currentManifest = JSON.parse(readFileSync('extension/package.json', 'utf8'))
const changedPaths = git(['diff', '--name-only', `${base}...HEAD`])
  .split(/\r?\n/)
  .filter(Boolean)

const sourceMap = JSON.parse(readFileSync(sourceMapPath, 'utf8'))
const sourceMapDirectory = dirname(resolve(sourceMapPath))
const bundledInputs = new Set(
  sourceMap.sources.map((source) =>
    normalizePath(relative(process.cwd(), resolve(sourceMapDirectory, source)))
  )
)

const packagedPaths = new Set([
  'extension/.vscodeignore',
  'extension/LICENSE',
  'extension/README.md',
  'extension/esbuild.mjs',
  'extension/package.json',
])

const releaseChanges = changedPaths.filter(
  (path) =>
    bundledInputs.has(path) || packagedPaths.has(path) || path.startsWith('extension/media/')
)

if (releaseChanges.length === 0) {
  console.log('Extension version check passed: no installable extension changes.')
  process.exit(0)
}

if (!isGreaterVersion(currentManifest.version, baseManifest.version)) {
  console.error(
    [
      `Installable extension files changed without a version bump (${baseManifest.version}).`,
      'Increment extension/package.json before merging, for example:',
      '  npm version patch --prefix extension --no-git-tag-version',
      'Release-affecting files:',
      ...releaseChanges.map((path) => `  - ${path}`),
    ].join('\n')
  )
  process.exit(1)
}

console.log(
  `Extension version check passed: ${baseManifest.version} -> ${currentManifest.version}.`
)
