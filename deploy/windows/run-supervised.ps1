# Runs one command forever: if it exits (crash, update, network loss), it is started again after 5 s.
# Output is appended to logs\<Name>.log. Started hidden by start-auratio.ps1.
param(
  [Parameter(Mandatory)] [string] $Name,
  [Parameter(Mandatory)] [string] $FilePath,
  # Arguments separated by "|" (powershell -File cannot pass arrays), e.g. "run|serve".
  [string] $ArgumentLine = "",
  [Parameter(Mandatory)] [string] $WorkingDirectory
)

$logDir = Join-Path $WorkingDirectory "logs"
New-Item -ItemType Directory -Force $logDir | Out-Null
$log = Join-Path $logDir "$Name.log"
Set-Location $WorkingDirectory
$arguments = @($ArgumentLine -split "\|" | Where-Object { $_ -ne "" })
$quoted = ($arguments | ForEach-Object { if ($_ -match "\s") { "`"$_`"" } else { $_ } }) -join " "
# cmd.exe appends the program's output byte for byte (PowerShell 5.1 redirection would re-encode it as UTF-16).
$cmdLine = "/d /s /c `"`"$FilePath`" $quoted >> `"$log`" 2>&1`""

$delay = 5
while ($true) {
  # Keep each log under ~5 MB.
  if ((Test-Path $log) -and (Get-Item $log).Length -gt 5MB) { Move-Item -Force $log "$log.old" }
  Add-Content -Encoding ascii $log "[$(Get-Date -Format s)] starting $Name"
  $started = Get-Date
  $process = Start-Process cmd.exe -ArgumentList $cmdLine -NoNewWindow -Wait -PassThru
  # A program that keeps failing straight away is retried less and less often (up to every 5 min).
  $delay = if (((Get-Date) - $started).TotalSeconds -lt 60) { [Math]::Min($delay * 2, 300) } else { 5 }
  Add-Content -Encoding ascii $log "[$(Get-Date -Format s)] $Name exited with code $($process.ExitCode); restarting in $delay s"
  Start-Sleep -Seconds $delay
}
