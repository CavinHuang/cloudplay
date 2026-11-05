#Requires -Version 5.1
<#
CloudPlay M1 Windows GPU preflight. No installer actions, firewall edits, remote
connections, streaming starts, Sunshine credentials or tokens in output.
Every check is a simple boolean, NOT proof of real gameplay or PIN pairing.
Offline release: .\services\p0\scripts\p0\m1-host-preflight.ps1
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$GamePath,
  [Parameter(Mandatory=$true)][string]$OutFile,
  [string]$StateRoot='',
  [switch]$ReportOnly
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if(!$StateRoot){
  $StateRoot=if($env:CLOUDPLAY_STATE_DIR){$env:CLOUDPLAY_STATE_DIR}else{Join-Path $env:LOCALAPPDATA 'CloudPlay\state'}
}
$checks=[ordered]@{
  nvidiaGpuDetected=$false
  sunshineProcess=$false
  sunshineListening=$false
  moonlightListening=$false
  coordinatorListening=$false
  agentHeartbeat=$false
  gameFilePresent=$false
  webHealthy=$false
  debugApiLoopbackOnly=$false
  localLaunchEnabled=$false
}
function Test-LocalTcp([int]$Port) {
  $client=New-Object System.Net.Sockets.TcpClient
  try {
    $connect=$client.BeginConnect('127.0.0.1',$Port,$null,$null)
    if(!$connect.AsyncWaitHandle.WaitOne(650)){return $false}
    try{$client.EndConnect($connect);return $true}catch{return $false}
  }finally{$client.Close()}
}
function Test-NvidiaDriver {
  $command=Get-Command 'nvidia-smi.exe' -ErrorAction SilentlyContinue
  $exePath=if($command){[string]$command.Source}else{Join-Path $env:ProgramFiles 'NVIDIA Corporation\NVSMI\nvidia-smi.exe'}
  if(!(Test-Path -LiteralPath $exePath)){return $false}
  try {
    $result=(& $exePath -L 2>$null | Out-String)
    return ($LASTEXITCODE -eq 0 -and $result -match 'GPU\s+\d+:')
  }catch{return $false}
}
$checks.nvidiaGpuDetected=Test-NvidiaDriver
$checks.sunshineProcess=(@(Get-Process -Name 'sunshine' -ErrorAction SilentlyContinue).Count -gt 0)
$checks.sunshineListening=Test-LocalTcp 47990
$checks.moonlightListening=Test-LocalTcp 8080
$checks.coordinatorListening=Test-LocalTcp 7788
$checks.gameFilePresent=([IO.Path]::IsPathRooted($GamePath) -and (Test-Path -LiteralPath $GamePath -PathType Leaf))
# A debug coordinator is local-only. Unknown/inaccessible listener data is not a pass.
try {
  $bound=@(Get-NetTCPConnection -LocalPort 7788 -State Listen -ErrorAction Stop)
  $checks.debugApiLoopbackOnly=($bound.Count -gt 0 -and @($bound|Where-Object {$_.LocalAddress -notin @('127.0.0.1','::1')}).Count -eq 0)
}catch{$checks.debugApiLoopbackOnly=$false}
try {
  $reply=Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/v1/health' -TimeoutSec 2
  $checks.webHealthy=($reply.status -eq 'ok')
}catch{}
# The local token stays only in this PowerShell process. Never write it to JSON,
# stderr, logs, command-line arguments, or an upload artifact.
try {
  $tokenFile=Join-Path $StateRoot '.p0-lab-token'
  if(Test-Path -LiteralPath $tokenFile -PathType Leaf){
    $token=[IO.File]::ReadAllText($tokenFile).Trim()
    if($token.Length -ge 32){
      $status=Invoke-RestMethod -Uri 'http://127.0.0.1:7788/internal/status' -Headers @{Authorization=('Bearer '+$token)} -TimeoutSec 3
      $checks.localLaunchEnabled=($status.localLaunchEnabled -eq $true)
      $checks.agentHeartbeat=(@($status.hosts|Where-Object {$_.infrastructureReady -eq $true}).Count -gt 0)
    }
    $token=$null
  }
}catch{}
# No GPU or host-identifying details, paths, network peers, account IDs or
# session data are written to the output. This is a bounded safe-to-share report.
$ready=(@($checks.Values|Where-Object {$_ -ne $true}).Count -eq 0)
$report=[ordered]@{
  kind='cloudplay-m1-host-preflight'
  schemaVersion=1
  observedAt=([DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ'))
  checks=$checks
  ready=$ready
  note='Local self-reported infrastructure checks only; NOT proof of Sunshine pairing, visible gameplay, audio or input.'
}
$folder=[IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($OutFile))
New-Item -ItemType Directory -Force -Path $folder|Out-Null
[IO.File]::WriteAllText([IO.Path]::GetFullPath($OutFile),(($report|ConvertTo-Json -Depth 5)+"`n"),[Text.UTF8Encoding]::new($false))
if($ready){Write-Host 'M1 host preflight READY (infrastructure only, not playable proof).'}
else{Write-Warning ('M1 host preflight INCOMPLETE. Failed checks: '+(@($checks.Keys|Where-Object {!$checks[$_]}) -join ', '))}
Write-Host 'Saved boolean-only host report; no local credentials or host addresses were exported.'
if(!$ready -and !$ReportOnly){exit 1}
