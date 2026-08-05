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

import { resolveReleaseCommand } from './release-command.mjs'
import { tarExtractInvocation } from './tar-path.mjs'
import { windowsCmdLauncher, windowsPosixLauncher } from './windows-launchers.mjs'

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

const npmPackagePath = findNpmPackageArtifact()
const runtimeApp = join(workDir, 'app')
prepareRuntimeApp(runtimeApp, npmPackagePath)

buildCurrentPlatformPackage(runtimeApp)

removeTree(workDir)
writeInstallerNotes()
writeChecksums(releaseRoot)

console.log(`\nLocal installable release packages ready: ${installerDir}`)
console.log('These are unsigned RC packages. Official native installers remain a later phase.')

function buildCurrentPlatformPackage(runtimeApp) {
  if (process.platform === 'win32') {
    if (process.arch !== 'x64') {
      fail(`Windows installer packaging currently supports x64 hosts, not ${process.arch}.`)
    }
    buildWindowsPackage(runtimeApp)
    return
  }

  if (process.platform === 'linux') {
    buildUnixPackage(runtimeApp, {
      id: `linux-${process.arch}`,
      archiveName: `reup-linux-${process.arch}-v${version}.tar.gz`,
      installRootExpression: '"${XDG_DATA_HOME:-$HOME/.local/share}/reup"',
    })
    return
  }

  if (process.platform === 'darwin') {
    buildUnixPackage(runtimeApp, {
      id: `macos-${process.arch}`,
      archiveName: `reup-macos-${process.arch}-v${version}.tar.gz`,
      installRootExpression: '"$HOME/Library/Application Support/reup"',
    })
    return
  }

  fail(`Installable package generation is not supported on ${process.platform}.`)
}

function findNpmPackageArtifact() {
  const artifactDir = join(releaseRoot, 'artifacts')
  const candidates = existsSync(artifactDir)
    ? readdirSync(artifactDir).filter((file) => file.endsWith('.tgz'))
    : []
  if (candidates.length !== 1) {
    fail(`Expected one npm package tarball in ${artifactDir}; found ${candidates.length}.`)
  }
  return join(artifactDir, candidates[0])
}

function prepareRuntimeApp(target, packagePath) {
  const extractionRoot = join(workDir, '.npm-package')
  mkdirSync(extractionRoot, { recursive: true })
  // Keep both operands drive-free. GNU tar launched from Git Bash interprets
  // an absolute Windows archive path such as C:\\... as a remote host reference.
  const invocation = tarExtractInvocation(releaseRoot, packagePath, extractionRoot)
  run('tar', invocation.args, { cwd: invocation.cwd })

  const extractedPackage = join(extractionRoot, 'package')
  if (!existsSync(join(extractedPackage, 'dist', 'index.js'))) {
    fail(`Packed npm artifact is missing dist/index.js: ${packagePath}`)
  }

  cpSync(extractedPackage, target, { recursive: true })
  copyFileSync('package-lock.json', join(target, 'package-lock.json'))

  const packedManifest = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'))
  if (packedManifest.name !== manifest.name || packedManifest.version !== version) {
    fail('Packed npm artifact identity does not match package.json.')
  }

  run('npm', ['ci', '--omit=dev', '--ignore-scripts'], { cwd: target })
  removeTree(extractionRoot)
}

