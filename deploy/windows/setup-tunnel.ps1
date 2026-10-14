# One-time Cloudflare Tunnel setup for AuRatio. Prerequisites:
#   - cryptogold.me added to your Cloudflare account, with GoDaddy's nameservers switched to Cloudflare's;
#   - `cloudflared tunnel login` done (it opens a browser; pick cryptogold.me), which writes cert.pem.
# Creates the tunnel, its config and the DNS records for both host names. Safe to run again.
param(
  [string] $TunnelName = "auratio",
  [string[]] $Hostnames = @("www.cryptogold.me", "cryptogold.me"),
  [int] $Port = 3000
)
$ErrorActionPreference = "Stop"
$cloudflared = Join-Path $env:LOCALAPPDATA "cloudflared\cloudflared.exe"
$dir = Join-Path $env:USERPROFILE ".cloudflared"
if (-not (Test-Path $cloudflared)) { throw "cloudflared not found at $cloudflared" }
if (-not (Test-Path (Join-Path $dir "cert.pem"))) { throw "Not logged in: run `"$cloudflared`" tunnel login first." }

# cloudflared logs to stderr; Windows PowerShell would treat those lines as errors, so judge by exit code.
function Invoke-Cloudflared([string[]] $arguments, [switch] $StdoutOnly) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    if ($StdoutOnly) { $output = & $cloudflared @arguments 2>$null }
    else { $output = & $cloudflared @arguments 2>&1 | ForEach-Object { "$_" } }
  } finally {
    $ErrorActionPreference = $previous
  }
  if ($LASTEXITCODE -ne 0) { throw "cloudflared $($arguments -join ' ') failed (exit $LASTEXITCODE):`n$($output -join "`n")" }
  $output
}

function Get-Tunnel {
  (Invoke-Cloudflared @("tunnel", "list", "--output", "json") -StdoutOnly) -join "`n" |
    ConvertFrom-Json | Where-Object { $_.name -eq $TunnelName }
}

# Reuse the tunnel if it already exists.
$existing = Get-Tunnel
if (-not $existing) {
  Invoke-Cloudflared @("tunnel", "create", $TunnelName) | Out-Host
  $existing = Get-Tunnel
}
$id = $existing.id
$credentials = Join-Path $dir "$id.json"
if (-not (Test-Path $credentials)) { throw "Tunnel credentials $credentials are missing." }

$ingress = ($Hostnames | ForEach-Object { "  - hostname: $_`n    service: http://127.0.0.1:$Port" }) -join "`n"
$config = @"
# Cloudflare Tunnel for AuRatio (written by setup-tunnel.ps1)
tunnel: $id
credentials-file: $credentials
ingress:
$ingress
  - service: http_status:404
"@
# Plain ASCII: Windows PowerShell's "utf8" adds a byte-order mark that YAML parsers may reject.
Set-Content -Encoding ascii -Path (Join-Path $dir "config.yml") -Value $config

foreach ($hostname in $Hostnames) {
  # Creates (or replaces) a proxied CNAME <hostname> -> <id>.cfargotunnel.com in Cloudflare DNS.
  Invoke-Cloudflared @("tunnel", "route", "dns", "--overwrite-dns", $TunnelName, $hostname) | Out-Host
}
Invoke-Cloudflared @("tunnel", "--config", (Join-Path $dir "config.yml"), "ingress", "validate") | Out-Host
Write-Host "Tunnel '$TunnelName' ($id) ready for: $($Hostnames -join ', ')"
