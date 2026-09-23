[CmdletBinding(SupportsShouldProcess)]
param(
  [Parameter(Mandatory)][string] $Source,
  [string] $Target = "$env:LOCALAPPDATA\Programs\orca",
  [string] $UserData = "$env:APPDATA\orca",
  [string] $ExistingUserDataBackup = ''
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
$targetExecutable = Join-Path $targetPath 'Orca.exe'
$desktopAppRunning = Get-Process -Name 'Orca' -ErrorAction SilentlyContinue | Where-Object {
  try {
    [string]::Equals($_.Path, $targetExecutable, [System.StringComparison]::OrdinalIgnoreCase)
  } catch {
    $false
  }
}
if (-not $WhatIfPreference -and $desktopAppRunning) {
  throw 'Close Orca completely before installing. No files were changed.'
}
if (-not $PSCmdlet.ShouldProcess($targetPath, 'Back up Orca and its user data, then install the smoke-tested build')) {
  return
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$backup = "$targetPath-backup-$stamp"
Copy-Item -LiteralPath $targetPath -Destination $backup -Recurse
$userDataBackup = $null
if ($ExistingUserDataBackup) {
  $userDataBackup = (Resolve-Path -LiteralPath $ExistingUserDataBackup).Path
  if (-not [string]::Equals(
    (Split-Path -Parent $userDataBackup),
    (Split-Path -Parent $UserData),
    [System.StringComparison]::OrdinalIgnoreCase
  ) -or -not (Split-Path -Leaf $userDataBackup).StartsWith(
    "$(Split-Path -Leaf $UserData)-backup-",
    [System.StringComparison]::OrdinalIgnoreCase
  )) {
    throw 'Existing user data backup must be a sibling Orca backup directory.'
  }
} elseif (Test-Path -LiteralPath $UserData) {
  $userDataBackup = "$UserData-backup-$stamp"
  New-Item -ItemType Directory -Path $userDataBackup -ErrorAction Stop | Out-Null
  & robocopy.exe $UserData $userDataBackup /E /R:0 /W:0 /XJ /XF Cookies *.sqlite-shm *.db-shm /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) {
    throw "Orca user data backup failed with robocopy exit code $LASTEXITCODE. No app files were changed."
  }
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
Write-Host "User data backup, if present: $userDataBackup"
