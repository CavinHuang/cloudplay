#Requires -Version 5.1
<#
 CloudPlay M1 acceptance: exercise the actual installed start-active.ps1 and
 stop-active.ps1, NOT individual service helpers.
 This uses a real previously compiled Windows artifact, but no Sunshine/GPU/game.
 It cannot certify video/audio/input, actual GPU, or game lifecycle.
 No firewall changes, downloads, secrets in logs or internet-facing listeners.
#>
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$BundlePath)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$source=(Resolve-Path -LiteralPath $BundlePath).Path
$node=Join-Path $source 'runtime\node.exe'
$manager=Join-Path $source 'deploy\install-offline.mjs'
$verifier=Join-Path $source 'deploy\verify-offline.mjs'
foreach($entry in @($node,$manager,$verifier)){
  if(!(Test-Path -LiteralPath $entry -PathType Leaf)){throw "Required offline component missing: $entry"}
}
$tempBase=if($env:RUNNER_TEMP){$env:RUNNER_TEMP}else{$env:TEMP}
$workspace=Join-Path $tempBase ('cloudplay-installed-runtime-'+[guid]::NewGuid().ToString('N'))
$root=Join-Path $workspace 'CloudPlay'
$oldPath=$env:PATH
$oldState=$env:CLOUDPLAY_STATE_DIR
$oldLaunch=$env:CLOUDPLAY_ENABLE_LOCAL_LAUNCH
$success=$false
function Wait-Web([string]$Url,[string]$Needle,[bool]$Alive){
  for($i=0;$i -lt 65;$i++){
    try{
      $reply=Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 2
      if([int]$reply.StatusCode -eq 200 -and [string]$reply.Content -match $Needle){return}
    }catch{}
    Start-Sleep -Milliseconds 250
  }
  throw "Installed runtime readiness failed: $Url"
}
function Check-Status {
  $raw=(& $node $manager status --root $root | Out-String)
  if($LASTEXITCODE -ne 0){throw 'Installed slot integrity/status verification failed'}
  return ($raw | ConvertFrom-Json)
}
function Assert-PortBound([int]$Port){
  $listeners=@(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop)
  if(!$listeners.Count -or @($listeners | Where-Object {$_.LocalAddress -notin @('127.0.0.1','::1')}).Count){
    throw "Installed service port $Port is not exclusively loopback"
  }
}
function Assert-PortClosed([int]$Port){
  for($i=0;$i -lt 65;$i++){
    $live=@(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    if(!$live.Count){return}
    Start-Sleep -Milliseconds 250
  }
  throw "Installed service port $Port remained listening after stop"
}
function Start-Installed {
  # PowerShell functions return all success-stream output; route launcher logs to
  # the host, otherwise tokenA includes first-start 'Generated token' text.
  & (Join-Path $root 'start-active.ps1') | Out-Host

  foreach($p in @(7788,8080,3000)){Assert-PortBound $p}
  Wait-Web 'http://127.0.0.1:7788/health' 'cloudplay-p0-lab' $true
  Wait-Web 'http://127.0.0.1:8080/config.js' '__CONFIG_JS__' $true
  Wait-Web 'http://127.0.0.1:3000/api/v1/health' '"status":"ok"' $true
  $state=Join-Path $root 'state'
  foreach($f in @('service-pids.json','.p0-lab-pids.json','.p0-lab-token')){
    if(!(Test-Path -LiteralPath (Join-Path $state $f) -PathType Leaf)){throw "Installed runtime missing $f"}
  }
  $token=[IO.File]::ReadAllText((Join-Path $state '.p0-lab-token')).Trim()
  if($token.Length -lt 32){throw 'Installed P0 authentication token missing'}
  $hostsOk=$false
  for($i=0;$i -lt 45;$i++){
    try{
      $status=Invoke-RestMethod -Uri 'http://127.0.0.1:7788/internal/status' -TimeoutSec 2 -Headers @{Authorization=('Bearer '+$token)}
      if($status.connected -eq $true -and @($status.hosts).Count){$hostsOk=$true;break}
    }catch{}
    Start-Sleep -Milliseconds 250
  }
  if(!$hostsOk){throw 'Agent did not heartbeat through installed runtime'}
  if($status.localLaunchEnabled -ne $false -or $status.streamVerified -ne $false){
    throw 'No-GPU installation incorrectly enabled launching or marked stream verified'
  }
  return $token
}
function Stop-Installed {
  & (Join-Path $root 'stop-active.ps1')

  foreach($p in @(7788,8080,3000)){Assert-PortClosed $p}
  foreach($f in @('service-pids.json','.p0-lab-pids.json')){
    if(Test-Path -LiteralPath (Join-Path $root ('state\'+$f))){throw "Installer left a live-service PID marker: $f"}
  }
}
try {
  New-Item -ItemType Directory -Path $workspace -Force | Out-Null
  # Temporarily remove the CI runner's global Node/Rust/MinGW tools.
  $env:PATH="$env:SystemRoot\System32;$env:SystemRoot;$env:SystemRoot\System32\Wbem"
  & $node $verifier $source
  if($LASTEXITCODE -ne 0){throw 'Offline artifact integrity verification failed'}
  & $node $manager install --root $root --candidate $source
  if($LASTEXITCODE -ne 0){throw 'Fresh offline installation failed'}
  $installed=Check-Status
  if(!$installed.installed -or $installed.previous){throw 'Unexpected installed release pointer'}
  $active=$installed.active
  foreach($entry in @('start-active.ps1','stop-active.ps1','state','active.json')){
    if(!(Test-Path -LiteralPath (Join-Path $root $entry))){throw "Installed entry missing: $entry"}
  }
  $tokenA=Start-Installed
  $during=Check-Status
  if(!$during.servicesPidFilePresent){throw 'Installer did not recognize running services'}
  Stop-Installed
  $stopped=Check-Status
  if($stopped.servicesPidFilePresent){throw 'Installer still detects service PID marker after stop'}
  if($stopped.active -ne $active){throw 'Stop changed active release slot'}
  $tokenB=Start-Installed
  if($tokenA -ne $tokenB){throw 'Restart destroyed persistent authentication token'}
  Stop-Installed
  # A start/stop must never mutate the immutable release files.
  & $node $verifier (Join-Path (Join-Path $root 'releases') $active)
  if($LASTEXITCODE -ne 0){throw 'Installed release checksum changed after runtime cycle'}
  Write-Host 'PASS: actual installed entrypoints start/stop twice, Moonlight HTTP + P0 authenticated heartbeat + Next health, loopback ports, persistent token and unmodified release.'
  Write-Host 'NOT CHECKED: Sunshine, GPU, game process, video, audio or controller.'
  $success=$true
} finally {
  $env:PATH=$oldPath
  $env:CLOUDPLAY_STATE_DIR=$oldState
  $env:CLOUDPLAY_ENABLE_LOCAL_LAUNCH=$oldLaunch
  if(!$success){
    Write-Warning 'Installed runtime smoke failed; attempting safe service cleanup.'
    try{& (Join-Path $root 'stop-active.ps1')}catch{Write-Warning 'Cleanup could not confirm all installed services stopped.'}
  }
  if($success){Remove-Item -LiteralPath $workspace -Recurse -Force -ErrorAction SilentlyContinue}
}
