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
import { join, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'

const allowDirty = process.argv.includes('--allow-dirty')
const root = process.cwd()
const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
const version = manifest.version
const branch = runCapture('git', ['branch', '--show-current']).trim()
const commit = runCapture('git', ['rev-parse', 'HEAD']).trim()
const shortCommit = runCapture('git', ['rev-parse', '--short=12', 'HEAD']).trim()
const dirty = isDirty()

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

rmSync(releaseRoot, { recursive: true, force: true })
mkdirSync(artifactDir, { recursive: true })

const validationCommands = [
  ['npm', ['run', 'check:version']],
  ['npm', ['run', 'format:check']],
  ['npm', ['run', 'lint']],
  ['npm', ['run', 'build']],
  ['npm', ['test']],
  ['npm', ['run', 'build:extension']],
  ['npm', ['run', 'package:extension']],
  ['npm', ['run', 'test:extension-host']],
  ['node', ['--check', 'src/web/client.js']],
  ['npm', ['audit']],
  ['npm', ['audit', '--prefix', 'extension']],
  ['git', ['diff', '--check']],
]

for (const [command, args] of validationCommands) run(command, args)

const packedName = runCapture('npm', ['pack', '--pack-destination', artifactDir])
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .findLast((line) => line.endsWith('.tgz'))

if (!packedName) fail('npm pack did not report a .tgz artifact.')

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

const provenance = {
  schema: 'reup.local-release.v1',
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
  validationCommands: validationCommands.map(([command, args]) => [command, ...args].join(' ')),
  officialPublishSkipped: true,
}

writeFileSync(
  join(releaseRoot, 'provenance.local.json'),
  `${JSON.stringify(provenance, null, 2)}\n`
)
writeReleaseNotes(releaseRoot, provenance)
writeChecksums(releaseRoot)

console.log(`\nLocal release candidate ready: ${releaseRoot}`)
console.log('Official publish skipped. Upload/sign/notarize from CI in the next phase.')

function run(command, args, options = {}) {
  console.log(`\n> ${[command, ...args].join(' ')}`)
  const result = spawnSync(resolveCommand(command), args, {
    cwd: root,
    stdio: 'inherit',
    shell: commandNeedsShell(command),
    ...options,
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function runCapture(command, args) {
  const result = spawnSync(resolveCommand(command), args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: commandNeedsShell(command),
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

function resolveCommand(command) {
  return command
}

function commandNeedsShell(command) {
  return process.platform === 'win32' && command === 'npm'
}

function isDirty() {
  const result = spawnSync(
    resolveCommand('git'),
    ['status', '--porcelain=v1', '--untracked-files=normal'],
    {
      cwd: root,
      encoding: 'utf8',
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  )
  if (result.error) throw result.error
  if (result.status !== 0) fail('Unable to determine git working-tree state.')
  return result.stdout.trim().length > 0
}

function writeSbom(label, outputRoot, args) {
  const result = spawnSync(resolveCommand('npm'), args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: commandNeedsShell('npm'),
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    fail(`Unable to generate ${label} SBOM:\n${result.stderr.trim()}`)
  }
  writeFileSync(join(outputRoot, `sbom.${label}.cyclonedx.json`), result.stdout)
}

function writeReleaseNotes(outputRoot, data) {
  const artifacts = listFiles(join(outputRoot, 'artifacts'))
    .map((file) => `- \`${toPosix(relative(outputRoot, file))}\``)
    .join('\n')

  writeFileSync(
    join(outputRoot, 'RELEASE_NOTES.md'),
    [
      `# Reup ${data.version} Local Release Candidate`,
      '',
      'This release candidate was generated locally for validation only. It has not been published to npm, GitHub Releases, the VS Code Marketplace, or any installer channel.',
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
      '- VS Code extension build/package/smoke',
      '- Browser client syntax check',
      '- Root and extension npm audit',
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
