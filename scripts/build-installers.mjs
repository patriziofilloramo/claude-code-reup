import { createHash } from 'node:crypto'
import console from 'node:console'
import {
  chmodSync,
  copyFileSync,
  cpSync,
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
const shortCommit = runCapture('git', ['rev-parse', '--short=12', 'HEAD']).trim()
const dirty = isDirty()

if (dirty && !allowDirty) {
  fail(
    [
      'Refusing to build installable packages from a dirty working tree.',
      'Commit or stash changes first, or pass --allow-dirty for a local test run.',
    ].join('\n')
  )
}

const releaseRoot = resolve('release', `reup-v${version}-${shortCommit}${dirty ? '-dirty' : ''}`)
const installerDir = join(releaseRoot, 'installers')
const workDir = join(releaseRoot, '.installer-work')

run('npm', ['run', 'release:local', ...(dirty && allowDirty ? ['--', '--allow-dirty'] : [])])

if (!existsSync(releaseRoot)) fail(`Expected release root was not created: ${releaseRoot}`)

removeTree(installerDir)
removeTree(workDir)
mkdirSync(installerDir, { recursive: true })
mkdirSync(workDir, { recursive: true })

const runtimeApp = join(workDir, 'app')
prepareRuntimeApp(runtimeApp)

buildWindowsPackage(runtimeApp)
buildUnixPackage(runtimeApp, {
  id: 'linux-x64',
  archiveName: `reup-linux-x64-v${version}.tar.gz`,
  installRootExpression: '"${XDG_DATA_HOME:-$HOME/.local/share}/reup"',
})
buildUnixPackage(runtimeApp, {
  id: 'macos-universal',
  archiveName: `reup-macos-universal-v${version}.tar.gz`,
  installRootExpression: '"$HOME/Library/Application Support/reup"',
})

removeTree(workDir)
writeInstallerNotes()
writeChecksums(releaseRoot)

console.log(`\nLocal installable release packages ready: ${installerDir}`)
console.log('These are unsigned RC packages. Official native installers remain a later phase.')

function prepareRuntimeApp(target) {
  mkdirSync(target, { recursive: true })

  for (const file of [
    'package.json',
    'package-lock.json',
    'README.md',
    'LICENSE',
    'DISCLAIMER.md',
    'PRIVACY.md',
    'SECURITY.md',
    'SUPPORT.md',
  ]) {
    copyFileSync(file, join(target, file))
  }

  cpSync('dist', join(target, 'dist'), { recursive: true })
  run('npm', ['ci', '--omit=dev', '--ignore-scripts'], { cwd: target })
}

function buildWindowsPackage(runtimeApp) {
  const packageRoot = join(workDir, `reup-windows-x64-v${version}`)
  const appDir = join(packageRoot, 'app')
  const binDir = join(packageRoot, 'bin')

  cpSync(runtimeApp, appDir, { recursive: true })
  mkdirSync(binDir, { recursive: true })
  writeFileSync(
    join(binDir, 'reup.cmd'),
    ['@echo off', 'node "%~dp0..\\app\\dist\\index.js" %*', ''].join('\r\n')
  )
  writeFileSync(
    join(binDir, 'reup.ps1'),
    ['#!/usr/bin/env pwsh', '& node "$PSScriptRoot/../app/dist/index.js" @args', ''].join('\n')
  )
  writeFileSync(join(packageRoot, 'install.ps1'), windowsInstallScript())
  writeFileSync(join(packageRoot, 'uninstall.ps1'), windowsUninstallScript())
  writeFileSync(join(packageRoot, 'README-INSTALL.txt'), windowsReadme())

  const archive = join(installerDir, `reup-windows-x64-v${version}.zip`)
  run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `Compress-Archive -Path '${packageRoot.replaceAll("'", "''")}\\*' -DestinationPath '${archive.replaceAll("'", "''")}' -Force`,
  ])

  buildWindowsInnoInstaller(packageRoot)
}