function buildWindowsPackage(runtimeApp) {
  const packageRoot = join(workDir, `reup-windows-x64-v${version}`)
  const appDir = join(packageRoot, 'app')
  const binDir = join(packageRoot, 'bin')
  const completionDir = join(packageRoot, 'completion')

  cpSync(runtimeApp, appDir, { recursive: true })
  mkdirSync(binDir, { recursive: true })
  mkdirSync(completionDir, { recursive: true })
  // Windows shells need two launchers. cmd.exe and PowerShell discover the
  // .cmd through PATHEXT; Git Bash searches for the exact extensionless name.
  // Deliberately do not ship bin/reup.ps1: PowerShell prefers it over .cmd and
  // can reject it under the default Restricted execution policy.
  writeFileSync(join(binDir, 'reup.cmd'), windowsCmdLauncher())
  writeExecutable(join(binDir, 'reup'), windowsPosixLauncher())
  writeFileSync(join(completionDir, 'reup.ps1'), windowsCompletionLoader())
  copyFileSync('scripts/install-windows-package.ps1', join(packageRoot, 'install.ps1'))
  copyFileSync('scripts/uninstall-windows-package.ps1', join(packageRoot, 'uninstall.ps1'))
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
    join(process.env['LOCALAPPDATA'] ?? '', 'Programs', 'Inno Setup 6', 'ISCC.exe'),
    'C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe',
    'C:\\Program Files\\Inno Setup 6\\ISCC.exe',
  ].filter(Boolean)

  for (const candidate of candidates) {
    if (candidate.includes('\\') && existsSync(candidate)) return candidate

    const result = spawnSync(candidate, ['/?'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    })
    if (!result.error && result.stdout.includes('Inno Setup')) return candidate
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
    'DisableDirPage=no',
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
    'Source: "{#PackageRoot}\\completion\\*"; DestDir: "{app}\\completion"; Flags: recursesubdirs createallsubdirs ignoreversion',
    'Source: "{#PackageRoot}\\README-INSTALL.txt"; DestDir: "{app}"; Flags: ignoreversion',
    '',
    '[InstallDelete]',
    'Type: files; Name: "{app}\\bin\\reup.ps1"',
    'Type: files; Name: "{app}\\.reup-portable-install.json"',
    '',
    '[Tasks]',
    'Name: "addtopath"; Description: "Add reup to the current user PATH"; Flags: checkedonce',
    'Name: "powershellcompletion"; Description: "Enable PowerShell tab completion for Windows PowerShell and PowerShell 7"; Flags: checkedonce',
    '',
    '[Icons]',
    'Name: "{userprograms}\\Reup\\Uninstall Reup"; Filename: "{uninstallexe}"',
    '',
    '[Run]',
    'Filename: "{cmd}"; Parameters: "/c ""{app}\\bin\\reup.cmd"" --version"; Flags: runhidden',
    '',
    '[Code]',
    "const PathSeparator = ';';",
    "const CompletionStartMarker = '# >>> reup completion >>>';",
    "const CompletionEndMarker = '# <<< reup completion <<<';",
    '',
    'function ExpandKnownPathPrefix(Value: string): string;',
    'var',
    '  UpperValue: string;',
    'begin',
    '  Result := Value;',
    '  UpperValue := Uppercase(Value);',
    "  if Pos('%LOCALAPPDATA%', UpperValue) = 1 then",
    "    Result := GetEnv('LOCALAPPDATA') + Copy(Value, Length('%LOCALAPPDATA%') + 1, Length(Value))",
    "  else if Pos('%USERPROFILE%', UpperValue) = 1 then",
    "    Result := GetEnv('USERPROFILE') + Copy(Value, Length('%USERPROFILE%') + 1, Length(Value))",
    "  else if Pos('%APPDATA%', UpperValue) = 1 then",
    "    Result := GetEnv('APPDATA') + Copy(Value, Length('%APPDATA%') + 1, Length(Value));",
    'end;',
    '',
    'function NormalizePathPart(Value: string): string;',
    'begin',
    '  Result := Trim(Value);',
    `  if (Length(Result) >= 2) and (Result[1] = '"') and (Result[Length(Result)] = '"') then`,
    '    Result := Copy(Result, 2, Length(Result) - 2);',
    '  Result := ExpandKnownPathPrefix(Result);',
    '  Result := RemoveBackslashUnlessRoot(Result);',
    'end;',
    '',
    'function PathPartMatches(Value: string; Entry: string): Boolean;',
    'begin',
    '  Result := CompareText(NormalizePathPart(Value), NormalizePathPart(Entry)) = 0;',
    'end;',
    '',
    'procedure AddToUserPath(Entry: string);',
    'var',
    '  PathValue: string;',
    '  NextValue: string;',
    '  Part: string;',
    '  Index: Integer;',
    'begin',
    "  if not RegQueryStringValue(HKEY_CURRENT_USER, 'Environment', 'Path', PathValue) then",
    "    PathValue := '';",
    '  NextValue := Entry;',
    "  while PathValue <> '' do begin",
    '    Index := Pos(PathSeparator, PathValue);',
    '    if Index > 0 then begin',
    '      Part := Copy(PathValue, 1, Index - 1);',
    '      Delete(PathValue, 1, Index);',
    '    end else begin',
    '      Part := PathValue;',
    "      PathValue := '';",
    '    end;',
    "    if (Part <> '') and not PathPartMatches(Part, Entry) then",
    '      NextValue := NextValue + PathSeparator + Part;',
    '  end;',
    "  RegWriteExpandStringValue(HKEY_CURRENT_USER, 'Environment', 'Path', NextValue);",
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
    'function CompletionBlock(): string;',
    'begin',
    `  Result := CompletionStartMarker + #13#10 + '. "' + ExpandConstant('{app}\\completion\\reup.ps1') + '"' + #13#10 + CompletionEndMarker + #13#10;`,
    'end;',
    '',
    'procedure EnsurePowerShellProfile(ProfilePath: string);',
    'var',
    '  Content: AnsiString;',
    '  ParentDir: string;',
    'begin',
    '  ParentDir := ExtractFileDir(ProfilePath);',
    '  ForceDirectories(ParentDir);',
    '  if FileExists(ProfilePath) then begin',
    '    if not LoadStringFromFile(ProfilePath, Content) then',
    "      Content := '';",
    '  end else begin',
    "    Content := '';",
    '  end;',
    '  if Pos(CompletionStartMarker, Content) > 0 then',
    '    Exit;',
    '  if FileExists(ProfilePath) then',
    "    CopyFile(ProfilePath, ProfilePath + '.reup-backup', False);",
    "  if (Content <> '') and (Copy(Content, Length(Content), 1) <> #10) then",
    '    Content := Content + #13#10;',
    '  Content := Content + CompletionBlock();',
    '  SaveStringToFile(ProfilePath, Content, False);',
    'end;',
    '',
    'procedure RemovePowerShellProfile(ProfilePath: string);',
    'var',
    '  Content: AnsiString;',
    '  StartPos: Integer;',
    '  EndPos: Integer;',
    'begin',
    '  if not FileExists(ProfilePath) then',
    '    Exit;',
    '  if not LoadStringFromFile(ProfilePath, Content) then',
    '    Exit;',
    '  StartPos := Pos(CompletionStartMarker, Content);',
    '  EndPos := Pos(CompletionEndMarker, Content);',
    '  if (StartPos = 0) or (EndPos = 0) or (EndPos < StartPos) then',
    '    Exit;',
    '  Delete(Content, StartPos, EndPos - StartPos + Length(CompletionEndMarker));',
    '  SaveStringToFile(ProfilePath, Content, False);',
    'end;',
    '',
    'procedure InstallPowerShellCompletion();',
    'begin',
    "  EnsurePowerShellProfile(ExpandConstant('{userdocs}\\WindowsPowerShell\\Microsoft.PowerShell_profile.ps1'));",
    "  EnsurePowerShellProfile(ExpandConstant('{userdocs}\\PowerShell\\Microsoft.PowerShell_profile.ps1'));",
    'end;',
    '',
    'procedure RemovePowerShellCompletion();',
    'begin',
    "  RemovePowerShellProfile(ExpandConstant('{userdocs}\\WindowsPowerShell\\Microsoft.PowerShell_profile.ps1'));",
    "  RemovePowerShellProfile(ExpandConstant('{userdocs}\\PowerShell\\Microsoft.PowerShell_profile.ps1'));",
    'end;',
    '',
    'procedure CurStepChanged(CurStep: TSetupStep);',
    'begin',
    '  if CurStep = ssPostInstall then begin',
    "    if WizardIsTaskSelected('addtopath') then",
    "      AddToUserPath(ExpandConstant('{app}\\bin'));",
    "    if WizardIsTaskSelected('powershellcompletion') then",
    '      InstallPowerShellCompletion();',
    '  end;',
    'end;',
    '',
    'procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);',
    'begin',
    '  if CurUninstallStep = usPostUninstall then begin',
    "    RemoveFromUserPath(ExpandConstant('{app}\\bin'));",
    '    RemovePowerShellCompletion();',
    '  end;',
    'end;',
    '',
  ].join('\r\n')
}

