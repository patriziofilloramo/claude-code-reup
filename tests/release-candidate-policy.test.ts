import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  inspectVsixArchive,
  validateVsixCandidate,
  validateVsixManifestXml,
} from '../scripts/check-vsix.mjs'
import { releaseTreeMutationError } from '../scripts/release-tree-state.mjs'

const checkVsixSource = readFileSync('scripts/check-vsix.mjs', 'utf8')

const requiredVsixEntries = [
  '[Content_Types].xml',
  'extension.vsixmanifest',
  'extension/LICENSE.txt',
  'extension/dist/extension.cjs',
  'extension/dist/extension.cjs.map',
  'extension/media/reup-brand.png',
  'extension/media/reup-brand.svg',
  'extension/media/reup.svg',
  'extension/package.json',
  'extension/readme.md',
]

describe('release candidate integrity policy', () => {
  it('rejects generated changes after a clean release starts', () => {
    expect(releaseTreeMutationError(false, '', 'the release gate')).toBeNull()
    expect(releaseTreeMutationError(true, ' M src/web/client.js', 'the release gate')).toBeNull()
    expect(releaseTreeMutationError(false, ' M src/web/client.js', 'the release gate')).toContain(
      'previously clean working tree'
    )
  })

  it('accepts the minimal packaged VSIX contract', () => {
    expect(
      validateVsixCandidate(
        requiredVsixEntries,
        {
          activationEvents: ['onCommand:reup.openDashboard'],
          engines: { vscode: '^1.90.0' },
          main: './dist/extension.cjs',
          name: 'reup-vscode',
          publisher: 'reup-local',
          version: '0.4.0',
        },
        {
          name: 'reup-vscode',
          publisher: 'reup-local',
          version: '0.4.0',
          vscodeEngine: '^1.90.0',
        }
      )
    ).toEqual([])
  })

  it('rejects source leakage and a mismatched VSIX identity', () => {
    const errors = validateVsixCandidate(
      [
        ...requiredVsixEntries.filter((entry) => entry !== 'extension/dist/extension.cjs'),
        'extension/src/private.ts',
      ],
      {
        activationEvents: [],
        engines: { vscode: '^1.80.0' },
        main: './src/extension.ts',
        name: 'other-extension',
        publisher: 'other-publisher',
        version: '0.3.0',
      },
      {
        name: 'reup-vscode',
        publisher: 'reup-local',
        version: '0.4.0',
        vscodeEngine: '^1.90.0',
      }
    )

    expect(errors).toEqual(
      expect.arrayContaining([
        'VSIX is missing extension/dist/extension.cjs.',
        'VSIX includes forbidden path extension/src/private.ts.',
        'VSIX extension name other-extension does not match reup-vscode.',
        'VSIX extension version 0.3.0 does not match 0.4.0.',
        'VSIX extension publisher other-publisher does not match reup-local.',
        'VSIX extension main must point to ./dist/extension.cjs.',
        'VSIX VS Code engine ^1.80.0 does not match ^1.90.0.',
        'VSIX extension must declare activation events.',
      ])
    )
  })

  it('validates the generated VSIX identity manifest', () => {
    const expected = {
      name: 'reup-vscode',
      publisher: 'reup-local',
      version: '0.4.0',
    }
    const manifest = `<?xml version="1.0"?>
      <PackageManifest>
        <Identity Id="reup-vscode" Version="0.4.0" Publisher="reup-local" />
        <InstallationTarget Id="Microsoft.VisualStudio.Code" />
        <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" />
      </PackageManifest>`

    expect(validateVsixManifestXml(manifest, expected)).toEqual([])
    expect(
      validateVsixManifestXml(
        manifest
          .replace('Version="0.4.0"', 'Version="0.3.0"')
          .replace('Path="extension/package.json"', 'Path="extension/missing.json"'),
        expected
      )
    ).toEqual(
      expect.arrayContaining([
        'VSIX manifest version 0.3.0 does not match 0.4.0.',
        'VSIX manifest must reference extension/package.json as its code manifest.',
      ])
    )
  })

  it('rejects duplicate, unsafe, and unexpected VSIX archive paths', () => {
    const entries = [
      ...requiredVsixEntries,
      'extension/media/reup.svg',
      '../outside.txt',
      'extension/credentials.json',
    ]

    const errors = validateVsixCandidate(
      entries,
      {
        activationEvents: ['onCommand:reup.openDashboard'],
        engines: { vscode: '^1.90.0' },
        main: './dist/extension.cjs',
        name: 'reup-vscode',
        publisher: 'reup-local',
        version: '0.4.0',
      },
      {
        name: 'reup-vscode',
        publisher: 'reup-local',
        version: '0.4.0',
        vscodeEngine: '^1.90.0',
      }
    )

    expect(errors).toEqual(
      expect.arrayContaining([
        'VSIX contains duplicate archive paths.',
        'VSIX includes unsafe path ../outside.txt.',
        'VSIX includes unexpected path extension/credentials.json.',
      ])
    )
  })

  it('inspects ZIP contents in-process and preserves duplicate paths', async () => {
    const packageManifest = JSON.stringify({ name: 'reup-vscode', version: '0.4.0' })
    const vsixManifest = '<PackageManifest />'
    const fixture = createStoredZip([
      ['extension/package.json', packageManifest],
      ['extension.vsixmanifest', vsixManifest],
      ['extension/package.json', packageManifest],
    ])

    await withTemporaryVsix(fixture, async (path) => {
      const inspected = await inspectVsixArchive(path)

      expect(inspected.entries).toEqual([
        'extension/package.json',
        'extension.vsixmanifest',
        'extension/package.json',
      ])
      expect(inspected.capturedText.get('extension/package.json')).toBe(packageManifest)
      expect(inspected.capturedText.get('extension.vsixmanifest')).toBe(vsixManifest)
      expect(inspected.totalUncompressedBytes).toBe(
        Buffer.byteLength(packageManifest) * 2 + Buffer.byteLength(vsixManifest)
      )
    })

    expect(checkVsixSource).not.toContain('node:child_process')
    expect(checkVsixSource).toContain('inspectVsixArchive(vsixPath)')
  })

  it('rejects malformed ZIPs and oversized metadata before parsing manifests', async () => {
    await withTemporaryVsix(Buffer.from('not a ZIP archive'), async (path) => {
      await expect(inspectVsixArchive(path)).rejects.toThrow('Unable to inspect VSIX ZIP')
    })

    const oversized = createStoredZip([['extension/package.json', 'x'.repeat(256 * 1024 + 1)]])
    await withTemporaryVsix(oversized, async (path) => {
      await expect(inspectVsixArchive(path)).rejects.toThrow(
        'extension/package.json must be at most 262144 bytes'
      )
    })
  })

  it('leaves no handle on the archive, on every rejection path', async () => {
    // yauzl never waits for its descriptor: ZipFile.close() only unrefs, and a
    // failed open() calls fs.close(fd) without awaiting it. Both paths settled
    // while the file was still locked. POSIX allows unlinking an open file, so
    // this only ever surfaced on Windows — as ENOTEMPTY from the caller's
    // cleanup, which reads like a flaky test rather than a held handle. Both
    // rejection paths are covered because each failed CI separately: the
    // malformed archive fails before a ZipFile exists, the corrupted one fails
    // after an entry stream has already been opened.
    const corruptedContents = 'crc-fixture-contents'
    const corrupted = createStoredZip([['extension/package.json', corruptedContents]])
    corrupted[corrupted.indexOf(Buffer.from(corruptedContents))] ^= 0xff

    const cases: Array<readonly [string, Buffer, string]> = [
      [
        'malformed',
        Buffer.from('this is not a zip archive'),
        'End of central directory record signature not found',
      ],
      ['corrupted', corrupted, 'failed CRC-32 validation'],
    ]

    for (const [name, contents, expected] of cases) {
      const directory = mkdtempSync(join(tmpdir(), `reup-vsix-handle-${name}-`))
      try {
        const path = join(directory, 'fixture.vsix')
        writeFileSync(path, contents)

        await expect(inspectVsixArchive(path)).rejects.toThrow(expected)

        // Renaming observes the handle without depending on cleanup ordering:
        // Windows refuses it while a descriptor is open, POSIX does not care.
        expect(() => renameSync(path, join(directory, 'released.vsix'))).not.toThrow()
      } finally {
        rmSync(directory, { force: true, recursive: true })
      }
    }
  })

  it('rejects same-length archive corruption through per-entry CRC-32 validation', async () => {
    const originalContents = 'crc-fixture-contents'
    const corrupted = createStoredZip([['extension/package.json', originalContents]])
    const contentOffset = corrupted.indexOf(Buffer.from(originalContents))
    expect(contentOffset).toBeGreaterThan(-1)
    corrupted[contentOffset] ^= 0xff

    await withTemporaryVsix(corrupted, async (path) => {
      await expect(inspectVsixArchive(path)).rejects.toThrow(
        'extension/package.json failed CRC-32 validation'
      )
    })
  })
})