function buildWindowsInnoInstaller(packageRoot) {
  const innoCompiler = findInnoCompiler()
  if (!innoCompiler) {
    writeFileSync(
      join(installerDir, 'WINDOWS_EXE_INSTALLER_SKIPPED.txt'),
      [
        'Windows .exe installer was not generated because Inno Setup Compiler (ISCC.exe) was not found.',
        '',
        'Install Inno Setup 6, then rerun:',
        '  winget install --id JRSoftware.InnoSetup -e',
        '  npm run release:installers',
        '',
        'The portable Windows zip was still generated.',
        '',
      ].join('\n')
    )
    return
  }

  const scriptPath = join(workDir, `reup-windows-x64-v${version}.iss`)
  writeFileSync(scriptPath, windowsInnoScript(packageRoot))
  run(innoCompiler, [scriptPath])
}

function findInnoCompiler() {
  const candidates = [
    process.env['INNO_SETUP_COMPILER'],
    'ISCC.exe',
    'iscc',
    'C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe',
    'C:\\Program Files\\Inno Setup 6\\ISCC.exe',
  ].filter(Boolean)

  for (const candidate of candidates) {
    const result = spawnSync(candidate, ['/?'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    })
    if (!result.error && result.status === 0) return candidate
  }
  return undefined
}

