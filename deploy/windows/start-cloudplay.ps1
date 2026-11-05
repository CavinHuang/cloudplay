#Requires -Version 5.1
<# Offline single-Windows-host P0 operator launcher.
   A complete bundle contains Node runtime, Moonlight Web and optional Next Web.
   Sunshine and GPU drivers must already be installed; pairing is interactive.
   This launcher never downloads dependencies or opens firewall ports.
#>
[CmdletBinding()]
param(
  [string]$GamePath='',
  [switch]$EnableLocalLaunch,
  [switch]$SkipWeb
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$manifest=Join-Path $root 'manifest.json'
$node=Join-Path $root 'runtime\node.exe'
# Every mutable file lives OUTSIDE this versioned, checksummed release.
$stateRoot=if($env:CLOUDPLAY_STATE_DIR){[IO.Path]::GetFullPath($env:CLOUDPLAY_STATE_DIR)}else{Join-Path (Split-Path $root -Parent) 'CloudPlay-state'}
if($stateRoot -eq $root -or $stateRoot.StartsWith($root+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'State root cannot live inside verified release directory'}
if(!(Test-Path $node)){throw 'Missing bundled node.exe. This is not an offline release.'}
$verify=Join-Path $root 'deploy\verify-offline.mjs'
if(!(Test-Path $verify)){throw 'Missing release verifier'}
& $node $verify $root
if($LASTEXITCODE -ne 0){throw 'Offline release integrity check failed; no services started'}
$info=Get-Content $manifest -Raw | ConvertFrom-Json
New-Item -ItemType Directory -Force -Path $stateRoot | Out-Null
$env:CLOUDPLAY_STATE_DIR=$stateRoot
$game=Join-Path $root 'games\supertuxkart\supertuxkart.exe'
if(!$GamePath -and (Test-Path $game)){$GamePath=$game}
if($EnableLocalLaunch -and (!$GamePath -or !(Test-Path $GamePath))){throw 'Game executable missing. Specify -GamePath pointing to an installed, licensed SuperTuxKart.'}
if($EnableLocalLaunch -and [IO.Path]::GetFileName($GamePath) -ine 'supertuxkart.exe'){throw 'Local M1 launching only accepts the SuperTuxKart executable.'}
$existing=@(7788,8080)
if(!$SkipWeb -and $info.mode -eq 'windows-full'){$existing+=3000}
foreach($port in $existing){
  $tcp=New-Object Net.Sockets.TcpClient
  try {
    $a=$tcp.BeginConnect('127.0.0.1',$port,$null,$null)
    if($a.AsyncWaitHandle.WaitOne(300)){
      try{$tcp.EndConnect($a);throw "Port $port is already in use. Stop the existing CloudPlay services."}
      catch [Net.Sockets.SocketException]{}
    }
  } finally {$tcp.Close()}
}
# Limit Moonlight Web to local machine. No public WebRTC NAT configuration.
$env:BIND_ADDRESS='127.0.0.1:8080'
$moonSource=Join-Path $root 'services\moonlight'
$moon=Join-Path $moonSource 'web-server.exe'
$moonDir=Join-Path $stateRoot 'moonlight'
New-Item -ItemType Directory -Force -Path $moonDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $moonDir 'server') | Out-Null
# Moonlight stores server/data.json (account, pairing state) relative to its
# working directory. Keep that directory persistent and never touch it on upgrade.
# Its static assets must match the current executable; stage before switching.
$staticSource=Join-Path $moonSource 'static'
$staticTarget=Join-Path $moonDir 'static'
$staticStage=Join-Path $moonDir ('static-stage-'+[guid]::NewGuid().ToString('N'))
$staticBackup=Join-Path $moonDir ('static-backup-'+[guid]::NewGuid().ToString('N'))
try {
  Copy-Item -LiteralPath $staticSource -Destination $staticStage -Recurse -Force
  if(Test-Path $staticTarget){Move-Item -LiteralPath $staticTarget -Destination $staticBackup -ErrorAction Stop}
  try {Move-Item -LiteralPath $staticStage -Destination $staticTarget -ErrorAction Stop}
  catch {if(Test-Path $staticBackup){Move-Item -LiteralPath $staticBackup -Destination $staticTarget};throw}
}finally {
  if(Test-Path $staticStage){Remove-Item -LiteralPath $staticStage -Recurse -Force}
  if(Test-Path $staticBackup){Remove-Item -LiteralPath $staticBackup -Recurse -Force}
}
$logRoot=Join-Path $stateRoot 'logs'
New-Item -ItemType Directory -Force -Path $logRoot | Out-Null
$moonProc=Start-Process -FilePath $moon -WorkingDirectory $moonDir -PassThru -RedirectStandardOutput (Join-Path $logRoot 'moonlight.out.log') -RedirectStandardError (Join-Path $logRoot 'moonlight.err.log')
function Test-LocalPort([int]$port){
  $client=New-Object Net.Sockets.TcpClient
  try {$result=$client.BeginConnect('127.0.0.1',$port,$null,$null)
    if(!$result.AsyncWaitHandle.WaitOne(400)){return $false}
    try{$client.EndConnect($result);return $true}catch{return $false}
  }finally{$client.Close()}
}
$moonReady=$false
for($i=0;$i -lt 30;$i++){
  if($moonProc.HasExited){break}
  if(Test-LocalPort 8080){$moonReady=$true;break}
  Start-Sleep -Milliseconds 300
}
if(!$moonReady){if(!$moonProc.HasExited){Stop-Process -Id $moonProc.Id -ErrorAction SilentlyContinue};throw 'Moonlight Web did not open local port 8080. Check persistent state/logs/moonlight.err.log'}
$processList=@{moonlight=$moonProc.Id; web=$null}
try {
  # Keep the original Node-based P0 launcher intact and point its node lookup to our bundled runtime.
  $env:PATH=(Join-Path $root 'runtime')+[IO.Path]::PathSeparator+$env:PATH
  $p0=Join-Path $root 'services\p0'
  Push-Location $p0
  try {
    $launchArgs=@()
    if($EnableLocalLaunch){$launchArgs+='-EnableLocalLaunch';$launchArgs+='-GamePath';$launchArgs+=$GamePath}
    & (Join-Path $p0 'scripts\p0\start-p0-lab.ps1') @launchArgs
    if($LASTEXITCODE -and $LASTEXITCODE -ne 0){throw 'P0 launch failed'}
  } finally { Pop-Location }
  if(!$SkipWeb -and $info.mode -eq 'windows-full') {
    $webDir=Join-Path $root 'services\web'
    $env:NODE_ENV='production'
    $env:PORT='3000'
    $env:HOSTNAME='127.0.0.1'
    $env:CLOUDPLAY_P0_UI_ENABLED='0'  # production P0 lab APIs remain disabled
    # Explicit local-only operator bridge; browser never learns P0 auth token.
    $env:CLOUDPLAY_LOCAL_OPERATOR_ENABLED=$(if($EnableLocalLaunch){'1'}else{'0'})
    $webProc=Start-Process -FilePath $node -ArgumentList @('server.js') -WorkingDirectory $webDir -PassThru -RedirectStandardOutput (Join-Path $logRoot 'web.out.log') -RedirectStandardError (Join-Path $logRoot 'web.err.log')
    $processList.web=$webProc.Id
    $webReady=$false
    for($i=0;$i -lt 30;$i++){
      if($webProc.HasExited){break}
      try {
        $check=Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/v1/health' -TimeoutSec 2
        if($check){$webReady=$true;break}
      }catch{}
      Start-Sleep -Milliseconds 350
    }
    if(!$webReady){throw 'CloudPlay Next standalone did not pass local /api/v1/health check. Check persistent state/logs/web.err.log'}
  }
  $processList | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stateRoot 'service-pids.json')
  Write-Host 'CloudPlay local lab started. No downloads performed.'
  Write-Host 'Operator: http://127.0.0.1:7788/monitor'
  Write-Host 'Moonlight: http://127.0.0.1:8080/'
  if($processList.web){Write-Host 'Catalog: http://127.0.0.1:3000/ (production-safe, P0 APIs disabled)'}
  Write-Host 'To stop: .\deploy\stop-cloudplay.ps1'
} catch {
  if($processList.web){Stop-Process -Id $processList.web -ErrorAction SilentlyContinue}
  try{& (Join-Path $root 'services\p0\scripts\p0\stop-p0-lab.ps1')}catch{}
  Stop-Process -Id $moonProc.Id -ErrorAction SilentlyContinue
  throw
}
