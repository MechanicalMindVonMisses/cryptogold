# Stops the AuRatio server and Cloudflare Tunnel started by start-auratio.ps1 (whole process trees).
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$pidFile = Join-Path $root "logs\auratio.pids"
if (-not (Test-Path $pidFile)) {
  Write-Host "AuRatio is not running (no $pidFile)."
  exit 0
}
foreach ($id in Get-Content $pidFile) {
  if (Get-Process -Id $id -ErrorAction SilentlyContinue) {
    taskkill /PID $id /T /F | Out-Null
    Write-Host "Stopped process tree $id"
  }
}
Remove-Item $pidFile
