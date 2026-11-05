#Requires -Version 5.1
# Regression: stopping an idle P0 with no sessions and host.activeGame=null must
# not dereference null, kill unrelated processes, or leave a PID marker.
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$fixture=Join-Path $root 'tests\fixtures\m1-idle-coordinator.mjs'
$state=Join-Path $env:RUNNER_TEMP ('cloudplay-idle-stop-'+[guid]::NewGuid().ToString('N'))
$oldState=$env:CLOUDPLAY_STATE_DIR
$oldToken=$env:CLOUDPLAY_IDLE_STOP_TEST_TOKEN
$server=$null
$passed=$false
try{
 New-Item -ItemType Directory -Path $state -Force | Out-Null
 $bytes=New-Object byte[] 32
 [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
 $token=([BitConverter]::ToString($bytes)).Replace('-','')
 $env:CLOUDPLAY_IDLE_STOP_TEST_TOKEN=$token
 $env:CLOUDPLAY_STATE_DIR=$state
 [IO.File]::WriteAllText((Join-Path $state '.p0-lab-token'),$token)
 [IO.File]::WriteAllText((Join-Path $state '.p0-lab-pids.json'),'{"coordinator":null,"agent":null}')
 $server=Start-Process -FilePath (Get-Command node).Source -ArgumentList @($fixture) -PassThru -WindowStyle Hidden
 $ready=$false
 for($i=0;$i -lt 40;$i++){
   try {$r=Invoke-RestMethod -Uri 'http://127.0.0.1:7788/health' -TimeoutSec 2
      if($r.ok -eq $true){$ready=$true;break}}catch{}
   Start-Sleep -Milliseconds 200
 }
 if(!$ready){throw 'CI idle coordinator fixture did not start'}
 & (Join-Path $root 'scripts\p0\stop-p0-lab.ps1')
 if($LASTEXITCODE -and $LASTEXITCODE -ne 0){throw 'Idle lab stopped with nonzero exit'}
 if(Test-Path -LiteralPath (Join-Path $state '.p0-lab-pids.json')){throw 'Idle stop left stale PID marker'}
 if($server.HasExited){throw 'Idle stop killed an unrelated coordinator fixture'}
 Write-Host 'PASS: PowerShell P0 stop safely handles zero sessions and null active game, does not touch unrelated process.'
 $passed=$true
} finally {
 if($server -and !$server.HasExited){Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue}
 $env:CLOUDPLAY_STATE_DIR=$oldState
 $env:CLOUDPLAY_IDLE_STOP_TEST_TOKEN=$oldToken
 if($passed){Remove-Item -LiteralPath $state -Recurse -Force -ErrorAction SilentlyContinue}
}