function windowsInnoScript(packageRoot) {
  const outputBaseName = `reup-setup-windows-x64-v${version}`
  return [
    '#define AppName "Reup"',
    `#define AppVersion "${version}"`,
    `#define PackageRoot "${escapeInnoPath(packageRoot)}"`,
    '',
    '[Setup]',
    'AppId={{9C9E6C41-FA29-4D3D-B60D-4D6F1F9883A7}',
    'AppName={#AppName}',
    'AppVersion={#AppVersion}',
    'AppPublisher=Reup',
    'AppPublisherURL=https://github.com/patriziofilloramo/claude-code-reup',
    'AppSupportURL=https://github.com/patriziofilloramo/claude-code-reup/issues',
    'DefaultDirName={localappdata}\\Programs\\reup',
    'DisableProgramGroupPage=yes',
    'OutputDir=' + escapeInnoPath(installerDir),
    `OutputBaseFilename=${outputBaseName}`,
    'Compression=lzma2',
    'SolidCompression=yes',
    'PrivilegesRequired=lowest',
    'ArchitecturesAllowed=x64compatible',
    'ArchitecturesInstallIn64BitMode=x64compatible',
    'UninstallDisplayName=Reup',
    'ChangesEnvironment=yes',
    'WizardStyle=modern',
    '',
    '[Files]',
    'Source: "{#PackageRoot}\\app\\*"; DestDir: "{app}\\app"; Flags: recursesubdirs createallsubdirs ignoreversion',
    'Source: "{#PackageRoot}\\bin\\*"; DestDir: "{app}\\bin"; Flags: recursesubdirs createallsubdirs ignoreversion',
    'Source: "{#PackageRoot}\\README-INSTALL.txt"; DestDir: "{app}"; Flags: ignoreversion',
    '',
    '[Icons]',
    'Name: "{userprograms}\\Reup\\Uninstall Reup"; Filename: "{uninstallexe}"',
    '',
    '[Run]',
    'Filename: "{cmd}"; Parameters: "/c ""{app}\\bin\\reup.cmd"" --version"; Flags: runhidden',
    '',
    '[Code]',
    "const PathSeparator = ';';",
    '',
    'function PathPartMatches(Value: string; Entry: string): Boolean;',
    'begin',
    '  Result := CompareText(RemoveBackslashUnlessRoot(Value), RemoveBackslashUnlessRoot(Entry)) = 0;',
    'end;',
    '',
    'function PathContains(Entry: string): Boolean;',
    'var',
    '  PathValue: string;',
    '  Part: string;',
    '  Index: Integer;',
    'begin',
    '  Result := False;',
    "  if not RegQueryStringValue(HKEY_CURRENT_USER, 'Environment', 'Path', PathValue) then",
    "    PathValue := '';",
    "  while PathValue <> '' do begin",
    '    Index := Pos(PathSeparator, PathValue);',
    '    if Index > 0 then begin',
    '      Part := Copy(PathValue, 1, Index - 1);',
    '      Delete(PathValue, 1, Index);',
    '    end else begin',
    '      Part := PathValue;',
    "      PathValue := '';",
    '    end;',
    '    if PathPartMatches(Part, Entry) then begin',
    '      Result := True;',
    '      Exit;',
    '    end;',
    '  end;',
    'end;',
    '',
    'procedure AddToUserPath(Entry: string);',
    'var',
    '  PathValue: string;',
    'begin',
    '  if PathContains(Entry) then',
    '    Exit;',
    "  if not RegQueryStringValue(HKEY_CURRENT_USER, 'Environment', 'Path', PathValue) then",
    "    PathValue := '';",
    "  if (PathValue <> '') and (Copy(PathValue, Length(PathValue), 1) <> PathSeparator) then",
    '    PathValue := PathValue + PathSeparator;',
    "  RegWriteExpandStringValue(HKEY_CURRENT_USER, 'Environment', 'Path', PathValue + Entry);",
    'end;',
    '',
    'procedure RemoveFromUserPath(Entry: string);',
    'var',
    '  PathValue: string;',
    '  NextValue: string;',
    '  Part: string;',
    '  Index: Integer;',
    'begin',
    "  if not RegQueryStringValue(HKEY_CURRENT_USER, 'Environment', 'Path', PathValue) then",
    '    Exit;',
    "  NextValue := '';",
    "  while PathValue <> '' do begin",
    '    Index := Pos(PathSeparator, PathValue);',
    '    if Index > 0 then begin',
    '      Part := Copy(PathValue, 1, Index - 1);',
    '      Delete(PathValue, 1, Index);',
    '    end else begin',
    '      Part := PathValue;',
    "      PathValue := '';",
    '    end;',
    "    if (Part <> '') and not PathPartMatches(Part, Entry) then begin",
    "      if NextValue <> '' then",
    '        NextValue := NextValue + PathSeparator;',
    '      NextValue := NextValue + Part;',
    '    end;',
    '  end;',
    "  RegWriteExpandStringValue(HKEY_CURRENT_USER, 'Environment', 'Path', NextValue);",
    'end;',
    '',
    'procedure CurStepChanged(CurStep: TSetupStep);',
    'begin',
    '  if CurStep = ssPostInstall then',
    "    AddToUserPath(ExpandConstant('{app}\\bin'));",
    'end;',
    '',
    'procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);',
    'begin',
    '  if CurUninstallStep = usPostUninstall then',
    "    RemoveFromUserPath(ExpandConstant('{app}\\bin'));",
    'end;',
    '',
  ].join('\r\n')
}

function escapeInnoPath(path) {
  return path.replaceAll('"', '""')
}

function buildUnixPackage(runtimeApp, platform) {
  const packageRoot = join(workDir, `reup-${platform.id}-v${version}`)
  const appDir = join(packageRoot, 'app')
  const binDir = join(packageRoot, 'bin')

  cpSync(runtimeApp, appDir, { recursive: true })
  mkdirSync(binDir, { recursive: true })
  writeExecutable(
    join(binDir, 'reup'),
    [
      '#!/usr/bin/env sh',
      'DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)',
      'exec node "$DIR/../app/dist/index.js" "$@"',
      '',
    ].join('\n')
  )
  writeExecutable(
    join(packageRoot, 'install.sh'),
    unixInstallScript(platform.installRootExpression)
  )
  writeExecutable(
    join(packageRoot, 'uninstall.sh'),
    unixUninstallScript(platform.installRootExpression)
  )
  writeFileSync(join(packageRoot, 'README-INSTALL.txt'), unixReadme(platform.id))

  // GNU tar on Windows treats a drive-colon path such as P:\... as remote.
  // Write the archive by relative name from inside installerDir instead.
  run('tar', ['-czf', platform.archiveName, '-C', workDir, `${basename(packageRoot)}`], {
    cwd: installerDir,
  })
}

