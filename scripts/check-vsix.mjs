import { Buffer } from 'node:buffer'
import console from 'node:console'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { TextDecoder } from 'node:util'

import yauzl from 'yauzl'

const MAX_VSIX_BYTES = 5 * 1024 * 1024
const MAX_ENTRY_COUNT = 500
const MAX_UNCOMPRESSED_VSIX_BYTES = 20 * 1024 * 1024
const MAX_METADATA_ENTRY_BYTES = 256 * 1024
const CRC32_POLYNOMIAL = 0xedb88320

const CAPTURED_TEXT_ENTRIES = new Set(['extension/package.json', 'extension.vsixmanifest'])
const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, byte) => {
  let remainder = byte
  for (let bit = 0; bit < 8; bit += 1) {
    remainder = (remainder >>> 1) ^ (remainder & 1 ? CRC32_POLYNOMIAL : 0)
  }
  return remainder >>> 0
})

const REQUIRED_ENTRIES = [
  '[Content_Types].xml',
  'extension.vsixmanifest',
  'extension/LICENSE.txt',
  'extension/dist/extension.cjs',
  'extension/media/reup.svg',
  'extension/package.json',
  'extension/readme.md',
]

const ALLOWED_ENTRIES = new Set([
  ...REQUIRED_ENTRIES,
  'extension/dist/extension.cjs.map',
  'extension/media/reup-brand.png',
  'extension/media/reup-brand.svg',
])

const FORBIDDEN_PREFIXES = [
  'extension/.env',
  'extension/.git/',
  'extension/.vscode/',
  'extension/node_modules/',
  'extension/scripts/',
  'extension/src/',
]

export function validateVsixCandidate(entries, manifest, expected) {
  const errors = []
  const entrySet = new Set(entries)

  if (entrySet.size !== entries.length) errors.push('VSIX contains duplicate archive paths.')

  for (const entry of REQUIRED_ENTRIES) {
    if (!entrySet.has(entry)) errors.push(`VSIX is missing ${entry}.`)
  }
  for (const entry of entrySet) {
    if (!isSafeArchivePath(entry)) {
      errors.push(`VSIX includes unsafe path ${entry}.`)
      continue
    }
    if (FORBIDDEN_PREFIXES.some((prefix) => entry.startsWith(prefix))) {
      errors.push(`VSIX includes forbidden path ${entry}.`)
    }
    if (!ALLOWED_ENTRIES.has(entry)) errors.push(`VSIX includes unexpected path ${entry}.`)
  }
  if (entrySet.size > MAX_ENTRY_COUNT) {
    errors.push(`VSIX entry count must be at most ${MAX_ENTRY_COUNT}.`)
  }

  if (manifest.name !== expected.name) {
    errors.push(`VSIX extension name ${String(manifest.name)} does not match ${expected.name}.`)
  }
  if (manifest.version !== expected.version) {
    errors.push(
      `VSIX extension version ${String(manifest.version)} does not match ${expected.version}.`
    )
  }
  if (manifest.publisher !== expected.publisher) {
    errors.push(
      `VSIX extension publisher ${String(manifest.publisher)} does not match ${expected.publisher}.`
    )
  }
  if (manifest.main !== './dist/extension.cjs') {
    errors.push('VSIX extension main must point to ./dist/extension.cjs.')
  }
  if (manifest.engines?.vscode !== expected.vscodeEngine) {
    errors.push(
      `VSIX VS Code engine ${String(manifest.engines?.vscode)} does not match ${expected.vscodeEngine}.`
    )
  }
  if (!Array.isArray(manifest.activationEvents) || manifest.activationEvents.length === 0) {
    errors.push('VSIX extension must declare activation events.')
  }
  return errors
}

