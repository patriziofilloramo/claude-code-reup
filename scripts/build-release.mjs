import { createHash } from 'node:crypto'
import console from 'node:console'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'

import { resolveReleaseCommand } from './release-command.mjs'
import { parsePackReport, validatePackageCandidate } from './check-package.mjs'
import { releaseValidationCommands, runReleaseValidationCommands } from './release-gate.mjs'
import { releaseTreeMutationError } from './release-tree-state.mjs'

const allowDirty = process.argv.includes('--allow-dirty')
const root = process.cwd()
const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
const version = manifest.version
const branch = runCapture('git', ['branch', '--show-current']).trim()
const commit = runCapture('git', ['rev-parse', 'HEAD']).trim()
const shortCommit = runCapture('git', ['rev-parse', '--short=12', 'HEAD']).trim()
const initialPorcelain = readGitPorcelain()
const dirty = initialPorcelain.trim().length > 0

if (dirty && !allowDirty) {
  fail(
    [
      'Refusing to build release artifacts from a dirty working tree.',
      'Commit or stash changes first, or pass --allow-dirty for a local test run.',
    ].join('\n')
  )
}

const releaseRoot = resolve('release', `reup-v${version}-${shortCommit}${dirty ? '-dirty' : ''}`)
const artifactDir = join(releaseRoot, 'artifacts')

runReleaseValidationCommands(root)
assertReleaseTreeStable('the release gate')

rmSync(releaseRoot, { recursive: true, force: true })
mkdirSync(artifactDir, { recursive: true })

const packReport = parsePackReport(
  runCapture('npm', ['pack', '--json', '--pack-destination', artifactDir])
)
const packedName = packReport.filename
if (typeof packedName !== 'string') fail('npm pack did not report a .tgz filename.')
const packagePath = resolve(artifactDir, packedName)
if (dirname(packagePath) !== resolve(artifactDir) || !existsSync(packagePath)) {
  fail('npm pack did not create the reported .tgz artifact inside the artifact directory.')
}

const packedManifest = readPackedJson(packagePath, 'package/package.json')
const packedReadme = readPackedText(packagePath, 'package/README.md')
const packageErrors = validatePackageCandidate(packedManifest, packReport, packedReadme)
if (packedManifest.name !== manifest.name || packedManifest.version !== version) {
  packageErrors.push('Packed npm manifest identity does not match the release source manifest.')
}
if (packageErrors.length > 0) {
  fail(
    [
      'Packed npm artifact failed verification:',
      ...packageErrors.map((error) => `- ${error}`),
    ].join('\n')
  )
}
assertReleaseTreeStable('the final npm pack')
smokeNpmPackage(packagePath)

const vsixName = `reup-vscode-${version}.vsix`
const vsixPath = join('extension', 'dist', vsixName)
if (!existsSync(vsixPath)) fail(`Missing packaged VSIX: ${vsixPath}`)
copyFileSync(vsixPath, join(artifactDir, vsixName))

if (dirty) {
  writeFileSync(
    join(artifactDir, 'SOURCE_ARCHIVE_SKIPPED.txt'),
    [
      'Source archive skipped because this release candidate was built from a dirty working tree.',
      'Run npm run release:local from a clean commit to include a source archive.',
      '',
    ].join('\n')
  )
} else {
  const sourceArchive = join(artifactDir, `reup-source-v${version}-${shortCommit}.zip`)
  run('git', ['archive', '--format=zip', `--output=${sourceArchive}`, 'HEAD'])
}

writeSbom('root', releaseRoot, ['sbom', '--sbom-format', 'cyclonedx', '--json'])
writeSbom('extension', releaseRoot, [
  'sbom',
  '--prefix',
  'extension',
  '--sbom-format',
  'cyclonedx',
  '--json',
])

const buildMetadata = {
  schema: 'reup.release-candidate.v1',
  packageName: manifest.name,
  version,
  branch,
  commit,
  dirty,
  dirtyAllowed: allowDirty,
  generatedAt: new Date().toISOString(),
  node: process.version,
  npm: runCapture('npm', ['--version']).trim(),
  platform: {
    os: process.platform,
    arch: process.arch,
  },
  environment: process.env.GITHUB_ACTIONS === 'true' ? 'github-actions' : 'local',
  validationCommands: releaseValidationCommands.map(([command, args]) =>
    [command, ...args].join(' ')
  ),
  artifactChecks: [
    'npm package policy on the exact packed tarball',
    'npm install from packed tarball',
    'installed reup shim --version',
    'VSIX content and manifest policy',
  ],
  dependencyResolution:
    'The tarball contains Reup code; npm resolves range-compatible runtime dependencies at install time.',
  publication: {
    npm: false,
    githubRelease: false,
    vscodeMarketplace: false,
  },
  attestation: false,
}

writeFileSync(
  join(releaseRoot, 'build-metadata.json'),
  `${JSON.stringify(buildMetadata, null, 2)}\n`
)
writeReleaseNotes(releaseRoot, buildMetadata)
writeChecksums(releaseRoot)

console.log(`\nLocal release candidate ready: ${releaseRoot}`)
console.log('Nothing was published. Use the Beta Candidate workflow for a CI-built copy.')

function run(command, args, options = {}) {
  console.log(`\n> ${[command, ...args].join(' ')}`)
  const invocation = resolveReleaseCommand(command, args)
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: root,
    stdio: 'inherit',
    ...options,
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function runCapture(command, args, options = {}) {
  const invocation = resolveReleaseCommand(command, args)
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: options.cwd ?? root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    fail(
      [
        `Command failed: ${[command, ...args].join(' ')}`,
        result.stdout.trim(),
        result.stderr.trim(),
      ]
        .filter(Boolean)
        .join('\n')
    )
  }
  return result.stdout
}

