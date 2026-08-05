# Finds the Windows RC package built from the current clean commit, verifies
# its identity and checksum, extracts it to a stable local staging folder,
# and runs its install.ps1.
#
# Prerequisite: npm run release:installers (produces release/reup-v<version>-<hash>/).
# This script does not build anything itself - a full build runs the whole
# validation chain (tests, extension host smoke test, npm audit) and can take
# several minutes, so it stays an explicit, separate step.

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$releaseRoot = Join-Path $repoRoot 'release'
$stagingDir = Join-Path $repoRoot '.install-staging\windows'
$stagingParent = Split-Path $stagingDir -Parent
$stagingTransactionId = [Guid]::NewGuid().ToString('N')
$candidateStagingDir = Join-Path $stagingParent "windows-candidate-$stagingTransactionId"
$stagingBackupDir = Join-Path $stagingParent "windows-backup-$stagingTransactionId"
$localInstallDir = Join-Path $env:LOCALAPPDATA 'Programs\reup-dev'
$repoManifestPath = Join-Path $repoRoot 'package.json'
$repoManifest = Get-Content -LiteralPath $repoManifestPath -Raw | ConvertFrom-Json
$expectedName = '@patriziofilloramo/reup'
$expectedVersion = [string]$repoManifest.version

if ($repoManifest.name -ne $expectedName -or [string]::IsNullOrWhiteSpace($expectedVersion)) {
  Write-Error "Unexpected repository package identity in $repoManifestPath."
  exit 1
}

$commit = (& git -C $repoRoot rev-parse --short=12 HEAD 2>$null | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $commit -notmatch '^[0-9a-f]{12}$') {
  Write-Error 'Unable to resolve the current Git commit.'
  exit 1
}

$dirtyEntries = @(& git -C $repoRoot status --porcelain=v1 --untracked-files=all)
if ($LASTEXITCODE -ne 0) {
  Write-Error 'Unable to inspect the Git working tree.'
  exit 1
}
if ($dirtyEntries.Count -gt 0) {
  Write-Error "The working tree has uncommitted changes. Commit them, then run 'npm run release:installers' before installing."
  exit 1
}

if (-not (Test-Path $releaseRoot)) {
  Write-Error "No release/ directory found. Run 'npm run release:installers' first."
  exit 1
}

$releaseName = "reup-v$expectedVersion-$commit"
$selectedRelease = Get-Item -LiteralPath (Join-Path $releaseRoot $releaseName) -ErrorAction SilentlyContinue

if (-not $selectedRelease -or -not $selectedRelease.PSIsContainer) {
  Write-Error "No release package for the current commit ($releaseName). Run 'npm run release:installers' first."
  exit 1
}

$zipName = "reup-windows-x64-v$expectedVersion.zip"
$zipPath = Get-Item -LiteralPath (Join-Path $selectedRelease.FullName "installers\$zipName") -ErrorAction SilentlyContinue

if (-not $zipPath -or $zipPath.PSIsContainer) {
  Write-Error "No $zipName found in $releaseName\installers. Run 'npm run release:installers' first."
  exit 1
}

$checksumPath = Join-Path $selectedRelease.FullName 'SHA256SUMS.txt'
$checksumPattern = '^([0-9a-f]{64})  installers/' + [regex]::Escape($zipName) + '$'
$checksumMatch = Select-String -LiteralPath $checksumPath -Pattern $checksumPattern -ErrorAction SilentlyContinue |
  Select-Object -First 1
if (-not $checksumMatch) {
  Write-Error "No checksum entry for installers/$zipName in $checksumPath."
  exit 1
}
$expectedHash = $checksumMatch.Matches[0].Groups[1].Value
$actualHash = (Get-FileHash -LiteralPath $zipPath.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualHash -ne $expectedHash) {
  Write-Error "Checksum mismatch for $zipName (expected $expectedHash, got $actualHash)."
  exit 1
}

Write-Host "Using verified package: $zipName (from $releaseName)"

