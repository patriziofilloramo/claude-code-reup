# Finds the most recently built Windows RC package under release/, extracts
# it to a stable local staging folder, and runs its install.ps1.
#
# Prerequisite: npm run release:installers (produces release/reup-v<version>-<hash>/).
# This script does not build anything itself - a full build runs the whole
# validation chain (tests, extension host smoke test, npm audit) and can take
# several minutes, so it stays an explicit, separate step.

$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$releaseRoot = Join-Path $repoRoot 'release'
$stagingDir = Join-Path $repoRoot '.install-staging\windows'

if (-not (Test-Path $releaseRoot)) {
  Write-Error "No release/ directory found. Run 'npm run release:installers' first."
  exit 1
}

$latestRelease = Get-ChildItem $releaseRoot -Directory -Filter 'reup-v*' |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $latestRelease) {
  Write-Error "No reup-v* release folder found under release/. Run 'npm run release:installers' first."
  exit 1
}

$zipPath = Get-ChildItem (Join-Path $latestRelease.FullName 'installers') -Filter 'reup-windows-x64-v*.zip' -ErrorAction SilentlyContinue |
  Select-Object -First 1

if (-not $zipPath) {
  Write-Error "No Windows zip package found in $($latestRelease.Name)\installers. Run 'npm run release:installers' first."
  exit 1
}

Write-Host "Using package: $($zipPath.Name) (from $($latestRelease.Name))"

if (Test-Path $stagingDir) {
  Remove-Item $stagingDir -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $stagingDir | Out-Null
Expand-Archive -Path $zipPath.FullName -DestinationPath $stagingDir -Force

Write-Host "Extracted to: $stagingDir"
Write-Host ''

& (Join-Path $stagingDir 'install.ps1')

Write-Host ''
Write-Host "To uninstall later, run: npm run uninstall:cli"
Write-Host "(uninstall.ps1 is kept at $stagingDir until the next install/uninstall run)"