export function validateVsixManifestXml(xml, expected) {
  if (typeof xml !== 'string' || xml.trim().length === 0) {
    return ['VSIX extension.vsixmanifest must contain XML.']
  }

  const errors = []
  const identity = readXmlTagAttributes(xml, 'Identity')
  if (!identity) {
    errors.push('VSIX extension.vsixmanifest is missing its Identity element.')
  } else {
    if (identity.Id !== expected.name) {
      errors.push(`VSIX manifest identity ${String(identity.Id)} does not match ${expected.name}.`)
    }
    if (identity.Version !== expected.version) {
      errors.push(
        `VSIX manifest version ${String(identity.Version)} does not match ${expected.version}.`
      )
    }
    if (identity.Publisher !== expected.publisher) {
      errors.push(
        `VSIX manifest publisher ${String(identity.Publisher)} does not match ${expected.publisher}.`
      )
    }
  }

  const installationTargets = readAllXmlTagAttributes(xml, 'InstallationTarget')
  if (!installationTargets.some((attributes) => attributes.Id === 'Microsoft.VisualStudio.Code')) {
    errors.push('VSIX manifest must target Microsoft.VisualStudio.Code.')
  }

  const assets = readAllXmlTagAttributes(xml, 'Asset')
  if (
    !assets.some(
      (attributes) =>
        attributes.Type === 'Microsoft.VisualStudio.Code.Manifest' &&
        attributes.Path === 'extension/package.json'
    )
  ) {
    errors.push('VSIX manifest must reference extension/package.json as its code manifest.')
  }

  return errors
}

function readXmlTagAttributes(xml, tagName) {
  return readAllXmlTagAttributes(xml, tagName)[0] ?? null
}

function readAllXmlTagAttributes(xml, tagName) {
  const tags = new RegExp(`<${tagName}\\b([^>]*)>`, 'gi')
  return [...xml.matchAll(tags)].map((match) => {
    const attributes = {}
    for (const attribute of match[1].matchAll(/([0-9A-Za-z_.:-]+)="([^"]*)"/g)) {
      attributes[attribute[1]] = attribute[2]
    }
    return attributes
  })
}

function isSafeArchivePath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\\')) return false
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value)) return false
  return value.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..')
}

export async function inspectVsixArchive(vsixPath) {
  // Read the archive into memory rather than letting the zip reader hold a
  // descriptor for us. yauzl never waits for its descriptor to close:
  // `ZipFile.close()` only unrefs its reader, and a failed `open()` calls
  // `fs.close(fd)` without awaiting the callback. Both paths therefore settled
  // while the file was still locked. POSIX allows unlinking an open file, so it
  // surfaced only on Windows — as ENOTEMPTY raised by the *caller's* cleanup,
  // which reads like a flaky test rather than a held handle. A buffer-backed
  // reader has no descriptor to leak, on any path, including malformed
  // archives that fail before a ZipFile even exists.
  //
  // The size bound lives here, next to the read it protects, instead of relying
  // on every caller having checked first.
  const size = statSync(vsixPath).size
  if (size > MAX_VSIX_BYTES) {
    throw archiveInspectionError(
      vsixPath,
      new Error(`VSIX size must be at most ${MAX_VSIX_BYTES} bytes; received ${size}.`)
    )
  }

  let archive
  try {
    archive = await yauzl.fromBufferPromise(readFileSync(vsixPath), {
      strictFileNames: true,
      validateEntrySizes: true,
    })
  } catch (error) {
    throw archiveInspectionError(vsixPath, error)
  }

  const entries = []
  const capturedText = new Map()
  let totalUncompressedBytes = 0

  try {
    for await (const entry of archive.eachEntry()) {
      entries.push(entry.fileName)
      if (entries.length > MAX_ENTRY_COUNT) {
        throw new Error(`VSIX entry count must be at most ${MAX_ENTRY_COUNT}.`)
      }
      if (entry.fileName.endsWith('/')) {
        throw new Error(`VSIX includes directory entry ${entry.fileName}.`)
      }
      if (entry.isEncrypted()) {
        throw new Error(`VSIX includes encrypted entry ${entry.fileName}.`)
      }
      if (!entry.canDecodeFileData()) {
        throw new Error(
          `VSIX entry ${entry.fileName} uses unsupported compression method ${entry.compressionMethod}.`
        )
      }
      if (isUnixNonRegularEntry(entry)) {
        throw new Error(`VSIX includes non-regular entry ${entry.fileName}.`)
      }
      if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0) {
        throw new Error(`VSIX entry ${entry.fileName} has an invalid uncompressed size.`)
      }

      totalUncompressedBytes += entry.uncompressedSize
      if (totalUncompressedBytes > MAX_UNCOMPRESSED_VSIX_BYTES) {
        throw new Error(
          `VSIX uncompressed size must be at most ${MAX_UNCOMPRESSED_VSIX_BYTES} bytes.`
        )
      }

      const captureText = CAPTURED_TEXT_ENTRIES.has(entry.fileName)
      if (captureText && entry.uncompressedSize > MAX_METADATA_ENTRY_BYTES) {
        throw new Error(
          `VSIX metadata entry ${entry.fileName} must be at most ${MAX_METADATA_ENTRY_BYTES} bytes.`
        )
      }

      const content = await readArchiveEntry(
        archive,
        entry,
        captureText ? MAX_METADATA_ENTRY_BYTES : 0
      )
      if (captureText) capturedText.set(entry.fileName, decodeUtf8(content, entry.fileName))
    }
  } catch (error) {
    throw archiveInspectionError(vsixPath, error)
  } finally {
    // Releases the reader's buffer references. There is no descriptor behind it,
    // so nothing here is asynchronous and nothing can outlive this call.
    archive.close()
  }

  return { capturedText, entries, totalUncompressedBytes }
}