function windowsInstallScript() {
  return [
    '$ErrorActionPreference = "Stop"',
    '$InstallDir = Join-Path $env:LOCALAPPDATA "Programs\\reup"',
    '$Source = $PSScriptRoot',
    'if (-not (Test-Path (Join-Path $Source "app\\dist\\index.js"))) { throw "Run this script from the extracted Reup package." }',
    'New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null',
    'Copy-Item -Path (Join-Path $Source "app"), (Join-Path $Source "bin") -Destination $InstallDir -Recurse -Force',
    '$Bin = Join-Path $InstallDir "bin"',
    '$CurrentPath = [Environment]::GetEnvironmentVariable("Path", "User")',
    '$Parts = @($CurrentPath -split ";" | Where-Object { $_ })',
    'if ($Parts -notcontains $Bin) {',
    '  $NextPath = (@($Parts + $Bin) -join ";")',
    '  [Environment]::SetEnvironmentVariable("Path", $NextPath, "User")',
    '}',
    'Write-Host "Reup installed to $InstallDir"',
    'Write-Host "Open a new terminal and run: reup --version"',
    '',
  ].join('\r\n')
}

function windowsUninstallScript() {
  return [
    '$ErrorActionPreference = "Stop"',
    '$InstallDir = Join-Path $env:LOCALAPPDATA "Programs\\reup"',
    '$Bin = Join-Path $InstallDir "bin"',
    '$CurrentPath = [Environment]::GetEnvironmentVariable("Path", "User")',
    '$Parts = @($CurrentPath -split ";" | Where-Object { $_ -and $_ -ne $Bin })',
    '[Environment]::SetEnvironmentVariable("Path", (@($Parts) -join ";"), "User")',
    'Remove-Item -LiteralPath $InstallDir -Recurse -Force -ErrorAction SilentlyContinue',
    'Write-Host "Reup removed from $InstallDir"',
    '',
  ].join('\r\n')
}

function windowsReadme() {
  return [
    `Reup ${version} Windows x64 RC package`,
    '',
    'Install:',
    '  powershell -ExecutionPolicy Bypass -File .\\install.ps1',
    '',
    'Uninstall:',
    '  powershell -ExecutionPolicy Bypass -File .\\uninstall.ps1',
    '',
    'Notes:',
    '  - Requires Node.js 20 or newer on PATH.',
    '  - Installs per-user to %LOCALAPPDATA%\\Programs\\reup.',
    '  - Adds only the Reup bin directory to the current user PATH.',
    '  - Does not install shell completion or weaken execution policy permanently.',
    '  - Unsigned RC package; not an official public installer.',
    '',
  ].join('\r\n')
}

function unixInstallScript(installRootExpression) {
  return [
    '#!/usr/bin/env sh',
    'set -eu',
    `INSTALL_DIR=${installRootExpression}`,
    'SOURCE_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)',
    'BIN_DIR="${HOME}/.local/bin"',
    'if [ ! -f "$SOURCE_DIR/app/dist/index.js" ]; then',
    '  echo "Run this script from the extracted Reup package." >&2',
    '  exit 1',
    'fi',
    'mkdir -p "$INSTALL_DIR" "$BIN_DIR"',
    'rm -rf "$INSTALL_DIR/app" "$INSTALL_DIR/bin"',
    'cp -R "$SOURCE_DIR/app" "$INSTALL_DIR/app"',
    'cp -R "$SOURCE_DIR/bin" "$INSTALL_DIR/bin"',
    'ln -sfn "$INSTALL_DIR/bin/reup" "$BIN_DIR/reup"',
    'echo "Reup installed to $INSTALL_DIR"',
    'echo "Ensure $BIN_DIR is on PATH, then run: reup --version"',
    '',
  ].join('\n')
}

