import console from 'node:console'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import process from 'node:process'

const MAX_VSIX_BYTES = 5 * 1024 * 1024
const MAX_ENTRY_COUNT = 500

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

function tarCapture(args) {
  const result = spawnSync('tar', args, {
    encoding: 'utf8',
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      [`Unable to inspect VSIX with tar ${args.join(' ')}.`, result.stderr.trim()]
        .filter(Boolean)
        .join('\n')
    )
  }
  return result.stdout
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

    const entries = tarCapture(['-tf', vsixPath])
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter(Boolean)
    const packedManifest = JSON.parse(tarCapture(['-xOf', vsixPath, 'extension/package.json']))
    const packedVsixManifest = tarCapture(['-xOf', vsixPath, 'extension.vsixmanifest'])
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
