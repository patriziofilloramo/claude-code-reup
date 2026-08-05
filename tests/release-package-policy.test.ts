import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  parsePackReport,
  validatePackageCandidate,
  validatePackageReadmeLinks,
} from '../scripts/check-package.mjs'

const requiredFiles = [
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

function packageReport(overrides: Record<string, unknown> = {}) {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
  return {
    name: manifest.name,
    version: manifest.version,
    filename: 'reup.tgz',
    integrity: 'sha512-test',
    size: 100_000,
    unpackedSize: 500_000,
    entryCount: requiredFiles.length,
    files: requiredFiles.map((path) => ({ path })),
    ...overrides,
  }
}

describe('npm package policy', () => {
  it('accepts the current manifest and a minimal safe package', () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8'))

    expect(validatePackageCandidate(manifest, packageReport())).toEqual([])
  })

  it('rejects leaked repository content and missing runtime assets', () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
    const files = requiredFiles
      .filter((path) => path !== 'dist/index.js')
      .concat('src/private-implementation.ts')
      .map((path) => ({ path }))

    expect(validatePackageCandidate(manifest, packageReport({ files }))).toEqual(
      expect.arrayContaining([
        'Package is missing dist/index.js.',
        'Package includes forbidden path src/private-implementation.ts.',
      ])
    )
  })

  it('rejects unsafe artifact metadata and unexpected package roots', () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
    const files = requiredFiles
      .concat('credentials.json', '../outside.txt')
      .map((path) => ({ path }))

    expect(
      validatePackageCandidate(
        manifest,
        packageReport({ entryCount: files.length, filename: '../reup.tgz', files, size: 0 })
      )
    ).toEqual(
      expect.arrayContaining([
        'Packed filename ../reup.tgz is not a safe .tgz basename.',
        'Packed size must be positive and at most 2097152 bytes.',
        'Package includes unexpected path credentials.json.',
        'Package includes unsafe path ../outside.txt.',
      ])
    )
  })

  it('parses npm JSON after lifecycle output', () => {
    const report = packageReport()
    const output = `prepack output\n${JSON.stringify([report])}\n`

    expect(parsePackReport(output)).toEqual(report)
  })

  it('rejects README links to files omitted from the npm package', () => {
    const packagePaths = new Set(requiredFiles)

    expect(
      validatePackageReadmeLinks(
        '[Architecture](Documents/ARCHITECTURE.md) [Security](SECURITY.md) [Site](https://example.com)',
        packagePaths
      )
    ).toEqual(['README links to unpackaged local path Documents/ARCHITECTURE.md.'])
  })
})
