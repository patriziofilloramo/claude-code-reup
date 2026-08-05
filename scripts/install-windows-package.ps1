[CmdletBinding()]
param(
  [string]$InstallDir,
  [string]$Source,
  [ValidateSet('User', 'Process')]
  [string]$PathTarget = 'User'
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($InstallDir)) {
  $InstallDir = Join-Path $env:LOCALAPPDATA 'Programs\reup'
}
if ([string]::IsNullOrWhiteSpace($Source)) {
  $Source = $PSScriptRoot
}

function Get-NormalizedPathEntry {
  param([string]$Entry)

  if ([string]::IsNullOrWhiteSpace($Entry)) {
    return $null
  }

  $expanded = [Environment]::ExpandEnvironmentVariables($Entry.Trim().Trim('"'))
  try {
    $expanded = [IO.Path]::GetFullPath($expanded)
  }
  catch {
    # Keep a syntactically unusual entry intact. It is unrelated to Reup and
    # must not be discarded merely because Windows cannot canonicalize it.
  }
  return $expanded.TrimEnd([char[]]'\/').ToUpperInvariant()
}

function Get-PathWithoutEntry {
  param(
    [string]$PathValue,
    [string]$Entry
  )

  $entryKey = Get-NormalizedPathEntry $Entry
  $parts = @()
  foreach ($part in @($PathValue -split ';')) {
    if ([string]::IsNullOrWhiteSpace($part)) {
      continue
    }
    if ((Get-NormalizedPathEntry $part) -ne $entryKey) {
      $parts += $part.Trim()
    }
  }
  return @($parts)
}

function Get-TargetPathValue {
  if ($PathTarget -eq 'Process') {
    return $env:Path
  }
  return [Environment]::GetEnvironmentVariable('Path', 'User')
}

function Set-TargetPathValue {
  param([AllowEmptyString()][string]$Value)

  if ($PathTarget -eq 'Process') {
    $env:Path = $Value
    return
  }
  [Environment]::SetEnvironmentVariable('Path', $Value, 'User')
}

function Invoke-VersionCheck {
  param(
    [string]$ShellName,
    [string]$Command,
    [string[]]$Arguments,
    [string]$ExpectedVersion
  )

  $output = @(& $Command @Arguments 2>&1)
  $exitCode = $LASTEXITCODE
  $actualVersion = ($output | Out-String).Trim()
  if ($exitCode -ne 0 -or $actualVersion -ne $ExpectedVersion) {
    throw "$ShellName resolved the wrong Reup command (expected $ExpectedVersion, got '$actualVersion', exit $exitCode)."
  }
  Write-Host "Verified ${ShellName}: Reup $actualVersion"
}

function Find-GitBash {
  $candidates = @()
  $gitCommand = Get-Command git.exe -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($gitCommand -and $gitCommand.Source) {
    $gitParent = Split-Path $gitCommand.Source -Parent
    $gitRoot = Split-Path $gitParent -Parent
    $candidates += (Join-Path $gitRoot 'bin\bash.exe')
  }
  if ($env:ProgramFiles) {
    $candidates += (Join-Path $env:ProgramFiles 'Git\bin\bash.exe')
  }
  if (${env:ProgramFiles(x86)}) {
    $candidates += (Join-Path ${env:ProgramFiles(x86)} 'Git\bin\bash.exe')
  }
  if ($env:LOCALAPPDATA) {
    $candidates += (Join-Path $env:LOCALAPPDATA 'Programs\Git\bin\bash.exe')
  }

  foreach ($candidate in @($candidates | Select-Object -Unique)) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
      return $candidate
    }
  }
  return $null
}

$sourceApp = Join-Path $Source 'app'
$sourceBin = Join-Path $Source 'bin'
$sourceManifestPath = Join-Path $sourceApp 'package.json'
$sourceCmdLauncher = Join-Path $sourceBin 'reup.cmd'
$sourcePosixLauncher = Join-Path $sourceBin 'reup'
$sourcePowerShellLauncher = Join-Path $sourceBin 'reup.ps1'