function unixUninstallScript(installRootExpression) {
  return [
    '#!/usr/bin/env sh',
    'set -eu',
    `INSTALL_DIR=${installRootExpression}`,
    'BIN_DIR="${HOME}/.local/bin"',
    'rm -f "$BIN_DIR/reup"',
    'rm -rf "$INSTALL_DIR"',
    'echo "Reup removed from $INSTALL_DIR"',
    '',
  ].join('\n')
}

function unixReadme(platformId) {
  return [
    `Reup ${version} ${platformId} RC package`,
    '',
    'Install:',
    '  ./install.sh',
    '',
    'Uninstall:',
    '  ./uninstall.sh',
    '',
    'Notes:',
    '  - Requires Node.js 20 or newer on PATH.',
    '  - Installs per-user only.',
    '  - Links reup into ~/.local/bin.',
    '  - Does not install shell completion.',
    '  - Unsigned/not notarized RC package; not an official public installer.',
    '',
  ].join('\n')
}

function writeInstallerNotes() {
  writeFileSync(
    join(releaseRoot, 'INSTALLERS.md'),
    [
      `# Reup ${version} Local Installable Packages`,
      '',
      'These packages are release-candidate installables for clean-machine testing. They are intentionally not official public release artifacts.',
      '',
      '## Packages',
      '',
      `- \`installers/reup-setup-windows-x64-v${version}.exe\` when Inno Setup is available`,
      `- \`installers/reup-windows-x64-v${version}.zip\``,
      `- \`installers/reup-macos-universal-v${version}.tar.gz\``,
      `- \`installers/reup-linux-x64-v${version}.tar.gz\``,
      '',
      '## Scope',
      '',
      '- Includes the built Reup app plus production `node_modules`.',
      '- Requires Node.js 20 or newer on the target machine.',
      '- Installs per-user only.',
      '- Does not publish to npm, GitHub Releases, or the VS Code Marketplace.',
      '- Generates an unsigned Windows `.exe` when Inno Setup 6 is installed.',
      '- Does not sign, notarize, generate `.deb`, or generate `.rpm` packages yet.',
      '- Does not install shell completion yet.',
      '',
      '## Windows `.exe` Builder',
      '',
      'Install Inno Setup 6 before running `npm run release:installers`:',
      '',
      '```powershell',
      'winget install --id JRSoftware.InnoSetup -e',
      '```',
      '',
      'If Inno Setup is missing, the portable Windows zip is still generated and',
      '`installers/WINDOWS_EXE_INSTALLER_SKIPPED.txt` explains how to enable the `.exe` build.',
      '',
      '## Clean-Machine Smoke',
      '',
      'For each platform, install the package and verify:',
      '',
      '- `reup --version`',
      '- `reup doctor`',
      '- `reup web` binds to localhost',
      '- uninstall removes the launcher from PATH/symlink location',
      '',
    ].join('\n')
  )
}

function writeExecutable(path, content) {
  writeFileSync(path, content)
  chmodSync(path, 0o755)
}

function removeTree(path) {
  rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 })
}

function run(command, args, options = {}) {
  console.log(`\n> ${[command, ...args].join(' ')}`)
  const result = spawnSync(resolveCommand(command), args, {
    cwd: options.cwd ?? root,
    stdio: 'inherit',
    shell: commandNeedsShell(command),
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
  const result = spawnSync(resolveCommand('git'), ['diff', '--quiet'], { cwd: root, shell: false })
  if (result.error) throw result.error
  if (result.status === 0) return false
  if (result.status === 1) return true
  fail('Unable to determine git working-tree state.')
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

function basename(path) {
  return path.split(/[\\/]/).at(-1)
}

function fail(message) {
  console.error(message)
  process.exit(1)
}
