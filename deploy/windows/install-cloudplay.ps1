#Requires -Version 5.1
<# Install or upgrade a verified CloudPlay OFFLINE Windows package.
   No Git/npm/Rust downloads. Keep runtime state in a separate persistent folder.
   Stop the currently running CloudPlay service before installing a newer slot.
#>
[CmdletBinding()]
param(
  [string]$InstallRoot='',
  [switch]$ShowStatus,
  [switch]$Rollback
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$candidate=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$node=Join-Path $candidate 'runtime\node.exe'
if(!(Test-Path -LiteralPath $node)){throw 'This is a source bundle, not a Windows offline release (node.exe missing). Build the Windows artifact first.'}
if(!$InstallRoot){$InstallRoot=Join-Path $env:LOCALAPPDATA 'CloudPlay'}
$InstallRoot=[IO.Path]::GetFullPath($InstallRoot)
$manager=Join-Path $candidate 'deploy\install-offline.mjs'
if(!(Test-Path $manager)){throw 'Offline release manager missing'}
if($ShowStatus){$args=@('status','--root',$InstallRoot)}
elseif($Rollback){$args=@('rollback','--root',$InstallRoot)}
else{$args=@('install','--root',$InstallRoot,'--candidate',$candidate)}
& $node $manager @args
if($LASTEXITCODE -ne 0){throw "CloudPlay installation operation failed (exit $LASTEXITCODE)"}
Write-Host "CloudPlay installation root: $InstallRoot"
Write-Host "Start: & `"$(Join-Path $InstallRoot 'start-active.ps1')`" -EnableLocalLaunch -GamePath 'C:\Games\SuperTuxKart\supertuxkart.exe'"
Write-Host "Stop:  & `"$(Join-Path $InstallRoot 'stop-active.ps1')`""
Write-Host 'Installation preserves persistent CloudPlay state; Sunshine and the actual game still require first-run setup and testing.'