if (-not (Test-Path -LiteralPath (Join-Path $sourceApp 'dist\index.js') -PathType Leaf)) {
  throw 'Run this script from the extracted Reup Windows package.'
}
if (-not (Test-Path -LiteralPath $sourceManifestPath -PathType Leaf)) {
  throw 'The package is missing app\package.json.'
}
if (-not (Test-Path -LiteralPath $sourceCmdLauncher -PathType Leaf)) {
  throw 'The package is missing bin\reup.cmd.'
}
if (-not (Test-Path -LiteralPath $sourcePosixLauncher -PathType Leaf)) {
  throw 'The package is missing the extensionless bin\reup launcher required by Git Bash.'
}
if (Test-Path -LiteralPath $sourcePowerShellLauncher) {
  throw 'The package must not ship bin\reup.ps1; it can shadow reup.cmd under PowerShell execution policy.'
}

$sourceManifest = Get-Content -LiteralPath $sourceManifestPath -Raw | ConvertFrom-Json
$expectedVersion = [string]$sourceManifest.version
if ($sourceManifest.name -ne '@patriziofilloramo/reup' -or [string]::IsNullOrWhiteSpace($expectedVersion)) {
  throw 'The packaged application manifest has an unexpected identity.'
}

$nodeVersionOutput = @(& node --version 2>&1)
$nodeExitCode = $LASTEXITCODE
$nodeVersion = ($nodeVersionOutput | Out-String).Trim()
if ($nodeExitCode -ne 0 -or $nodeVersion -notmatch '^v(?<major>\d+)\.') {
  throw "Node.js is not available on PATH (got '$nodeVersion', exit $nodeExitCode)."
}
if ([int]$Matches.major -lt 20) {
  throw "Reup requires Node.js 20 or newer; found $nodeVersion."
}
Invoke-VersionCheck 'the packaged Windows launcher' $sourceCmdLauncher @('--version') $expectedVersion

$InstallDir = [IO.Path]::GetFullPath($InstallDir)
$bin = Join-Path $InstallDir 'bin'
$binKey = Get-NormalizedPathEntry $bin
$installedApp = Join-Path $InstallDir 'app'
$installedBin = Join-Path $InstallDir 'bin'
$markerPath = Join-Path $InstallDir '.reup-portable-install.json'
$installedManifestPath = Join-Path $InstallDir 'app\package.json'
$installedCmdLauncher = Join-Path $bin 'reup.cmd'
$gitBash = Find-GitBash
$installParent = Split-Path $InstallDir -Parent
$transactionId = [Guid]::NewGuid().ToString('N')
$transactionRoot = Join-Path $installParent ".reup-install-$transactionId"
$stageRoot = Join-Path $transactionRoot 'stage'
$backupRoot = Join-Path $transactionRoot 'backup'
$stageApp = Join-Path $stageRoot 'app'
$stageBin = Join-Path $stageRoot 'bin'
$backupApp = Join-Path $backupRoot 'app'
$backupBin = Join-Path $backupRoot 'bin'
$backupMarker = Join-Path $backupRoot '.reup-portable-install.json'
$originalTargetPath = Get-TargetPathValue
$originalProcessPath = $env:Path
$nextTargetParts = @($bin) + @(Get-PathWithoutEntry $originalTargetPath $bin)
$pathUpdateAttempted = $false
$processPathChanged = $false
$hadApp = Test-Path -LiteralPath $installedApp
$hadBin = Test-Path -LiteralPath $installedBin
$hadMarker = Test-Path -LiteralPath $markerPath -PathType Leaf
$hasInnoMetadata = @(Get-ChildItem -LiteralPath $InstallDir -Filter 'unins*.exe' -File -ErrorAction SilentlyContinue).Count -gt 0
$movedOldApp = $false
$movedOldBin = $false
$movedOldMarker = $false
$placedNewApp = $false
$placedNewBin = $false
$markerWriteAttempted = $false
$cleanupTransaction = $false
$foreignCommands = @()