$stagingBackedUp = $false
$stagingActivated = $false
$installationCompleted = $false
try {
  New-Item -ItemType Directory -Force -Path $candidateStagingDir | Out-Null
  Expand-Archive -Path $zipPath.FullName -DestinationPath $candidateStagingDir -Force

  $requiredPackageFiles = @(
    (Join-Path $candidateStagingDir 'app\package.json'),
    (Join-Path $candidateStagingDir 'app\dist\index.js'),
    (Join-Path $candidateStagingDir 'bin\reup.cmd'),
    (Join-Path $candidateStagingDir 'bin\reup'),
    (Join-Path $candidateStagingDir 'install.ps1'),
    (Join-Path $candidateStagingDir 'uninstall.ps1')
  )
  foreach ($requiredFile in $requiredPackageFiles) {
    if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
      throw "The extracted package is missing $requiredFile."
    }
  }
  if (Test-Path -LiteralPath (Join-Path $candidateStagingDir 'bin\reup.ps1')) {
    throw 'The extracted package unexpectedly contains bin\reup.ps1.'
  }

  $candidateManifestPath = Join-Path $candidateStagingDir 'app\package.json'
  $candidateManifest = Get-Content -LiteralPath $candidateManifestPath -Raw | ConvertFrom-Json
  if ($candidateManifest.name -ne $expectedName -or $candidateManifest.version -ne $expectedVersion) {
    throw 'The extracted package manifest does not match the repository version.'
  }

  if (Test-Path -LiteralPath $stagingDir) {
    Move-Item -LiteralPath $stagingDir -Destination $stagingBackupDir
    $stagingBackedUp = $true
  }
  Move-Item -LiteralPath $candidateStagingDir -Destination $stagingDir
  $stagingActivated = $true

  Write-Host "Extracted to: $stagingDir"
  Write-Host ''

  & (Join-Path $stagingDir 'install.ps1') -InstallDir $localInstallDir
  $installationCompleted = $true

  $installedManifest = Get-Content -LiteralPath (Join-Path $localInstallDir 'app\package.json') -Raw | ConvertFrom-Json
  $installedVersion = (& (Join-Path $localInstallDir 'bin\reup.cmd') --version 2>&1 | Out-String).Trim()
  $installedExitCode = $LASTEXITCODE
  if (
    $installedManifest.name -ne $expectedName -or
    $installedManifest.version -ne $expectedVersion -or
    $installedVersion -ne $expectedVersion -or
    $installedExitCode -ne 0
  ) {
    throw "Post-install verification failed (expected Reup $expectedVersion, got '$installedVersion', exit $installedExitCode)."
  }
}
catch {
  $installFailure = $_
  $stagingRollbackFailures = @()

  # If the package installer itself failed, it restored the previous runtime;
  # pair it with the previous uninstaller. If it completed, keep the new
  # staging even when this wrapper's redundant final assertion failed.
  if (-not $installationCompleted) {
    if ($stagingActivated -and (Test-Path -LiteralPath $stagingDir)) {
      try {
        Remove-Item -LiteralPath $stagingDir -Recurse -Force
      }
      catch {
        $stagingRollbackFailures += "$stagingDir`: $($_.Exception.Message)"
      }
    }
    if ($stagingBackedUp -and (Test-Path -LiteralPath $stagingBackupDir)) {
      try {
        Move-Item -LiteralPath $stagingBackupDir -Destination $stagingDir
      }
      catch {
        $stagingRollbackFailures += "$stagingDir`: $($_.Exception.Message)"
      }
    }
  }
  elseif ($stagingBackedUp -and (Test-Path -LiteralPath $stagingBackupDir)) {
    try {
      Remove-Item -LiteralPath $stagingBackupDir -Recurse -Force
    }
    catch {
      Write-Warning "The new runtime and staging match, but old staging remains at $stagingBackupDir`: $($_.Exception.Message)"
    }
  }

  Remove-Item -LiteralPath $candidateStagingDir -Recurse -Force -ErrorAction SilentlyContinue
  if ($stagingRollbackFailures.Count -gt 0) {
    throw "Local install failed: $($installFailure.Exception.Message) Staging rollback was incomplete: $($stagingRollbackFailures -join '; ')"
  }
  throw $installFailure
}

if ($stagingBackedUp -and (Test-Path -LiteralPath $stagingBackupDir)) {
  try {
    Remove-Item -LiteralPath $stagingBackupDir -Recurse -Force
  }
  catch {
    Write-Warning "Old staging remains at $stagingBackupDir`: $($_.Exception.Message)"
  }
}

Write-Host ''
Write-Host "To uninstall later, run: npm run uninstall:cli"
Write-Host "(uninstall.ps1 is kept at $stagingDir and owns only $localInstallDir)"