function readGitPorcelain() {
  const result = spawnSync('git', ['status', '--porcelain=v1', '--untracked-files=normal'], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.error) throw result.error
  if (result.status !== 0) fail('Unable to determine git working-tree state.')
  return result.stdout
}

function assertReleaseTreeStable(stage) {
  const error = releaseTreeMutationError(dirty, readGitPorcelain(), stage)
  if (error) fail(error)
}

function readPackedText(packagePath, entryPath) {
  return runCapture('tar', ['-xOf', packagePath, entryPath])
}

function readPackedJson(packagePath, entryPath) {
  try {
    return JSON.parse(readPackedText(packagePath, entryPath))
  } catch (error) {
    fail(
      `Packed npm artifact contains invalid JSON at ${entryPath}: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

function writeSbom(label, outputRoot, args) {
  const invocation = resolveReleaseCommand('npm', args)
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    fail(`Unable to generate ${label} SBOM:\n${result.stderr.trim()}`)
  }
  writeFileSync(join(outputRoot, `sbom.${label}.cyclonedx.json`), result.stdout)
}

function smokeNpmPackage(packagePath) {
  const smokeRoot = join(releaseRoot, '.npm-package-smoke')
  rmSync(smokeRoot, { recursive: true, force: true })
  mkdirSync(smokeRoot, { recursive: true })

  try {
    run('npm', [
      'install',
      '--prefix',
      smokeRoot,
      '--omit=dev',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      packagePath,
    ])

    const installedPackageRoot = join(smokeRoot, 'node_modules', ...manifest.name.split('/'))
    const installedManifestPath = join(installedPackageRoot, 'package.json')
    if (!existsSync(installedManifestPath)) {
      fail(`npm did not install the packed package at ${installedPackageRoot}`)
    }

    const installedManifest = JSON.parse(readFileSync(installedManifestPath, 'utf8'))
    if (installedManifest.name !== manifest.name || installedManifest.version !== version) {
      fail('Installed npm package identity does not match the release manifest.')
    }

    const shimPath = join(
      smokeRoot,
      'node_modules',
      '.bin',
      process.platform === 'win32' ? 'reup.cmd' : 'reup'
    )
    if (!existsSync(shimPath)) fail(`npm did not create the installed Reup shim at ${shimPath}`)

    const installedVersion = runCapture(
      'npm',
      ['exec', '--prefix', smokeRoot, '--offline', '--', 'reup', '--version'],
      { cwd: smokeRoot }
    ).trim()
    if (installedVersion !== version) {
      fail(
        `Installed npm package reported version ${installedVersion || '<empty>'}; expected ${version}.`
      )
    }
  } finally {
    rmSync(smokeRoot, { recursive: true, force: true })
  }
}

function writeReleaseNotes(outputRoot, data) {
  const artifacts = listFiles(join(outputRoot, 'artifacts'))
    .map((file) => `- \`${toPosix(relative(outputRoot, file))}\``)
    .join('\n')

  writeFileSync(
    join(outputRoot, 'RELEASE_NOTES.md'),
    [
      `# Reup ${data.version} Release Candidate`,
      '',
      'This release candidate was generated for validation only. It has not been published to npm, GitHub Releases, the VS Code Marketplace, or any installer channel.',
      '',
      `Commit: \`${data.commit}\``,
      `Branch: \`${data.branch}\``,
      `Generated: \`${data.generatedAt}\``,
      '',
      data.dirty
        ? '**Warning:** built with `--allow-dirty`; use only for local validation, not public distribution.'
        : 'Built from a clean working tree.',
      '',
      '## Artifacts',
      '',
      artifacts || '- No artifacts generated.',
      '',
      '## Included Checks',
      '',
      '- Version sync',
      '- Formatting',
      '- Lint',
      '- TypeScript build',
      '- Full Vitest suite',
      '- VS Code development-host smoke test',
      '- Exact VSIX content and manifest verification',
      '- Browser client syntax check',
      '- Root and extension npm audit',
      '- npm package content and metadata dry-run',
      '- Exact packed npm artifact policy check',
      '- Install and version smoke test from the packed npm tarball',
      '- Git diff whitespace check',
      '',
      '## Not Included In This Phase',
      '',
      '- Official publish',
      '- Signed Windows installer',
      '- Signed/notarized macOS artifact',
      '- Linux `.deb`/`.rpm` packages',
      '- Detached signatures',
      '- CI-backed provenance attestations',
      '- A dependency-closure guarantee: npm resolves allowed runtime dependency ranges at install time',
      '',
    ].join('\n')
  )
}

function writeChecksums(outputRoot) {
  const checksumPath = join(outputRoot, 'SHA256SUMS.txt')
  const files = listFiles(outputRoot)
    .filter((file) => file !== checksumPath)
    .sort((a, b) =>
      toPosix(relative(outputRoot, a)).localeCompare(toPosix(relative(outputRoot, b)))
    )

  const lines = files.map((file) => {
    const hash = createHash('sha256').update(readFileSync(file)).digest('hex')
    return `${hash}  ${toPosix(relative(outputRoot, file))}`
  })

  writeFileSync(checksumPath, `${lines.join('\n')}\n`)
}

function listFiles(directory) {
  const files = []
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    const stats = statSync(path)
    if (stats.isDirectory()) files.push(...listFiles(path))
    else if (stats.isFile()) files.push(path)
  }
  return files
}

function toPosix(path) {
  return path.split(sep).join('/')
}

function fail(message) {
  console.error(message)
  process.exit(1)
}
