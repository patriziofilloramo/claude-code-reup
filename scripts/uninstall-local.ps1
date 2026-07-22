# Runs uninstall.ps1 from the local staging folder created by install-local.ps1.

$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$stagingDir = Join-Path $repoRoot '.install-staging\windows'
$uninstallScript = Join-Path $stagingDir 'uninstall.ps1'

if (-not (Test-Path $uninstallScript)) {
  Write-Error "No uninstall.ps1 found at $stagingDir. Nothing to uninstall (or it was already removed) - run 'npm run install:cli' first if you need to reinstall."
  exit 1
}

& $uninstallScript
