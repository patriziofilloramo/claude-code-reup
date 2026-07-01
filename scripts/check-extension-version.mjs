import { execFileSync } from 'node:child_process'
import console from 'node:console'
import { readFileSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import process from 'node:process'

const ZERO_SHA = /^0+$/
const base =
  process.argv[2] || process.env.PRODUCT_VERSION_BASE || process.env.EXTENSION_VERSION_BASE
const sourceMapPath = process.argv[3] || 'extension/dist/extension.cjs.map'

execFileSync(process.execPath, ['scripts/check-version-sync.mjs'], { stdio: 'inherit' })

if (!base || ZERO_SHA.test(base)) {
  console.log('Product version check skipped: no comparable base commit.')
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
  if (!match) throw new Error(`${label} product version is not valid SemVer: ${value}`)
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
  console.log(`Product version check skipped: base commit ${base} is unavailable.`)
  process.exit(0)
}

let basePackage
try {
  basePackage = JSON.parse(git(['show', `${base}:package.json`]))
} catch {
  console.log('Product version check skipped: the base commit has no root package manifest.')
  process.exit(0)
}

const currentPackage = JSON.parse(readFileSync('package.json', 'utf8'))
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
  'extension/package-lock.json',
  'package.json',
  'package-lock.json',
  'README.md',
  'src/config/version.ts',
])

const releaseChanges = changedPaths.filter(
  (path) =>
    path.startsWith('src/') ||
    bundledInputs.has(path) ||
    packagedPaths.has(path) ||
    path.startsWith('extension/media/')
)

if (releaseChanges.length === 0) {
  console.log('Product version check passed: no installable product changes.')
  process.exit(0)
}

if (!isGreaterVersion(currentPackage.version, basePackage.version)) {
  console.error(
    [
      `Installable product files changed without a root version bump (${basePackage.version}).`,
      'Increment the canonical Reup version before merging, for example:',
      '  npm run version:patch',
      'Release-affecting files:',
      ...releaseChanges.map((path) => `  - ${path}`),
    ].join('\n')
  )
  process.exit(1)
}

console.log(`Product version check passed: ${basePackage.version} -> ${currentPackage.version}.`)
