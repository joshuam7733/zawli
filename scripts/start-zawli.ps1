# Starts Zawli on this computer for testing (Windows).
#   Double-click "Start Zawli.cmd" in the project folder, or run:
#   powershell -ExecutionPolicy Bypass -File scripts\start-zawli.ps1 [-Rebuild]
#
# Opens two windows (database, app). Close both windows to stop Zawli.
param([switch]$Rebuild)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Say($msg) { Write-Host "[zawli] $msg" -ForegroundColor Green }
function Fail($msg) { Write-Host "[zawli] $msg" -ForegroundColor Red; Read-Host "Press Enter to close"; exit 1 }

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail "Node.js is not installed. Install Node.js 20 or newer from nodejs.org, then try again." }
if (-not (Test-Path ".env")) { Fail "The .env file is missing. Copy .env.example to .env (see docs/LOCAL_SETUP.md)." }
if (-not (Test-Path "node_modules")) { Say "Installing dependencies (first run, can take several minutes)..."; npm install; if ($LASTEXITCODE) { Fail "npm install failed." } }

function PortOpen($port) {
  try { $c = New-Object Net.Sockets.TcpClient; $c.Connect("127.0.0.1", $port); $c.Close(); return $true } catch { return $false }
}

# 1. Database
if (PortOpen 54329) {
  Say "Database already running."
} else {
  Say "Starting the database in a new window..."
  Start-Process powershell -ArgumentList "-NoExit", "-Command", "`$Host.UI.RawUI.WindowTitle='Zawli database (keep open)'; Set-Location '$root'; npm run db:local"
  $t = 0
  while (-not (PortOpen 54329)) { Start-Sleep 2; $t += 2; if ($t -gt 180) { Fail "The database did not start. Check the 'Zawli database' window." } }
  Start-Sleep 3
}

# 2. Database tables and demo data (safe to repeat: nothing is deleted)
Say "Preparing the database..."
npx prisma migrate deploy | Out-Host
if ($LASTEXITCODE) { Fail "Database migration failed." }
npx tsx prisma/seed.ts | Out-Host

# 3. App build (only when missing, or with -Rebuild after code changes)
if ($Rebuild -or -not (Test-Path ".next/BUILD_ID")) {
  Say "Building the app (about 5-10 minutes on this computer)..."
  $env:NEXT_TELEMETRY_DISABLED = "1"
  npx next build | Out-Host
  if ($LASTEXITCODE) { Fail "The build failed." }
}

# 4. Address that phones on the same Wi-Fi can use (for scanning table QR codes)
$ip = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -match '^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))' -and $_.InterfaceAlias -notmatch 'vEthernet|WSL|Hyper-V|VirtualBox|VMware' -and $_.PrefixOrigin -ne 'WellKnown' } |
  Select-Object -First 1 -ExpandProperty IPAddress
$publicUrl = if ($ip) { "http://${ip}:3000" } else { "http://localhost:3000" }

if (PortOpen 3000) {
  Say "Something is already running on port 3000 - assuming it is Zawli."
} else {
  Say "Starting the app in a new window..."
  $cmd = "`$Host.UI.RawUI.WindowTitle='Zawli app (keep open)'; Set-Location '$root'; " +
    "`$env:NEXT_TELEMETRY_DISABLED='1'; `$env:APP_URL='$publicUrl'; `$env:MOBILE_MONEY_SIMULATOR='allow'; " +
    "npx next start -H 0.0.0.0 -p 3000"
  Start-Process powershell -ArgumentList "-NoExit", "-Command", $cmd
  $t = 0
  while (-not (PortOpen 3000)) { Start-Sleep 2; $t += 2; if ($t -gt 120) { Fail "The app did not start. Check the 'Zawli app' window." } }
  Start-Sleep 3
}

Start-Process "http://localhost:3000/login"
Write-Host ""
Say "Zawli is running."
Write-Host "  On this computer:         http://localhost:3000"
if ($ip) { Write-Host "  Phones on the same Wi-Fi: $publicUrl   (table QR codes point here)" }
Write-Host "  Demo password for all test accounts: ZawliDemo2026   (see TESTING.md)"
Write-Host "  To stop: close the 'Zawli app' and 'Zawli database' windows."
Write-Host ""
Write-Host "  If phones can't connect, allow Node.js on 'Private networks' when Windows Firewall asks." -ForegroundColor Yellow
Read-Host "Press Enter to close this window (Zawli keeps running)"