function windowsCompletionLoader() {
  return [
    '$ErrorActionPreference = "SilentlyContinue"',
    '$ReupCommand = Join-Path $PSScriptRoot "..\\bin\\reup.cmd"',
    'if (Test-Path $ReupCommand) {',
    '  & $ReupCommand completion powershell | Out-String | Invoke-Expression',
    '}',
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
    '  - Prepends one normalized Reup bin entry to the current user PATH.',
    '  - Ships reup.cmd for cmd/PowerShell and extensionless reup for Git Bash.',
    '  - Does not ship bin/reup.ps1, so PowerShell execution policy cannot shadow reup.cmd.',
    '  - install.ps1 reports other Reup launchers but never removes a separate npm-global install.',
    '  - Portable upgrades are staged with rollback; uninstall requires matching ownership metadata.',
    '  - install.ps1 refuses to overlay a directory owned by Inno Setup.',
    '  - Inno upgrades remove obsolete bin/reup.ps1 and portable ownership metadata.',
    '  - Fully quit and reopen VS Code after PATH changes; Reload Window is not sufficient.',
    '  - The .exe installer can also add PowerShell completion through managed profile blocks.',
    '  - Does not weaken execution policy permanently.',
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
    'LAUNCHER="$BIN_DIR/reup"',
    'if [ ! -f "$SOURCE_DIR/app/dist/index.js" ]; then',
    '  echo "Run this script from the extracted Reup package." >&2',
    '  exit 1',
    'fi',
    'if [ -L "$LAUNCHER" ]; then',
    '  if [ "$(readlink "$LAUNCHER")" != "$INSTALL_DIR/bin/reup" ]; then',
    '    echo "Refusing to replace a launcher not owned by this Reup install: $LAUNCHER" >&2',
    '    exit 1',
    '  fi',
    'elif [ -e "$LAUNCHER" ]; then',
    '  echo "Refusing to replace an existing file: $LAUNCHER" >&2',
    '  exit 1',
    'fi',
    'mkdir -p "$INSTALL_DIR" "$BIN_DIR"',
    'rm -rf "$INSTALL_DIR/app" "$INSTALL_DIR/bin"',
    'cp -R "$SOURCE_DIR/app" "$INSTALL_DIR/app"',
    'cp -R "$SOURCE_DIR/bin" "$INSTALL_DIR/bin"',
    'ln -sfn "$INSTALL_DIR/bin/reup" "$LAUNCHER"',
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
    'LAUNCHER="$BIN_DIR/reup"',
    'if [ -L "$LAUNCHER" ] && [ "$(readlink "$LAUNCHER")" = "$INSTALL_DIR/bin/reup" ]; then',
    '  rm -f "$LAUNCHER"',
    'elif [ -e "$LAUNCHER" ] || [ -L "$LAUNCHER" ]; then',
    '  echo "Leaving launcher not owned by this Reup install: $LAUNCHER" >&2',
    'fi',
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
  const packages = readdirSync(installerDir)
    .filter((file) => !file.endsWith('_SKIPPED.txt'))
    .sort((a, b) => a.localeCompare(b))
    .map((file) => `- \`installers/${file}\``)

  writeFileSync(
    join(releaseRoot, 'INSTALLERS.md'),
    [
      `# Reup ${version} Local Installable Packages`,
      '',
      'These packages are release-candidate installables for clean-machine testing. They are intentionally not official public release artifacts.',
      '',
      '## Packages',
      '',
      ...(packages.length > 0 ? packages : ['- No installable package was generated.']),
      '',
      '## Scope',
      '',
      '- Includes the built Reup app plus production `node_modules`.',
      '- The app files are extracted from the npm tarball in `artifacts/`; installers do not rebuild them.',
      `- Built for the current host only: \`${process.platform}-${process.arch}\`.`,
      '- Build separately on each target platform; packages are never cross-built with host-specific dependencies.',
      '- Requires Node.js 20 or newer on the target machine.',
      '- Installs per-user only.',
      '- Does not publish to npm, GitHub Releases, or the VS Code Marketplace.',
      '- Generates an unsigned Windows `.exe` when Inno Setup 6 is installed.',
      '- The Windows `.exe` asks before adding PATH and PowerShell completion.',
      '- Does not sign, notarize, generate `.deb`, or generate `.rpm` packages yet.',
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
      '- `reup --version` in cmd.exe, PowerShell, and Git Bash when available',
      '- the selected launcher belongs to this install even when an npm-global Reup also exists',
      '- `reup doctor`',
      '- `reup web` binds to localhost',
      '- PowerShell completion works after opening a new PowerShell session when selected',
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
  const invocation = resolveReleaseCommand(command, args)
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: options.cwd ?? root,
    stdio: 'inherit',
    shell: false,
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function runCapture(command, args) {
  const invocation = resolveReleaseCommand(command, args)
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
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

function isDirty() {
  const result = spawnSync('git', ['status', '--porcelain=v1', '--untracked-files=normal'], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.error) throw result.error
  if (result.status !== 0) fail('Unable to determine git working-tree state.')
  return result.stdout.trim().length > 0
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