if ($hasInnoMetadata) {
  throw "Refusing to overlay the portable package on an Inno Setup installation at $InstallDir. Use the Inno upgrade/uninstaller, or choose a different -InstallDir."
}
if (($hadApp -or $hadBin) -and -not $hadMarker) {
  if (-not (Test-Path -LiteralPath $installedManifestPath -PathType Leaf)) {
    throw "Refusing to replace an unrecognized installation at $InstallDir."
  }
  $legacyManifest = Get-Content -LiteralPath $installedManifestPath -Raw | ConvertFrom-Json
  if ($legacyManifest.name -ne '@patriziofilloramo/reup') {
    throw "Refusing to replace an unrecognized installation at $InstallDir."
  }
}
if ($hadMarker) {
  $existingMarker = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
  if (
    $existingMarker.schemaVersion -ne 1 -or
    $existingMarker.installKind -ne 'portable-windows' -or
    $existingMarker.packageName -ne '@patriziofilloramo/reup' -or
    $existingMarker.pathTarget -ne $PathTarget
  ) {
    throw "Refusing to replace an installation with incompatible ownership metadata at $InstallDir."
  }
}

try {
  New-Item -ItemType Directory -Force -Path $stageRoot, $backupRoot | Out-Null
  Copy-Item -LiteralPath $sourceApp -Destination $stageApp -Recurse -Force
  Copy-Item -LiteralPath $sourceBin -Destination $stageBin -Recurse -Force

  $stagedCmdLauncher = Join-Path $stageBin 'reup.cmd'
  Invoke-VersionCheck 'the staged Windows launcher' $stagedCmdLauncher @('--version') $expectedVersion
  if (Test-Path -LiteralPath (Join-Path $stageBin 'reup.ps1')) {
    throw 'The staged package unexpectedly contains bin\reup.ps1.'
  }

  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  if ($hadApp) {
    Move-Item -LiteralPath $installedApp -Destination $backupApp
    $movedOldApp = $true
  }
  if ($hadBin) {
    Move-Item -LiteralPath $installedBin -Destination $backupBin
    $movedOldBin = $true
  }
  if ($hadMarker) {
    Move-Item -LiteralPath $markerPath -Destination $backupMarker
    $movedOldMarker = $true
  }

  Move-Item -LiteralPath $stageApp -Destination $installedApp
  $placedNewApp = $true
  Move-Item -LiteralPath $stageBin -Destination $installedBin
  $placedNewBin = $true

  $installedManifest = Get-Content -LiteralPath $installedManifestPath -Raw | ConvertFrom-Json
  if ($installedManifest.name -ne $sourceManifest.name -or $installedManifest.version -ne $expectedVersion) {
    throw 'The installed application manifest does not match the selected package.'
  }
  if (Test-Path -LiteralPath (Join-Path $installedBin 'reup.ps1')) {
    throw 'The upgrade retained an obsolete bin\reup.ps1 launcher.'
  }

  # The parent process cannot be changed, but using the projected PATH here
  # verifies each launcher against the user-PATH order this installer writes.
  $nextProcessParts = @($bin) + @(Get-PathWithoutEntry $env:Path $bin)
  $env:Path = $nextProcessParts -join ';'
  $processPathChanged = $true

  Invoke-VersionCheck 'the direct Windows launcher' $installedCmdLauncher @('--version') $expectedVersion
  $commandPrompt = $env:ComSpec
  if ([string]::IsNullOrWhiteSpace($commandPrompt)) {
    $commandPrompt = 'cmd.exe'
  }
  Invoke-VersionCheck 'cmd.exe' $commandPrompt @('/d', '/c', 'reup --version') $expectedVersion

  $windowsPowerShell = Join-Path $PSHOME 'powershell.exe'
  if (-not (Test-Path -LiteralPath $windowsPowerShell -PathType Leaf)) {
    $windowsPowerShell = 'powershell.exe'
  }
  Invoke-VersionCheck 'PowerShell' $windowsPowerShell @(
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Restricted',
    '-Command',
    'reup --version'
  ) $expectedVersion

  if ($gitBash) {
    Invoke-VersionCheck 'Git Bash' $gitBash @(
      '--noprofile',
      '--norc',
      '-c',
      'reup --version'
    ) $expectedVersion
  }
  else {
    Write-Host 'Git Bash not found; its launcher was installed but the shell check was skipped.'
  }

  $pathUpdateAttempted = $true
  Set-TargetPathValue ($nextTargetParts -join ';')
  $persistedTargetPath = Get-TargetPathValue
  $persistedFirstEntry = @($persistedTargetPath -split ';' | Where-Object { $_ }) | Select-Object -First 1
  if ((Get-NormalizedPathEntry $persistedFirstEntry) -ne $binKey) {
    throw "Reup was copied, but its PATH entry was not persisted: $bin"
  }

  $marker = [ordered]@{
    schemaVersion = 1
    installKind = 'portable-windows'
    packageName = [string]$sourceManifest.name
    version = $expectedVersion
    pathTarget = $PathTarget
  }
  $markerWriteAttempted = $true
  $marker | ConvertTo-Json | Set-Content -LiteralPath $markerPath -Encoding UTF8

  $foreignCommands = @(
    Get-Command reup -All -ErrorAction SilentlyContinue |
      ForEach-Object { $_.Path } |
      Where-Object {
        $_ -and (Get-NormalizedPathEntry (Split-Path $_ -Parent)) -ne $binKey
      } |
      Select-Object -Unique
  )
  $cleanupTransaction = $true
}
catch {
  $installFailure = $_
  $rollbackFailures = @()

  if ($processPathChanged) {
    $env:Path = $originalProcessPath
  }

  if ($pathUpdateAttempted) {
    try {
      Set-TargetPathValue $originalTargetPath
    }
    catch {
      $rollbackFailures += "PATH: $($_.Exception.Message)"
    }
  }

  $newPaths = @(
    [pscustomobject]@{ Placed = $placedNewApp; Path = $installedApp },
    [pscustomobject]@{ Placed = $placedNewBin; Path = $installedBin },
    [pscustomobject]@{ Placed = $markerWriteAttempted; Path = $markerPath }
  )
  foreach ($newPath in $newPaths) {
    if ($newPath.Placed -and (Test-Path -LiteralPath $newPath.Path)) {
      try {
        Remove-Item -LiteralPath $newPath.Path -Recurse -Force
      }
      catch {
        $rollbackFailures += "$($newPath.Path): $($_.Exception.Message)"
      }
    }
  }

  $oldPaths = @(
    [pscustomobject]@{ Moved = $movedOldApp; Backup = $backupApp; Destination = $installedApp },
    [pscustomobject]@{ Moved = $movedOldBin; Backup = $backupBin; Destination = $installedBin },
    [pscustomobject]@{ Moved = $movedOldMarker; Backup = $backupMarker; Destination = $markerPath }
  )
  foreach ($oldPath in $oldPaths) {
    if ($oldPath.Moved -and (Test-Path -LiteralPath $oldPath.Backup)) {
      try {
        Move-Item -LiteralPath $oldPath.Backup -Destination $oldPath.Destination
      }
      catch {
        $rollbackFailures += "$($oldPath.Destination): $($_.Exception.Message)"
      }
    }
  }

  if ($rollbackFailures.Count -gt 0) {
    throw "Installation failed: $($installFailure.Exception.Message) Rollback was incomplete; recovery files remain at $transactionRoot`: $($rollbackFailures -join '; ')"
  }
  $cleanupTransaction = $true
  throw $installFailure
}
finally {
  if ($cleanupTransaction -and (Test-Path -LiteralPath $transactionRoot)) {
    try {
      Remove-Item -LiteralPath $transactionRoot -Recurse -Force
    }
    catch {
      Write-Warning "Temporary installer files remain at $transactionRoot`: $($_.Exception.Message)"
    }
  }
}

Write-Host ''
Write-Host "Reup $expectedVersion installed and verified at $InstallDir" -ForegroundColor Green
if ($foreignCommands.Count -gt 0) {
  Write-Warning 'Other Reup launchers are also installed. Shell startup can reorder PATH, so verify the selected command after reopening your terminal:'
  foreach ($commandPath in $foreignCommands) {
    Write-Host "  $commandPath" -ForegroundColor Yellow
  }
  Write-Host 'Optional cleanup, after verifying the new install: npm uninstall --global @patriziofilloramo/reup'
  Write-Host 'The installer never removes a separately managed npm installation automatically.'
}
Write-Host ''
if ($PathTarget -eq 'User') {
  Write-Host 'PATH changes do not propagate into the VS Code process that launched this task.'
  Write-Host 'Close every VS Code window, wait for Code.exe to exit, reopen VS Code, then create a new terminal.'
}
Write-Host "Immediate check: & '$installedCmdLauncher' --version"
