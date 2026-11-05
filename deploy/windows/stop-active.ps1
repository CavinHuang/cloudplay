#Requires -Version 5.1
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$installRoot=(Resolve-Path $PSScriptRoot).Path
$ptr=Get-Content (Join-Path $installRoot 'active.json') -Raw | ConvertFrom-Json
if($ptr.schema -ne 'cloudplay.slots.v1' -or $ptr.active -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{1,100}$'){throw 'Invalid active slot configuration'}
$release=Join-Path (Join-Path $installRoot 'releases') $ptr.active
$env:CLOUDPLAY_STATE_DIR=Join-Path $installRoot 'state'
& (Join-Path $release 'deploy\stop-cloudplay.ps1')
# Child PowerShell scripts throw on actual failures. $LASTEXITCODE is process-global
# and can be stale after a caught, expected Node evidence-validation failure.
# Do not turn a successful PowerShell start/stop into a false failure.
$global:LASTEXITCODE=0
