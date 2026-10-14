# Starts AuRatio for www.cryptogold.me on this PC:
#   1. the production server on 127.0.0.1:3000 (it also records prices every minute), and
#   2. the Cloudflare Tunnel that carries visitors from the domain to it.
# Both run hidden and restart automatically. Logs: <project>\logs. Stop with stop-auratio.ps1.

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$logDir = Join-Path $root "logs"
$pidFile = Join-Path $logDir "auratio.pids"
$cloudflared = Join-Path $env:LOCALAPPDATA "cloudflared\cloudflared.exe"
$tunnelConfig = Join-Path $env:USERPROFILE ".cloudflared\config.yml"
New-Item -ItemType Directory -Force $logDir | Out-Null

if ((Test-Path $pidFile) -and (Get-Content $pidFile | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue })) {
  Write-Host "AuRatio is already running (see $pidFile). Run stop-auratio.ps1 first to restart it."
  exit 0
}

# Build once if there is no production build yet (or after `git pull`, run `npm run build` yourself).
if (-not (Test-Path (Join-Path $root ".next\BUILD_ID"))) {
  Write-Host "No production build found; running npm run build..."
  Push-Location $root
  try { npm run build *>> (Join-Path $logDir "build.log") } finally { Pop-Location }
  if ($LASTEXITCODE -ne 0) { throw "Build failed; see $logDir\build.log" }
}

$supervisor = Join-Path $PSScriptRoot "run-supervised.ps1"
function Start-Hidden([string] $name, [string] $file, [string[]] $arguments) {
  $argList = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", "`"$supervisor`"",
    "-Name", $name, "-FilePath", "`"$file`"", "-WorkingDirectory", "`"$root`"")
  if ($arguments.Count -gt 0) { $argList += @("-ArgumentLine", "`"$($arguments -join "|")`"") }
  (Start-Process powershell.exe -ArgumentList $argList -WindowStyle Hidden -PassThru).Id
}

$pids = @()
# Next.js is started with full paths: launched through cmd.exe, npm.cmd would look for npm in the
# project folder. Listens on 127.0.0.1 only, so visitors can reach it only through the tunnel.
$node = (Get-Command node.exe -ErrorAction Stop).Source
$next = Join-Path $root "node_modules\next\dist\bin\next"
$pids += Start-Hidden "server" $node @($next, "start", "--hostname", "127.0.0.1", "--port", "3000")
if ((Test-Path $cloudflared) -and (Test-Path $tunnelConfig)) {
  $pids += Start-Hidden "tunnel" $cloudflared @("tunnel", "--config", $tunnelConfig, "run")
} else {
  Write-Host "Tunnel not configured yet (run setup-tunnel.ps1); serving on http://127.0.0.1:3000 only."
}
$pids | Set-Content $pidFile
Write-Host "AuRatio started (supervisor PIDs: $($pids -join ', ')). Logs: $logDir"
