# CloudPlay P0 local lab launcher. Runs ONLY on the current PC, makes no changes to
# firewall, networking, Sunshine configuration, game libraries, or game licensing.
[CmdletBinding()]
param(
  [string]$GamePath = '',
  [switch]$SkipAgent,
  [switch]$EnableLocalLaunch
)
$ErrorActionPreference='Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
# Offline installations set CLOUDPLAY_STATE_DIR outside the immutable release tree.
# Preserve the original standalone P0 workflow when that variable is absent.
$stateRoot=if($env:CLOUDPLAY_STATE_DIR){[IO.Path]::GetFullPath($env:CLOUDPLAY_STATE_DIR)}else{$root}
New-Item -ItemType Directory -Force -Path $stateRoot | Out-Null
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { throw 'Node.js >=22 required: https://nodejs.org/' }
$major = [int]((& $node.Source --version).TrimStart('v').Split('.')[0])
if ($major -lt 22) { throw 'Node.js >=22 required' }

$secretFile = Join-Path $stateRoot '.p0-lab-token'
if (Test-Path -LiteralPath $secretFile) {
  $token = [IO.File]::ReadAllText($secretFile).Trim()
} else {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $token = ([BitConverter]::ToString($bytes)).Replace('-','').ToLowerInvariant()
  [IO.File]::WriteAllText($secretFile, $token)
  Write-Host 'Generated a local auth token in .p0-lab-token (do not commit or share it).'
}
if ($token.Length -lt 32) { throw 'Invalid token file; must be at least 32 characters' }
$env:CLOUDPLAY_LAB_TOKEN=$token
$env:CLOUDPLAY_LAB_ENDPOINT='http://127.0.0.1:7788'
# Local-only durable metadata; no tokens, media or game executable paths stored.
$env:P0_SESSION_JOURNAL=Join-Path $stateRoot '.p0-session-journal.json'
$env:CLOUDPLAY_ENABLE_LOCAL_LAUNCH=$(if ($EnableLocalLaunch) {'1'} else {'0'})
if ($EnableLocalLaunch -and -not $GamePath) { throw '-EnableLocalLaunch requires an explicit -GamePath' }
if ($GamePath) {
  if (-not [IO.Path]::IsPathRooted($GamePath)) { throw '-GamePath must be an absolute path to the installed game executable' }
  $env:CLOUDPLAY_GAME_PATH=$GamePath
}
# Sync only P0 keys into .env.local. Preserve unrelated user settings and
# avoid leaving an older Lab token after reinitializing the local token file.
$envLocal=Join-Path $stateRoot '.env.local'
$required=[ordered]@{
  CLOUDPLAY_LAB_TOKEN=$token
  CLOUDPLAY_LAB_ENDPOINT='http://127.0.0.1:7788'
  P0_STREAM_URL='http://127.0.0.1:8080/'
  CLOUDPLAY_P0_UI_ENABLED='1'
}
$existing=@()
if (Test-Path -LiteralPath $envLocal) { $existing=@([IO.File]::ReadAllLines($envLocal)) }
$merged=New-Object System.Collections.Generic.List[string]
$seen=@{}
foreach ($line in $existing) {
  if ($line -match '^\s*(CLOUDPLAY_LAB_TOKEN|CLOUDPLAY_LAB_ENDPOINT|P0_STREAM_URL|CLOUDPLAY_P0_UI_ENABLED)\s*=') {
    $name=$Matches[1]
    if (-not $seen.ContainsKey($name)) { $merged.Add("$name=$($required[$name])"); $seen[$name]=$true }
  } else { $merged.Add($line) }
}
foreach ($name in $required.Keys) {
  if (-not $seen.ContainsKey($name)) { $merged.Add("$name=$($required[$name])") }
}
[IO.File]::WriteAllText($envLocal,($merged -join "`r`n")+"`r`n",([System.Text.UTF8Encoding]::new($false)))
Write-Host 'Synchronized private P0 lab settings in .env.local; preserved unrelated settings.'
# Prevent duplicate controllers or collisions with unrelated services.
$probe = New-Object System.Net.Sockets.TcpClient
try {
  $async = $probe.BeginConnect('127.0.0.1',7788,$null,$null)
  if ($async.AsyncWaitHandle.WaitOne(400)) {
    try { $probe.EndConnect($async); throw 'TCP 7788 is already in use; stop the existing P0 lab before starting a new one.' } catch [System.Net.Sockets.SocketException] {}
  }
} finally { $probe.Close() }
$coordinator = Start-Process -FilePath $node.Source -ArgumentList @('lab/coordinator.mjs') -WorkingDirectory $root -PassThru
Write-Host "P0 coordinator PID=$($coordinator.Id) at 127.0.0.1:7788"
# Fail closed if the coordinator process exits or a different local service is
# occupying the port. Starting a process is not proof it is serving our API.
$coordinatorReady=$false
for ($attempt=0; $attempt -lt 18; $attempt++) {
  try {
    $health=Invoke-RestMethod -Uri 'http://127.0.0.1:7788/health' -TimeoutSec 2
    if ($health.service -eq 'cloudplay-p0-lab' -and $health.status -eq 'running') {
      $coordinatorReady=$true
      break
    }
  } catch {}
  if ($coordinator.HasExited) { break }
  Start-Sleep -Milliseconds 300
}
if (-not $coordinatorReady) {
  if (-not $coordinator.HasExited) { Stop-Process -Id $coordinator.Id -ErrorAction SilentlyContinue }
  throw 'P0 coordinator did not pass localhost health check; Agent not started. Check Node.js process error output.'
}
Write-Host 'Coordinator /health verified on localhost (not a GPU or stream validation).'
Write-Host 'P0 session journal enabled to recover session identities after Coordinator restart.'
if (-not $SkipAgent) {
  $agent=Start-Process -FilePath $node.Source -ArgumentList @('lab/agent.mjs') -WorkingDirectory $root -PassThru
  Write-Host "P0 host agent PID=$($agent.Id)"
}
$pids=@{ coordinator=$coordinator.Id; agent=$(if ($SkipAgent) { $null } else { $agent.Id }) }
$pids | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stateRoot '.p0-lab-pids.json') -Encoding ASCII
Write-Host "Local game launching enabled: $EnableLocalLaunch (only SuperTuxKart executable from -GamePath; no remote command support)"
Write-Host 'To stop the lab safely: .\scripts\p0\stop-p0-lab.ps1'
Write-Host ''
Write-Host 'Next steps:'
Write-Host '  1. Sunshine admin: https://localhost:47990 (do not expose to public Internet)'
Write-Host '  2. Moonlight Web: http://localhost:8080 (requires own login and Sunshine pairing)'
Write-Host '  3. Start website in this project: npm install; npm run dev; browse http://localhost:3000/p0'
Write-Host '  4. Test real video + audio + controls and record evidence. A heartbeat alone is NOT a stream test.'