async function withTemporaryVsix(
  contents: Buffer,
  callback: (path: string) => Promise<void>
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'reup-vsix-test-'))
  const path = join(directory, 'fixture.vsix')
  try {
    writeFileSync(path, contents)
    await callback(path)
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
}

function createStoredZip(files: Array<readonly [name: string, contents: string]>): Buffer {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let localOffset = 0

  for (const [name, contents] of files) {
    const nameBytes = Buffer.from(name, 'utf8')
    const data = Buffer.from(contents, 'utf8')
    const checksum = crc32(data)
    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt16LE(0x0800, 6)
    localHeader.writeUInt16LE(0, 8)
    localHeader.writeUInt32LE(checksum, 14)
    localHeader.writeUInt32LE(data.length, 18)
    localHeader.writeUInt32LE(data.length, 22)
    localHeader.writeUInt16LE(nameBytes.length, 26)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0)
    centralHeader.writeUInt16LE(20, 4)
    centralHeader.writeUInt16LE(20, 6)
    centralHeader.writeUInt16LE(0x0800, 8)
    centralHeader.writeUInt16LE(0, 10)
    centralHeader.writeUInt32LE(checksum, 16)
    centralHeader.writeUInt32LE(data.length, 20)
    centralHeader.writeUInt32LE(data.length, 24)
    centralHeader.writeUInt16LE(nameBytes.length, 28)
    centralHeader.writeUInt32LE(localOffset, 42)

    localParts.push(localHeader, nameBytes, data)
    centralParts.push(centralHeader, nameBytes)
    localOffset += localHeader.length + nameBytes.length + data.length
  }

  const centralSize = centralParts.reduce((total, part) => total + part.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(localOffset, 16)

  return Buffer.concat([...localParts, ...centralParts, end])
}

function crc32(contents: Buffer): number {
  let checksum = 0xffffffff
  for (const byte of contents) {
    checksum ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      checksum = (checksum >>> 1) ^ (0xedb88320 & -(checksum & 1))
    }
  }
  return (checksum ^ 0xffffffff) >>> 0
}
