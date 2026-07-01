import { readFileSync } from 'node:fs'
import process from 'node:process'

const versionFiles = [
  {
    label: 'root package',
    path: 'package.json',
    read: (content) => JSON.parse(content).version,
  },
  {
    label: 'root lockfile',
    path: 'package-lock.json',
    read: (content) => JSON.parse(content).version,
  },
  {
    label: 'root lockfile package entry',
    path: 'package-lock.json',
    read: (content) => JSON.parse(content).packages?.['']?.version,
  },
  {
    label: 'VS Code extension manifest',
    path: 'extension/package.json',
    read: (content) => JSON.parse(content).version,
  },
  {
    label: 'VS Code extension lockfile',
    path: 'extension/package-lock.json',
    read: (content) => JSON.parse(content).version,
  },
  {
    label: 'VS Code extension lockfile package entry',
    path: 'extension/package-lock.json',
    read: (content) => JSON.parse(content).packages?.['']?.version,
  },
  {
    label: 'generated app version',
    path: 'src/config/version.ts',
    read: (content) => content.match(/APP_VERSION = '([^']+)'/)?.[1],
  },
]

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

const versions = versionFiles.map((entry) => {
  const version = entry.read(readFileSync(entry.path, 'utf8'))
  if (typeof version !== 'string' || version.length === 0) {
    fail(`Unable to read ${entry.label} version from ${entry.path}`)
  }
  return { ...entry, version }
})

const canonicalVersion = versions[0].version
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(canonicalVersion)) {
  fail(`Root package version is not valid SemVer: ${canonicalVersion}`)
}

const mismatches = versions.filter((entry) => entry.version !== canonicalVersion)
if (mismatches.length > 0) {
  fail(
    [
      `Version sync check failed: expected ${canonicalVersion}.`,
      ...mismatches.map((entry) => `  - ${entry.path} (${entry.label}) is ${entry.version}`),
      'Run: npm run sync:version',
    ].join('\n')
  )
}

process.stdout.write(`Version sync check passed: ${canonicalVersion}\n`)
