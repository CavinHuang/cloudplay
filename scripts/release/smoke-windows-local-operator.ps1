#Requires -Version 5.1
<#
  Negative M1 localhost API contract on a clean Windows runner.
  Installs and starts REAL bundled Windows services with local launch explicitly
  enabled, but it NEVER starts a game: CI has no GPU/Sunshine. A harmless, empty
  placeholder file is only used for the installer's GamePath existence check.
  Tests that browser API fails closed for unsafe origins, no GPU and disabled mode.
#>
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$BundlePath)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$bundle=(Resolve-Path -LiteralPath $BundlePath).Path
$node=Join-Path $bundle 'runtime\node.exe'
$manager=Join-Path $bundle 'deploy\install-offline.mjs'
$workspace=Join-Path $env:TEMP ('cloudplay-local-operator-'+[guid]::NewGuid().ToString('N'))
$root=Join-Path $workspace 'installed'
$fixture=Join-Path $workspace 'supertuxkart.exe'
$oldPath=$env:PATH
$oldState=$env:CLOUDPLAY_STATE_DIR
$oldGame=$env:CLOUDPLAY_GAME_PATH
$oldLaunch=$env:CLOUDPLAY_ENABLE_LOCAL_LAUNCH
$oldOperator=$env:CLOUDPLAY_LOCAL_OPERATOR_ENABLED
$passed=$false
function Status-Request([string]$Path,[string]$Method='GET',[string]$Origin='',
 [string]$Action='',[string]$Json=''){
  $headers=@{}
  if($Origin){$headers.Origin=$Origin}
  if($Action){$headers['X-CloudPlay-Local-Action']=$Action}
  $options=@{Uri=('http://127.0.0.1:3000'+$Path);Method=$Method;
    Headers=$headers;UseBasicParsing=$true;TimeoutSec=4;ErrorAction='Stop'}
  if($Method -ne 'GET'){$options.ContentType='application/json';$options.Body=$Json}
  try {
    $r=Invoke-WebRequest @options
    return [int]$r.StatusCode
  }catch{
    if($_.Exception.Response){return [int]$_.Exception.Response.StatusCode}
    throw
  }
}
function Verify-Status($actual,$expected,[string]$reason){
 if([int]$actual -ne [int]$expected){throw "$reason, received HTTP $actual but expected $expected"}
}
function Wait-Server {
  for($i=0;$i -lt 55;$i++){
    try{$r=Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/v1/health' -TimeoutSec 2
      if($r.status -eq 'ok'){return}
    }catch{}
    Start-Sleep -Milliseconds 300
  }
  throw 'Local Next server did not become healthy'
}
function Stop-Installed {
  & (Join-Path $root 'stop-active.ps1') | Out-Host
}
try {
  New-Item -ItemType Directory -Path $workspace -Force | Out-Null
  # Empty path marker MUST NEVER be executed. The separate no-GPU check below
  # prevents a launch command from being submitted to the host agent.
  [IO.File]::WriteAllBytes($fixture,[byte[]]@())
  $env:PATH="$env:SystemRoot\System32;$env:SystemRoot;$env:SystemRoot\System32\Wbem"
  & $node $manager install --root $root --candidate $bundle | Out-Host
  if($LASTEXITCODE -ne 0){throw 'Offline installation failed'}
  & (Join-Path $root 'start-active.ps1') -EnableLocalLaunch -GamePath $fixture | Out-Host
  Wait-Server

  $enabled=$null
  for($i=0;$i -lt 45;$i++){
    try {
      $enabled=Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/v1/local/status' -TimeoutSec 2
      if(@($enabled.hosts).Count -gt 0){break}
    }catch{}
    Start-Sleep -Milliseconds 250
  }
  if(!$enabled -or $enabled.localLaunchEnabled -ne $true){
    throw 'Operator status unavailable despite explicit local launch flag'
  }
  if(@($enabled.hosts | Where-Object {$_.infrastructureReady -eq $true}).Count -gt 0){
    throw 'Expected a GPU-less CI runner; refusing to execute test game'
  }
  $path='/api/v1/local/sessions'
  $json='{"gameId":"supertuxkart"}'
  Verify-Status (Status-Request '/api/v1/local/status') 200 'Local status'
  Verify-Status (Status-Request $path 'POST' '' '1' $json) 403 'Missing Origin denied'
  Verify-Status (Status-Request $path 'POST' 'http://evil.example:3000' '1' $json) 403 'Cross-origin denied'
  Verify-Status (Status-Request $path 'POST' 'http://127.0.0.1:3000' '' $json) 403 'Missing local action header denied'
  Verify-Status (Status-Request $path 'POST' 'http://127.0.0.1:3000' '1' '{"gameId":"other"}') 422 'Game allowlist'
  Verify-Status (Status-Request $path 'POST' 'http://127.0.0.1:3000' '1' $json) 409 'No-GPU launch refused'
  Verify-Status (Status-Request '/api/v1/p0/status') 404 'P0 debug API disabled in production'

  # The installed M1 entrypoint must work without any global Node/npm/Rust.
  # A GPU-less CI host may initialize a REAL evidence index, but never
  # manufacture a frame, screenshot or success witness.
  $evidence=Join-Path $workspace 'm1-evidence'
  & (Join-Path $root 'm1-accept.ps1') -Action Prepare -GamePath $fixture -EvidenceDir $evidence | Out-Host
  $index=Join-Path $evidence 'm1-index.json'
  $firstReport=Join-Path $evidence 'host-preflight.json'
  if(!(Test-Path -LiteralPath $index) -or !(Test-Path -LiteralPath $firstReport)){
    throw 'M1 installed acceptance failed to create index and real host preflight'
  }
  $pre=Get-Content -LiteralPath $firstReport -Raw | ConvertFrom-Json
  if($pre.ready -ne $false -or $pre.checks.nvidiaGpuDetected -ne $false){
    throw 'GPU-less M1 preflight incorrectly reported ready'
  }
  & (Join-Path $root 'm1-accept.ps1') -Action Check -GamePath $fixture -EvidenceDir $evidence | Out-Host
  if(!(Test-Path -LiteralPath (Join-Path $evidence 'host-check-latest.json'))){
    throw 'M1 Check did not write a separate current host snapshot'
  }
  $reviewRejected=$false
  try{
    & (Join-Path $root 'm1-accept.ps1') -Action Review -EvidenceDir $evidence | Out-Host
  }catch{$reviewRejected=$true}
  if(!$reviewRejected){throw 'M1 Review accepted missing real GPU sessions'}
  $summaryPath=Join-Path $evidence 'review-result.json'
  if(!(Test-Path -LiteralPath $summaryPath)){throw 'M1 Review did not persist its safe failure summary'}
  $summaryRaw=Get-Content -LiteralPath $summaryPath -Raw
  $summary=$summaryRaw | ConvertFrom-Json
  if($summary.readyForIndependentReview -ne $false -or @($summary.failures).Count -eq 0){
    throw 'M1 Review failed to identify absent media/screenshot/witness evidence'
  }
  $authToken=[IO.File]::ReadAllText((Join-Path $root 'state\.p0-lab-token')).Trim()
  if($summaryRaw.Contains($authToken)){throw 'M1 review summary leaked local credential'}
  Write-Host 'PASS: M1 installed Prepare/Check/Review, no-GPU refusal, immutable first preflight and no fabricated evidence.'
  Stop-Installed
  & (Join-Path $root 'start-active.ps1') | Out-Host
  Wait-Server
  Verify-Status (Status-Request '/api/v1/local/status') 404 'Operator disabled by default'
  Verify-Status (Status-Request $path 'POST' 'http://127.0.0.1:3000' '1' $json) 404 'Local game API disabled by default'
  Stop-Installed
  $passed=$true
  Write-Host 'PASS: real installed Next local operator, CSRF origin guard, game allowlist, no-GPU rejection and default-off mode.'
  Write-Host 'NOT CHECKED: actual GPU/game execution, Sunshine pairing, decoded video/audio or controller.'
}finally{
  $env:PATH=$oldPath
  $env:CLOUDPLAY_STATE_DIR=$oldState
  $env:CLOUDPLAY_GAME_PATH=$oldGame
  $env:CLOUDPLAY_ENABLE_LOCAL_LAUNCH=$oldLaunch
  $env:CLOUDPLAY_LOCAL_OPERATOR_ENABLED=$oldOperator
  if(!$passed){
    Write-Warning 'Local operator contract failed; attempting safe shutdown.'
    try{Stop-Installed}catch{}
  }
  if($passed){Remove-Item -LiteralPath $workspace -Recurse -Force -ErrorAction SilentlyContinue}
}
