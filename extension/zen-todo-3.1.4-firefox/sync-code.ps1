# Zen Todo — copie les fichiers de code partagés du dossier Firefox (v3.1.4) vers le dossier Chrome.
# À lancer depuis le dossier Firefox après chaque modification de code :
#   powershell -ExecutionPolicy Bypass -File .\sync-code.ps1
# Les manifestes restent indépendants (pas écrasés). sidepanel.html est propre au dossier Chrome.

$ErrorActionPreference = "Stop"
$src = $PSScriptRoot
$root = Split-Path $src -Parent
$targets = @("zen-todo-3.1.3-chrome")

$files = "background.js","datepicker.js","i18n.js","popup.css","popup.html","popup.js","sync.js",
         "theme-init.js","theme.css","theme-modern.css","util.js",
         "SECURITY.md","SYNC.md"

foreach ($t in $targets) {
  $dst = Join-Path $root $t
  if (-not (Test-Path $dst)) { Write-Error "Dossier introuvable : $dst" }
  Copy-Item ($files | ForEach-Object { Join-Path $src $_ }) $dst -Force
  Copy-Item (Join-Path $src "icons\*.png") (Join-Path $dst "icons") -Force
  Write-Host ""
  Write-Host "Fichiers partages copies vers : $dst"
}
Write-Host ""
Write-Host "Pensez a cliquer sur 'Actualiser' dans chrome://extensions (et opera://extensions)."
