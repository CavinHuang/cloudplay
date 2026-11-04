# CloudPlay P0 - Windows GPU host diagnostics (PowerShell 5.1+)
# Read-only: does not download software, change firewall rules, or extract secrets.
param(
  [int]$SunshinePort = 47990,
  [int]$MoonlightWebPort = 8080,
  [string]$OutputPath = '.\cloudplay-p0-host-report.json'
)
$ErrorActionPreference = 'Continue'
function ProbeTcp($Port) {
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $result = $client.BeginConnect('127.0.0.1',$Port,$null,$null)
    $connected = $result.AsyncWaitHandle.WaitOne(1600,$false)
    if ($connected) { try { $client.EndConnect($result) } catch { $connected = $false } }
    $client.Close()
    return [bool]$connected
  } catch { return $false }
}
$gpu = @()
try {
  $gpu = @(Get-CimInstance Win32_VideoController | ForEach-Object {
    [pscustomobject]@{ name=$_.Name; driverVersion=$_.DriverVersion; adapterRAM=$_.AdapterRAM; status=$_.Status }
  })
} catch { Write-Warning "Cannot query GPU by CIM: $_" }
$nvidia = @()
try {
  $cmd = Get-Command nvidia-smi -ErrorAction SilentlyContinue
  if ($cmd) {
    $nvidia = @(nvidia-smi --query-gpu=name,driver_version,memory.total,utilization.gpu --format=csv,noheader 2>$null)
  }
} catch { Write-Warning "nvidia-smi unavailable" }
$sunshineProcess = @(Get-Process -Name 'sunshine' -ErrorAction SilentlyContinue | Select-Object ProcessName,Id)
$webProcess = @(Get-Process -Name 'web-server' -ErrorAction SilentlyContinue | Select-Object ProcessName,Id)
$report = [ordered]@{
  reportType = 'cloudplay-p0-windows-host'
  generatedAt = (Get-Date).ToUniversalTime().ToString('o')
  machineName = $env:COMPUTERNAME
  os = [Environment]::OSVersion.VersionString
  gpu = $gpu
  nvidiaSmi = $nvidia
  sunshine = @{port=$SunshinePort;tcpListening=(ProbeTcp $SunshinePort);processCount=$sunshineProcess.Count}
  moonlightWeb = @{port=$MoonlightWebPort;tcpListening=(ProbeTcp $MoonlightWebPort);processCount=$webProcess.Count}
  interpretation = 'TCP tests only indicate local port reachability; they do not prove successful pairing, video, input or audio.'
}
try {
  $json = $report | ConvertTo-Json -Depth 8
  $json | Set-Content -Path $OutputPath -Encoding UTF8
  Write-Host "Saved report to $OutputPath" -ForegroundColor Green
  Write-Output $json
} catch { Write-Error "Failed to save diagnostics: $_"; exit 2 }
if (-not $report.sunshine.tcpListening) { Write-Warning 'Sunshine UI is not listening on the expected local port. Open Sunshine first.' }
if (-not $report.moonlightWeb.tcpListening) { Write-Warning 'Moonlight Web Stream is not listening on the expected local port. Start its server first.' }