async function readArchiveEntry(archive, entry, captureLimit) {
  const stream = await archive.openReadStreamPromise(entry)
  const chunks = []
  let capturedBytes = 0
  let checksum = 0xffffffff

  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    checksum = updateCrc32(checksum, buffer)
    if (captureLimit === 0) continue
    capturedBytes += buffer.length
    if (capturedBytes > captureLimit) {
      throw new Error(`VSIX metadata entry ${entry.fileName} exceeds ${captureLimit} bytes.`)
    }
    chunks.push(buffer)
  }

  const actualChecksum = (checksum ^ 0xffffffff) >>> 0
  if (actualChecksum !== entry.crc32) {
    throw new Error(
      `VSIX entry ${entry.fileName} failed CRC-32 validation (expected ${formatCrc32(entry.crc32)}, received ${formatCrc32(actualChecksum)}).`
    )
  }

  return captureLimit === 0 ? Buffer.alloc(0) : Buffer.concat(chunks, capturedBytes)
}

function updateCrc32(checksum, content) {
  let next = checksum
  for (const byte of content) {
    next = CRC32_TABLE[(next ^ byte) & 0xff] ^ (next >>> 8)
  }
  return next >>> 0
}

function formatCrc32(checksum) {
  return `0x${checksum.toString(16).padStart(8, '0')}`
}

function decodeUtf8(content, entryName) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(content)
  } catch (error) {
    throw new Error(`VSIX metadata entry ${entryName} is not valid UTF-8.`, { cause: error })
  }
}

function isUnixNonRegularEntry(entry) {
  const madeBySystem = entry.versionMadeBy >>> 8
  if (madeBySystem !== 3) return false

  const fileType = (entry.externalFileAttributes >>> 16) & 0xf000
  return fileType !== 0 && fileType !== 0x8000
}

function archiveInspectionError(vsixPath, error) {
  const reason = error instanceof Error ? error.message : String(error)
  return new Error(`Unable to inspect VSIX ZIP ${vsixPath}: ${reason}`, { cause: error })
}

function requiredCapturedText(capturedText, entryName) {
  const content = capturedText.get(entryName)
  if (content === undefined) throw new Error(`VSIX is missing ${entryName}.`)
  return content
}

function isMainModule() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
}

if (isMainModule()) {
  try {
    const rootManifest = JSON.parse(readFileSync('package.json', 'utf8'))
    const extensionManifest = JSON.parse(readFileSync('extension/package.json', 'utf8'))
    const vsixPath = join('extension', 'dist', `reup-vscode-${extensionManifest.version}.vsix`)
    if (!existsSync(vsixPath)) throw new Error(`VSIX does not exist: ${vsixPath}`)
    const size = statSync(vsixPath).size
    if (size > MAX_VSIX_BYTES) {
      throw new Error(`VSIX size must be at most ${MAX_VSIX_BYTES} bytes; received ${size}.`)
    }

    const { capturedText, entries } = await inspectVsixArchive(vsixPath)
    const packedManifest = JSON.parse(requiredCapturedText(capturedText, 'extension/package.json'))
    const packedVsixManifest = requiredCapturedText(capturedText, 'extension.vsixmanifest')
    const expected = {
      name: extensionManifest.name,
      publisher: extensionManifest.publisher,
      version: rootManifest.version,
      vscodeEngine: extensionManifest.engines?.vscode,
    }
    const errors = [
      ...validateVsixCandidate(entries, packedManifest, expected),
      ...validateVsixManifestXml(packedVsixManifest, expected),
    ]
    if (errors.length > 0) {
      console.error(
        ['VSIX verification failed:', ...errors.map((error) => `- ${error}`)].join('\n')
      )
      process.exitCode = 1
    } else {
      console.log(`VSIX verified: ${vsixPath} (${entries.length} files, ${size} bytes)`)
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
