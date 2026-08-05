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
    # Preserve unrelated unusual PATH entries verbatim.
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
    if (-not [string]::IsNullOrWhiteSpace($part) -and (Get-NormalizedPathEntry $part) -ne $entryKey) {
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

$InstallDir = [IO.Path]::GetFullPath($InstallDir)
$sourceManifestPath = Join-Path $Source 'app\package.json'
$installedManifestPath = Join-Path $InstallDir 'app\package.json'
$markerPath = Join-Path $InstallDir '.reup-portable-install.json'
$installedApp = Join-Path $InstallDir 'app'
$installedBin = Join-Path $InstallDir 'bin'
$bin = $installedBin

if (-not (Test-Path -LiteralPath $sourceManifestPath -PathType Leaf)) {
  throw 'Run this uninstaller from the same extracted Reup package that performed the install.'
}
if (-not (Test-Path -LiteralPath $markerPath -PathType Leaf)) {
  throw "Refusing to remove $InstallDir because it has no portable-install ownership marker."
}
if (-not (Test-Path -LiteralPath $installedManifestPath -PathType Leaf)) {
  throw "Refusing to remove $InstallDir because its installed manifest is missing."
}

$sourceManifest = Get-Content -LiteralPath $sourceManifestPath -Raw | ConvertFrom-Json
$installedManifest = Get-Content -LiteralPath $installedManifestPath -Raw | ConvertFrom-Json
$marker = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
$expectedName = '@patriziofilloramo/reup'
$expectedVersion = [string]$sourceManifest.version

if (
  $sourceManifest.name -ne $expectedName -or
  $marker.schemaVersion -ne 1 -or
  $marker.installKind -ne 'portable-windows' -or
  $marker.packageName -ne $expectedName -or
  $marker.version -ne $expectedVersion -or
  $marker.pathTarget -ne $PathTarget -or
  $installedManifest.name -ne $expectedName -or
  $installedManifest.version -ne $expectedVersion
) {
  throw 'Refusing to uninstall: staged package, ownership marker, and installed version do not match.'
}

$installParent = Split-Path $InstallDir -Parent
$transactionRoot = Join-Path $installParent ('.reup-uninstall-' + [Guid]::NewGuid().ToString('N'))
$savedApp = Join-Path $transactionRoot 'app'
$savedBin = Join-Path $transactionRoot 'bin'
$savedMarker = Join-Path $transactionRoot '.reup-portable-install.json'
$originalTargetPath = Get-TargetPathValue
$movedApp = $false
$movedBin = $false
$movedMarker = $false
$pathUpdateAttempted = $false

try {
  New-Item -ItemType Directory -Force -Path $transactionRoot | Out-Null
  Move-Item -LiteralPath $installedApp -Destination $savedApp
  $movedApp = $true
  Move-Item -LiteralPath $installedBin -Destination $savedBin
  $movedBin = $true
  Move-Item -LiteralPath $markerPath -Destination $savedMarker
  $movedMarker = $true

  $pathUpdateAttempted = $true
  $nextTargetPath = @(Get-PathWithoutEntry $originalTargetPath $bin) -join ';'
  Set-TargetPathValue $nextTargetPath
  $persistedPath = Get-TargetPathValue
  $stillPresent = @($persistedPath -split ';') |
    Where-Object { (Get-NormalizedPathEntry $_) -eq (Get-NormalizedPathEntry $bin) }
  if ($stillPresent.Count -gt 0) {
    throw "The Reup PATH entry could not be removed: $bin"
  }
}
catch {
  $uninstallFailure = $_
  $rollbackFailures = @()
  if ($pathUpdateAttempted) {
    try {
      Set-TargetPathValue $originalTargetPath
    }
    catch {
      $rollbackFailures += "PATH: $($_.Exception.Message)"
    }
  }

  $savedPaths = @(
    [pscustomobject]@{ Moved = $movedApp; Saved = $savedApp; Destination = $installedApp },
    [pscustomobject]@{ Moved = $movedBin; Saved = $savedBin; Destination = $installedBin },
    [pscustomobject]@{ Moved = $movedMarker; Saved = $savedMarker; Destination = $markerPath }
  )
  foreach ($savedPath in $savedPaths) {
    if ($savedPath.Moved -and (Test-Path -LiteralPath $savedPath.Saved)) {
      try {
        Move-Item -LiteralPath $savedPath.Saved -Destination $savedPath.Destination
      }
      catch {
        $rollbackFailures += "$($savedPath.Destination): $($_.Exception.Message)"
      }
    }
  }

  if ($rollbackFailures.Count -gt 0) {
    throw "Uninstall failed: $($uninstallFailure.Exception.Message) Rollback was incomplete; recovery files remain at $transactionRoot`: $($rollbackFailures -join '; ')"
  }
  Remove-Item -LiteralPath $transactionRoot -Recurse -Force -ErrorAction SilentlyContinue
  throw $uninstallFailure
}

try {
  Remove-Item -LiteralPath $transactionRoot -Recurse -Force
}
catch {
  Write-Warning "Reup was uninstalled, but temporary files could not be removed from $transactionRoot`: $($_.Exception.Message)"
}

$remainingFiles = @(Get-ChildItem -LiteralPath $InstallDir -Force -ErrorAction SilentlyContinue)
if ($remainingFiles.Count -eq 0) {
  Remove-Item -LiteralPath $InstallDir -Force
  Write-Host "Reup removed from $InstallDir"
}
else {
  Write-Host "Portable Reup app/bin removed from $InstallDir"
  Write-Host 'Files owned by another installer were preserved:'
  foreach ($remainingFile in $remainingFiles) {
    Write-Host "  $($remainingFile.Name)"
  }
}
