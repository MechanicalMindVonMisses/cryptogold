# Starts AuRatio automatically when you log in to Windows (no administrator rights needed): puts a
# shortcut to start-auratio.ps1 in your Startup folder. Remove it with -Uninstall.
param([switch] $Uninstall)

$shortcut = Join-Path ([Environment]::GetFolderPath("Startup")) "AuRatio.lnk"
if ($Uninstall) {
  Remove-Item -ErrorAction SilentlyContinue $shortcut
  Write-Host "Autostart removed."
  exit 0
}

$start = Join-Path $PSScriptRoot "start-auratio.ps1"
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut($shortcut)
$link.TargetPath = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$link.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$start`""
$link.WorkingDirectory = $PSScriptRoot
$link.WindowStyle = 7 # minimised
$link.Description = "Start AuRatio (www.cryptogold.me) and its Cloudflare Tunnel"
$link.Save()
Write-Host "Autostart installed: $shortcut"
