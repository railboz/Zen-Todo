# Zen Todo — génère les zips de soumission (AMO + Chrome Web Store)
# Utilisation : powershell -ExecutionPolicy Bypass -File .\make-zips.ps1 [-Version "3.1.9"]
# - manifest.json à la racine du zip
# - séparateurs Unix dans les entrées (exigé par AMO/CWS)
# - fichiers de dev exclus (sync-code.ps1, SYNC.md ; les .md ne partent pas dans le zip Chrome)

param([string]$Version = "3.1.9")

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = $PSScriptRoot
$targets = @(
  @{ dir = Join-Path $root "zen-todo-3.1.4-firefox"; zip = Join-Path $root "zen-todo-$Version-firefox.zip"; exclude = @("sync-code.ps1", "SYNC.md") },
  @{ dir = Join-Path $root "zen-todo-3.1.3-chrome"; zip = Join-Path $root "zen-todo-$Version-chrome.zip"; exclude = @("*.md", "sync-code.ps1") }
)

foreach ($t in $targets) {
  if (-not (Test-Path $t.dir)) { Write-Error "Dossier introuvable : $($t.dir)" }
  if (Test-Path $t.zip) { Remove-Item $t.zip -Force }

  $zip = [System.IO.Compression.ZipFile]::Open($t.zip, [System.IO.Compression.ZipArchiveMode]::Create)
  try {
    $files = Get-ChildItem $t.dir -Recurse -File | Where-Object {
      $rel = $_.FullName.Substring($t.dir.Length + 1)
      $keep = $true
      foreach ($ex in $t.exclude) { if ($rel -like $ex) { $keep = $false } }
      $keep
    }
    foreach ($fi in $files) {
      $entry = $fi.FullName.Substring($t.dir.Length + 1).Replace("\", "/")
      [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $fi.FullName, $entry) | Out-Null
    }
  } finally { $zip.Dispose() }

  $ok = [System.IO.Compression.ZipFile]::OpenRead($t.zip)
  Write-Host ""
  Write-Host (">> " + (Split-Path $t.zip -Leaf) + "  (" + [math]::Round((Get-Item $t.zip).Length / 1KB, 1) + " Ko)")
  $ok.Entries | ForEach-Object { Write-Host ("   " + $_.FullName + "  [" + $_.Length + " o]") }
  $ok.Dispose()
}
Write-Host ""
Write-Host "Zips prets dans : $root"
