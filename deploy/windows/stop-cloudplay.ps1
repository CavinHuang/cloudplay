#Requires -Version 5.1
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Continue'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$stateRoot=if($env:CLOUDPLAY_STATE_DIR){[IO.Path]::GetFullPath($env:CLOUDPLAY_STATE_DIR)}else{Join-Path (Split-Path $root -Parent) 'CloudPlay-state'}
$env:CLOUDPLAY_STATE_DIR=$stateRoot
$p0=Join-Path $root 'services\p0\scripts\p0\stop-p0-lab.ps1'
if(Test-Path $p0){& $p0}
$pidsFile=Join-Path $stateRoot 'service-pids.json'
if(Test-Path $pidsFile){
  $list=Get-Content $pidsFile -Raw | ConvertFrom-Json
  foreach($name in @('web','moonlight')) {
    if($list.$name) {
      $proc=Get-Process -Id $list.$name -ErrorAction SilentlyContinue
      if($proc){
        $detail=Get-CimInstance Win32_Process -Filter "ProcessId=$($proc.Id)" -ErrorAction SilentlyContinue
        $expected=$(if($name -eq 'web'){'node.exe'}else{'web-server.exe'})
        if(!$detail){Write-Warning "Cannot inspect PID $($proc.Id) safely; skipping";continue}
        $line=[string]$detail.CommandLine
        $bin=[string]$detail.ExecutablePath
        if($bin.ToLowerInvariant().StartsWith($root.ToLowerInvariant()+'\') -and [IO.Path]::GetFileName($bin) -ieq $expected){
          if($name -ne 'web' -or $line -match 'server\.js') {Stop-Process -Id $proc.Id -ErrorAction SilentlyContinue}
        } else {Write-Warning "Refusing to stop unrelated PID $($proc.Id)"}
      }
    }
  }
  Remove-Item $pidsFile -ErrorAction SilentlyContinue
}
Write-Host 'CloudPlay services stopped (inspect Moonlight logs if game stream was active).'
