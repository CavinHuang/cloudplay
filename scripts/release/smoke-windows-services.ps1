#Requires -Version 5.1
<#
 Live no-GPU Windows smoke. Starts the *real* bundled Moonlight HTTP service,
 Node coordinator, host agent and optional Next.js, with no global dev tools.
 It deliberately cannot launch games or declare video/audio/input verified.
#>
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$BundlePath,[switch]$SkipWeb)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$root=(Resolve-Path -LiteralPath $BundlePath).Path
$node=Join-Path $root 'runtime\node.exe'
$moon=Join-Path $root 'services\moonlight\web-server.exe'
$p0=Join-Path $root 'services\p0'
$web=Join-Path $root 'services\web'
$verify=Join-Path $root 'deploy\verify-offline.mjs'
foreach($f in @($node,$moon,$verify,(Join-Path $p0 'lab\coordinator.mjs'),(Join-Path $p0 'lab\agent.mjs'))){
  if(!(Test-Path -LiteralPath $f -PathType Leaf)){throw "Incomplete offline bundle: $f"}
}
$original=@{}
foreach($key in @('PATH','CLOUDPLAY_LAB_TOKEN','CLOUDPLAY_LAB_ENDPOINT','CLOUDPLAY_LAB_PORT','CLOUDPLAY_ENABLE_LOCAL_LAUNCH','CLOUDPLAY_GAME_PATH','P0_SESSION_JOURNAL','P0_STREAM_URL','BIND_ADDRESS','NODE_ENV','PORT','HOSTNAME')){
  $original[$key]=[Environment]::GetEnvironmentVariable($key,'Process')
}
$tempBase=if($env:RUNNER_TEMP){$env:RUNNER_TEMP}else{$env:TEMP}
$work=Join-Path $tempBase ('cloudplay-live-services-'+[guid]::NewGuid().ToString('N'))
$processes=[System.Collections.Generic.List[object]]::new()
$passed=$false
function Start-Owned([string]$Exe,[string[]]$Args,[string]$Cwd,[string]$Name){
  $out=Join-Path $work ($Name+'.out.log')
  $err=Join-Path $work ($Name+'.err.log')
  $start=@{FilePath=$Exe;WorkingDirectory=$Cwd;PassThru=$true;RedirectStandardOutput=$out;RedirectStandardError=$err}
  if($Args.Count -gt 0){$start.ArgumentList=$Args}
  $proc=Start-Process @start
  $processes.Add($proc)
  return $proc
}
function Wait-Http([string]$Url,[string]$Expected){
  for($i=0;$i -lt 55;$i++){
    try {
      $resp=Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
      if([int]$resp.StatusCode -eq 200 -and [string]$resp.Content -match $Expected){return $resp}
    }catch{}
    Start-Sleep -Milliseconds 300
  }
  throw "Expected local HTTP service never became healthy: $Url"
}
try{
  New-Item -ItemType Directory -Path $work -Force | Out-Null
  # The bundle contains all executables and Node modules. Only Windows OS APIs remain.
  $env:PATH="$env:SystemRoot\System32;$env:SystemRoot;$env:SystemRoot\System32\Wbem"
  & $node $verify $root
  if($LASTEXITCODE -ne 0){throw 'Bundled release integrity verification failed'}
  $moonDir=Join-Path $work 'moonlight'
  New-Item -ItemType Directory -Path (Join-Path $moonDir 'server') -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $root 'services\moonlight\static') -Destination (Join-Path $moonDir 'static') -Recurse
  $env:BIND_ADDRESS='127.0.0.1:8080'
  $moonProc=Start-Owned -Exe $moon -Args @() -Cwd $moonDir -Name 'moonlight'
  Wait-Http 'http://127.0.0.1:8080/config.js' '__CONFIG_JS__' | Out-Null
  Wait-Http 'http://127.0.0.1:8080/' '<!doctype html|<html' | Out-Null

  $tokenBytes=New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($tokenBytes)
  $env:CLOUDPLAY_LAB_TOKEN=([BitConverter]::ToString($tokenBytes)).Replace('-','')
  $env:CLOUDPLAY_LAB_ENDPOINT='http://127.0.0.1:7788'
  $env:CLOUDPLAY_LAB_PORT='7788'
  $env:CLOUDPLAY_ENABLE_LOCAL_LAUNCH='0'
  $env:CLOUDPLAY_GAME_PATH=$null
  $env:P0_STREAM_URL='http://127.0.0.1:8080/'
  $env:P0_SESSION_JOURNAL=Join-Path $work 'journal.json'
  $coordinator=Start-Owned -Exe $node -Args @('lab/coordinator.mjs') -Cwd $p0 -Name 'coordinator'
  Wait-Http 'http://127.0.0.1:7788/health' 'cloudplay-p0-lab' | Out-Null
  Wait-Http 'http://127.0.0.1:7788/monitor' 'html' | Out-Null
  $agent=Start-Owned -Exe $node -Args @('lab/agent.mjs') -Cwd $p0 -Name 'agent'
  $hostSeen=$false
  for($i=0;$i -lt 55;$i++){
    try{
      $status=Invoke-RestMethod -Uri 'http://127.0.0.1:7788/internal/status' -Headers @{Authorization=('Bearer '+$env:CLOUDPLAY_LAB_TOKEN)} -TimeoutSec 2
      if($status.connected -eq $true -and @($status.hosts).Count -gt 0){$hostSeen=$true;break}
    }catch{}
    Start-Sleep -Milliseconds 300
  }
  if(!$hostSeen){throw 'Actual host agent heartbeat was never accepted by coordinator'}
  if($status.streamVerified -ne $false -or $status.localLaunchEnabled -ne $false){
    throw 'No-GPU lab incorrectly claimed verified stream or allowed game launch'
  }
  $unauthorized=$false
  try{
    Invoke-WebRequest -Uri 'http://127.0.0.1:7788/internal/status' -UseBasicParsing -TimeoutSec 2 | Out-Null
  }catch{
    if([int]$_.Exception.Response.StatusCode -eq 401){$unauthorized=$true}
  }
  if(!$unauthorized){throw 'Coordinator private status endpoint must reject anonymous requests'}

  if(!$SkipWeb -and (Test-Path -LiteralPath (Join-Path $web 'server.js'))){
    $env:NODE_ENV='production';$env:PORT='3000';$env:HOSTNAME='127.0.0.1'
    $webProc=Start-Owned -Exe $node -Args @('server.js') -Cwd $web -Name 'web'
    Wait-Http 'http://127.0.0.1:3000/api/v1/health' '"status":"ok"' | Out-Null
  }
  $ports=if($SkipWeb){@(7788,8080)}else{@(7788,8080,3000)}
  foreach($port in $ports){
    $listeners=@(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction Stop)
    if(!$listeners.Count -or @($listeners|Where-Object {$_.LocalAddress -notin @('127.0.0.1','::1')}).Count){
      throw "Service TCP $port is not bound to loopback only"
    }
  }
  Write-Host 'PASS: real Moonlight HTTP/static, P0 Coordinator authentication and Agent heartbeat, optional Next health; all bound loopback.'
  Write-Host 'NOT CHECKED: GPU encoding, Sunshine PIN pairing, rendered game frames, audible sound or keyboard/controller input.'
  $passed=$true
} finally {
  foreach($proc in $processes){
    try{if(!$proc.HasExited){Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue}}catch{}
  }
  foreach($key in $original.Keys){[Environment]::SetEnvironmentVariable($key,$original[$key],'Process')}
  if($passed){Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue}
  else{Write-Warning 'Service smoke failed; private process logs were retained locally. Do not upload them publicly.'}
}
