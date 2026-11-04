#Requires -Version 5.1
<#
 Windows acceptance of the real offline slot installer, using an actual CI artifact.
 Test-only second version differs only in the root unsigned manifest version.
 This is install/upgrade/rollback and tamper checking, NOT an authenticity or GPU test.
#>
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$BundlePath)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$PSNativeCommandUseErrorActionPreference=$false
$source=(Resolve-Path -LiteralPath $BundlePath).Path
$node=Join-Path $source 'runtime\node.exe'
$manager=Join-Path $source 'deploy\install-offline.mjs'
$verifier=Join-Path $source 'deploy\verify-offline.mjs'
foreach($f in @($node,$manager,$verifier)){
  if(!(Test-Path -LiteralPath $f -PathType Leaf)){throw "Offline bundle missing: $f"}
}
$workspace=Join-Path $env:TEMP ('cloudplay-slot-smoke-'+[guid]::NewGuid().ToString('N'))
$root=Join-Path $workspace 'installed'
$candidateB=Join-Path $workspace 'test-candidate-B'
$originalPath=$env:PATH
function Checked([string[]]$Invocation){
  & $node @Invocation
  if($LASTEXITCODE -ne 0){throw "Offline operation failed ($LASTEXITCODE): $($Invocation -join ' ')"}
}
function Get-SlotStatus {
  $raw=(& $node $manager 'status' '--root' $root | Out-String)
  if($LASTEXITCODE -ne 0){throw 'Slot status operation failed'}
  return ($raw | ConvertFrom-Json)
}
function Same($actual,$expected,[string]$reason){
  if($actual -ne $expected){throw "${reason}: got [$actual], expected [$expected]"}
}
function Rejected([string[]]$Invocation,[string]$reason){
  & $node @Invocation 2>$null | Out-Null
  if($LASTEXITCODE -eq 0){throw "Unsafe operation succeeded: $reason"}
}
$passed=$false
try {
  New-Item -ItemType Directory -Path $workspace -Force | Out-Null
  # A clean deployment has no global node, npm, cargo, rustc or gcc.
  $env:PATH="$env:SystemRoot\System32;$env:SystemRoot;$env:SystemRoot\System32\Wbem"
  Checked @($verifier,$source)
  Checked @($manager,'install','--root',$root,'--candidate',$source)
  $s=Get-SlotStatus
  if(!$s.installed -or $s.previous){throw 'Invalid fresh install pointer'}
  $slotA=[string]$s.active
  foreach($f in @('active.json','start-active.ps1','stop-active.ps1')){
    if(!(Test-Path -LiteralPath (Join-Path $root $f))){throw "Installer entrypoint missing: $f"}
  }
  $state=Join-Path $root 'state'
  $pairing=Join-Path $state 'moonlight\server\data.json'
  New-Item -ItemType Directory -Path (Split-Path $pairing -Parent) -Force | Out-Null
  Set-Content -LiteralPath $pairing -Value '{"pairing":"keep-between-versions"}' -Encoding UTF8
  $token=Join-Path $state '.p0-lab-token'
  Set-Content -LiteralPath $token -Value 'fixture-not-real-secret' -Encoding UTF8

  Checked @($manager,'install','--root',$root,'--candidate',$source)
  $same=Get-SlotStatus
  Same $same.active $slotA 'Repeat install changed active version'
  if($same.previous){throw 'Repeat install set an unexpected previous slot'}

  # Simulate a second fully verified release. Root manifest is self-consistent,
  # not digitally signed: this test makes no claim about artifact trust.
  Copy-Item -LiteralPath $source -Destination $candidateB -Recurse -Force
  $manifestPath=Join-Path $candidateB 'manifest.json'
  $m=Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  $m.cloudplayVersion='0.12.1'
  $m | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
  Checked @($verifier,$candidateB)

  $pidMarker=Join-Path $state 'service-pids.json'
  Set-Content -LiteralPath $pidMarker -Value '{"simulated":"running"}' -Encoding UTF8
  Rejected @($manager,'install','--root',$root,'--candidate',$candidateB) 'Upgrade allowed while running'
  Same (Get-SlotStatus).active $slotA 'Refused upgrade changed active slot'
  Remove-Item -LiteralPath $pidMarker -Force

  Checked @($manager,'install','--root',$root,'--candidate',$candidateB)
  $upgraded=Get-SlotStatus
  if($upgraded.active -eq $slotA){throw 'New version did not activate'}
  Same $upgraded.previous $slotA 'Previous slot pointer'
  $slotB=[string]$upgraded.active
  Same (Get-Content $pairing -Raw).Trim() '{"pairing":"keep-between-versions"}' 'Pairing state persistence'
  Same (Get-Content $token -Raw).Trim() 'fixture-not-real-secret' 'Token persistence'

  Checked @($manager,'rollback','--root',$root)
  $rolled=Get-SlotStatus
  Same $rolled.active $slotA 'Rollback active slot'
  Same $rolled.previous $slotB 'Rollback previous slot'
  Same (Get-Content $pairing -Raw).Trim() '{"pairing":"keep-between-versions"}' 'Pairing after rollback'

  # Alter an inactive slot and verify that re-activation fails closed.
  $asset=Join-Path $root ('releases\'+$slotB+'\source\moonlight-web\web\manifest.json')
  if(!(Test-Path -LiteralPath $asset)){throw "Cannot find nested manifest tamper fixture: $asset"}
  Add-Content -LiteralPath $asset -Value 'tampered'
  Rejected @($manager,'activate','--root',$root,'--id',$slotB) 'Tampered slot was activated'
  Same (Get-SlotStatus).active $slotA 'Tampered activation changed active slot'
  Write-Host 'PASS: real Windows installer, repeat install, persistent data, running-service refusal, upgrade, rollback and tamper rejection.'
  Write-Host 'NOT CHECKED: GPU media, Sunshine pairing, publisher signature.'
  $passed=$true
} finally {
  $env:PATH=$originalPath
  if($passed){Remove-Item -LiteralPath $workspace -Recurse -Force -ErrorAction SilentlyContinue}
  else{Write-Warning "Install smoke failed; inspect retained workspace $workspace"}
}
