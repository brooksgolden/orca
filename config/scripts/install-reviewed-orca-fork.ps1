[CmdletBinding(SupportsShouldProcess)]
param(
  [Parameter(Mandatory)][string] $Source,
  [string] $Target = "$env:LOCALAPPDATA\Programs\orca",
  [string] $UserData = "$env:APPDATA\orca"
)

$ErrorActionPreference = 'Stop'
$sourcePath = (Resolve-Path -LiteralPath $Source).Path
$targetPath = (Resolve-Path -LiteralPath $Target).Path
if ($sourcePath -eq $targetPath) { throw 'Source and installed app must be different directories.' }
$manifest = Get-Content -LiteralPath (Join-Path $sourcePath 'reviewed-build.json') -Raw | ConvertFrom-Json
if ($manifest.smokeTest -ne 'passed') { throw 'The source package has no passing smoke-test record.' }

function Assert-ReviewedFiles([string] $Root) {
  foreach ($file in @(
    @{ Path = 'Orca.exe'; Hash = $manifest.exeSha256 },
    @{ Path = 'resources\app.asar'; Hash = $manifest.asarSha256 }
  )) {
    if (-not $file.Hash -or (Get-FileHash -LiteralPath (Join-Path $Root $file.Path) -Algorithm SHA256).Hash -ne $file.Hash) {
      throw "Reviewed package hash mismatch: $($file.Path)"
    }
  }
}

Assert-ReviewedFiles $sourcePath
if (-not (Test-Path -LiteralPath (Join-Path $targetPath 'Orca.exe'))) {
  throw "No installed Orca found at $targetPath."
}
if (-not $WhatIfPreference -and (Get-Process -Name 'Orca' -ErrorAction SilentlyContinue)) {
  throw 'Close Orca completely before installing. No files were changed.'
}
if (-not $PSCmdlet.ShouldProcess($targetPath, 'Back up Orca and its user data, then install the smoke-tested build')) {
  return
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$backup = "$targetPath-backup-$stamp"
Copy-Item -LiteralPath $targetPath -Destination $backup -Recurse
if (Test-Path -LiteralPath $UserData) {
  Copy-Item -LiteralPath $UserData -Destination "$UserData-backup-$stamp" -Recurse
}
try {
  foreach ($entry in Get-ChildItem -LiteralPath $sourcePath -Force) {
    Copy-Item -LiteralPath $entry.FullName -Destination $targetPath -Recurse -Force
  }
  Assert-ReviewedFiles $targetPath
} catch {
  $installError = $_
  foreach ($entry in Get-ChildItem -LiteralPath $backup -Force) {
    Copy-Item -LiteralPath $entry.FullName -Destination $targetPath -Recurse -Force
  }
  throw "Installation failed; the previous app files were restored. Backup: $backup. Error: $installError"
}
Write-Host "Installed reviewed commit $($manifest.commit). App backup: $backup"
Write-Host "User data backup, if present: $UserData-backup-$stamp"
