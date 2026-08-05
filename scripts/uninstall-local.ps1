# Runs uninstall.ps1 from the local staging folder created by install-local.ps1.

$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$stagingDir = Join-Path $repoRoot '.install-staging\windows'
$uninstallScript = Join-Path $stagingDir 'uninstall.ps1'
$stagedManifestPath = Join-Path $stagingDir 'app\package.json'
$installDir = Join-Path $env:LOCALAPPDATA 'Programs\reup-dev'
$installedManifestPath = Join-Path $installDir 'app\package.json'
$markerPath = Join-Path $installDir '.reup-portable-install.json'

if (-not (Test-Path $uninstallScript)) {
  Write-Error "No uninstall.ps1 found at $stagingDir. Nothing to uninstall (or it was already removed) - run 'npm run install:cli' first if you need to reinstall."
  exit 1
}

foreach ($requiredFile in @($stagedManifestPath, $installedManifestPath, $markerPath)) {
  if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
    Write-Error "Refusing to uninstall because the portable-install ownership evidence is missing: $requiredFile"
    exit 1
  }
}

$stagedManifest = Get-Content -LiteralPath $stagedManifestPath -Raw | ConvertFrom-Json
$installedManifest = Get-Content -LiteralPath $installedManifestPath -Raw | ConvertFrom-Json
$marker = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
if (
  $stagedManifest.name -ne '@patriziofilloramo/reup' -or
  $installedManifest.name -ne $stagedManifest.name -or
  $installedManifest.version -ne $stagedManifest.version -or
  $marker.schemaVersion -ne 1 -or
  $marker.installKind -ne 'portable-windows' -or
  $marker.packageName -ne $stagedManifest.name -or
  $marker.version -ne $stagedManifest.version -or
  $marker.pathTarget -ne 'User'
) {
  Write-Error 'Refusing to uninstall because the staged package does not own the currently installed Reup version.'
  exit 1
}

& $uninstallScript -InstallDir $installDir
