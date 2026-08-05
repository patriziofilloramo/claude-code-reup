import console from 'node:console'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { resolve } from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'

import { resolveReleaseCommand } from './release-command.mjs'

const MAX_PACKED_BYTES = 2 * 1024 * 1024
const MAX_UNPACKED_BYTES = 5 * 1024 * 1024
const MAX_ENTRY_COUNT = 1_000

const REQUIRED_PACKAGE_FILES = [
  'DISCLAIMER.md',
  'LICENSE',
  'PRIVACY.md',
  'README.md',
  'SECURITY.md',
  'SUPPORT.md',
  'dist/index.js',
  'dist/web/client.js',
  'dist/web/styles.css',
  'dist/web/ui.html',
  'package.json',
]

const ALLOWED_PACKAGE_ROOT_FILES = new Set([
  'DISCLAIMER.md',
  'LICENSE',
  'PRIVACY.md',
  'README.md',
  'SECURITY.md',
  'SUPPORT.md',
  'package.json',
])

const FORBIDDEN_PACKAGE_PREFIXES = [
  '.env',
  '.git/',
  '.github/',
  'Documents/',
  'extension/',
  'node_modules/',
  'release/',
  'scripts/',
  'src/',
  'tests/',
]

export function validatePackageCandidate(manifest, packReport, readme = null) {
  const errors = []

  if (!isNonEmptyString(manifest.name)) errors.push('package.json must define a package name.')
  if (!isNonEmptyString(manifest.version)) errors.push('package.json must define a version.')
  if (manifest.private === true) errors.push('The npm package must not be marked private.')
  if (manifest.bin?.reup !== './dist/index.js') {
    errors.push('The reup binary must point to ./dist/index.js.')
  }
  if (manifest.engines?.node !== '>=20') errors.push('The npm package must require Node.js >=20.')
  if (!isNonEmptyString(manifest.author?.name)) errors.push('Author metadata is required.')
  if (!isHttpsUrl(manifest.homepage)) errors.push('An HTTPS homepage is required.')
  if (!isNonEmptyString(manifest.repository?.url)) errors.push('Repository metadata is required.')
  if (!isHttpsUrl(manifest.bugs?.url)) errors.push('An HTTPS issue tracker is required.')
  if (!Array.isArray(manifest.keywords) || manifest.keywords.length < 5) {
    errors.push('At least five npm search keywords are required.')
  }
  if (manifest.publishConfig?.access !== 'public') {
    errors.push('publishConfig.access must be public for the scoped beta package.')
  }
  if (manifest.publishConfig?.registry !== 'https://registry.npmjs.org/') {
    errors.push('publishConfig.registry must target the public npm registry over HTTPS.')
  }
  if (manifest.scripts?.postinstall) {
    errors.push('The npm package must not mutate user machines from a postinstall script.')
  }

  if (!packReport || typeof packReport !== 'object') {
    errors.push('npm pack did not return a package report.')
    return errors
  }

  if (packReport.name !== manifest.name) {
    errors.push(`Packed name ${String(packReport.name)} does not match ${String(manifest.name)}.`)
  }
  if (packReport.version !== manifest.version) {
    errors.push(
      `Packed version ${String(packReport.version)} does not match ${String(manifest.version)}.`
    )
  }
  if (!isNonEmptyString(packReport.integrity)) {
    errors.push('npm pack did not report a content integrity hash.')
  }
  if (!isSafeTarballFilename(packReport.filename)) {
    errors.push(`Packed filename ${String(packReport.filename)} is not a safe .tgz basename.`)
  }
  if (
    !Number.isFinite(packReport.size) ||
    packReport.size <= 0 ||
    packReport.size > MAX_PACKED_BYTES
  ) {
    errors.push(`Packed size must be positive and at most ${MAX_PACKED_BYTES} bytes.`)
  }
  if (
    !Number.isFinite(packReport.unpackedSize) ||
    packReport.unpackedSize <= 0 ||
    packReport.unpackedSize > MAX_UNPACKED_BYTES
  ) {
    errors.push(`Unpacked size must be positive and at most ${MAX_UNPACKED_BYTES} bytes.`)
  }
  if (
    !Number.isInteger(packReport.entryCount) ||
    packReport.entryCount <= 0 ||
    packReport.entryCount > MAX_ENTRY_COUNT
  ) {
    errors.push(`Package entry count must be positive and at most ${MAX_ENTRY_COUNT}.`)
  }

  const files = Array.isArray(packReport.files) ? packReport.files : []
  const packagePaths = new Set(files.map((file) => file?.path).filter(isNonEmptyString))
  for (const requiredPath of REQUIRED_PACKAGE_FILES) {
    if (!packagePaths.has(requiredPath)) errors.push(`Package is missing ${requiredPath}.`)
  }

  for (const packagePath of packagePaths) {
    if (!isSafeArchivePath(packagePath)) {
      errors.push(`Package includes unsafe path ${packagePath}.`)
      continue
    }
    if (FORBIDDEN_PACKAGE_PREFIXES.some((prefix) => packagePath.startsWith(prefix))) {
      errors.push(`Package includes forbidden path ${packagePath}.`)
    }
    if (!packagePath.startsWith('dist/') && !ALLOWED_PACKAGE_ROOT_FILES.has(packagePath)) {
      errors.push(`Package includes unexpected path ${packagePath}.`)
    }
  }

  if (typeof readme === 'string') {
    errors.push(...validatePackageReadmeLinks(readme, packagePaths))
  }

  return errors
}

