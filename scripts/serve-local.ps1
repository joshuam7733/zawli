# Runs Zawli in the foreground for local testing: makes sure the database is up
# (starting it in its own window if needed), applies migrations, builds once if
# needed, then serves the app on port 3000. Used by the Claude app's preview
# (.claude/launch.json). For everyday use, double-click "Start Zawli.cmd".
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function PortOpen($port) {
  try { $c = New-Object Net.Sockets.TcpClient; $c.Connect("127.0.0.1", $port); $c.Close(); return $true } catch { return $false }
}

if (-not (PortOpen 54329)) {
  Write-Host "[zawli] Starting the database window..."
  Start-Process powershell -ArgumentList "-NoExit", "-Command", "`$Host.UI.RawUI.WindowTitle='Zawli database (keep open)'; Set-Location '$root'; npm run db:local"
  $t = 0
  while (-not (PortOpen 54329)) { Start-Sleep 2; $t += 2; if ($t -gt 180) { throw "Database did not start." } }
  Start-Sleep 3
}
npx prisma migrate deploy | Out-Host
if (-not (Test-Path ".next/BUILD_ID")) {
  $env:NEXT_TELEMETRY_DISABLED = "1"
  npx next build | Out-Host
}
$env:NEXT_TELEMETRY_DISABLED = "1"
$env:MOBILE_MONEY_SIMULATOR = "allow"
npx next start -H 0.0.0.0 -p 3000