/** Ensures npm's rendered README does not point at files omitted from the tarball. */
export function validatePackageReadmeLinks(readme, packagePaths) {
  const errors = []
  const markdownLink = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+['"][^'"]*['"])?\)/g
  for (const match of readme.matchAll(markdownLink)) {
    const rawTarget = match[1]?.replace(/^<|>$/g, '')
    if (!rawTarget || /^(?:https?:|mailto:|#)/i.test(rawTarget)) continue
    const localPath = rawTarget.split(/[?#]/, 1)[0]?.replace(/^\.\//, '')
    if (localPath && !packagePaths.has(localPath)) {
      errors.push(`README links to unpackaged local path ${localPath}.`)
    }
  }
  return [...new Set(errors)]
}

export function parsePackReport(output) {
  const firstArray = output.indexOf('[')
  if (firstArray < 0) throw new Error('npm pack did not emit a JSON array.')

  const reports = JSON.parse(output.slice(firstArray).trim())
  if (!Array.isArray(reports) || reports.length !== 1) {
    throw new Error(
      `Expected one npm pack report, received ${Array.isArray(reports) ? reports.length : 0}.`
    )
  }
  return reports[0]
}

function runNpmPackDryRun() {
  const npmArgs = ['pack', '--dry-run', '--json']
  const invocation = resolveReleaseCommand('npm', npmArgs)

  const result = spawnSync(invocation.command, invocation.args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      ['npm pack --dry-run --json failed.', result.stdout?.trim(), result.stderr?.trim()]
        .filter(Boolean)
        .join('\n')
    )
  }
  return result.stdout
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function isSafeTarballFilename(value) {
  return isNonEmptyString(value) && /^[0-9A-Za-z][0-9A-Za-z._-]*\.tgz$/.test(value)
}

function isSafeArchivePath(value) {
  if (!isNonEmptyString(value) || value.includes('\\') || value.startsWith('/')) return false
  const parts = value.split('/')
  return parts.every((part) => part.length > 0 && part !== '.' && part !== '..')
}

function isHttpsUrl(value) {
  if (!isNonEmptyString(value)) return false
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

function isMainModule() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
}

if (isMainModule()) {
  try {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
    const packReport = parsePackReport(runNpmPackDryRun())
    const errors = validatePackageCandidate(manifest, packReport, readFileSync('README.md', 'utf8'))

    if (errors.length > 0) {
      console.error(
        ['npm package verification failed:', ...errors.map((error) => `- ${error}`)].join('\n')
      )
      process.exitCode = 1
    } else {
      console.log(
        `npm package verified: ${packReport.filename} (${packReport.entryCount} files, ${packReport.size} bytes)`
      )
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
