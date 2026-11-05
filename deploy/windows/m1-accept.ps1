#Requires -Version 5.1
<#
 CloudPlay M1 Windows acceptance operator entrypoint.
 Installed at <InstallRoot>\m1-accept.ps1 from a verified Windows FULL bundle.
 Prepare: start loopback-only local services if stopped, create evidence index
 and run non-claiming host preflight.
 Check: refresh a separate preflight snapshot without rewriting index evidence.
 Review: independently validate three real sessions and write ONLY a sanitized
 summary; it never invents gameplay, media, screenshots or witness assertions.
 No network downloads, firewall changes or public listeners.
#>
[CmdletBinding()]
param(
  [ValidateSet('Prepare','Check','Review','Rebaseline')][string]$Action='Prepare',
  [string]$GamePath='',
  [string]$EvidenceDir='',
  [switch]$OpenBrowser
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$root=(Resolve-Path -LiteralPath $PSScriptRoot).Path
$pointerFile=Join-Path $root 'active.json'
if(!(Test-Path -LiteralPath $pointerFile -PathType Leaf)){
  throw 'M1_ACCEPT_REQUIRES_INSTALLED_RELEASE: install the verified Windows full artifact first.'
}
$ptr=Get-Content -LiteralPath $pointerFile -Raw | ConvertFrom-Json
if($ptr.schema -ne 'cloudplay.slots.v1' -or
   [string]$ptr.active -cnotmatch '^[A-Za-z0-9][A-Za-z0-9._-]{1,100}$'){
  throw 'M1_INVALID_ACTIVE_SLOT'
}
$release=Join-Path (Join-Path $root 'releases') ([string]$ptr.active)
$node=Join-Path $release 'runtime\node.exe'
$verifier=Join-Path $release 'deploy\verify-offline.mjs'
foreach($item in @($node,$verifier)){
  if(!(Test-Path -LiteralPath $item -PathType Leaf)){throw 'M1_ACTIVE_RELEASE_INCOMPLETE'}
}
& $node $verifier $release | Out-Host
if($LASTEXITCODE -ne 0){throw 'M1_ACTIVE_RELEASE_INTEGRITY_FAILED'}
$manifest=Get-Content -LiteralPath (Join-Path $release 'manifest.json') -Raw | ConvertFrom-Json
if($manifest.mode -ne 'windows-full'){throw 'M1_REQUIRES_FULL_WINDOWS_WEB_RELEASE'}
if(!$EvidenceDir){$EvidenceDir=Join-Path $root 'evidence\m1'}
$evidence=[IO.Path]::GetFullPath($EvidenceDir)
if($evidence -eq $release -or
   $evidence.StartsWith($release+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){
  throw 'M1_EVIDENCE_MUST_BE_OUTSIDE_IMMUTABLE_RELEASE'
}
$index=Join-Path $evidence 'm1-index.json'
if($Action -eq 'Rebaseline'){
  if(!(Test-Path -LiteralPath $index -PathType Leaf)){throw 'M1_INDEX_NOT_FOUND: run Prepare first.'}
  $initial=Join-Path $evidence 'host-preflight.json'
  if(!(Test-Path -LiteralPath $initial -PathType Leaf)){throw 'M1_BASELINE_NOT_FOUND'}
  # A rebaseline is ONLY allowed before any media, witness, screenshot, or
  # review artifact exists. Never allow rebaselining completed/partial sessions.
  foreach($cycle in 1..3){
    foreach($filename in @("cycle-$cycle-media.json","cycle-$cycle-manual.json","cycle-$cycle.png","cycle-$cycle.jpg","cycle-$cycle.jpeg","cycle-$cycle.webp")){
      $artifact=Join-Path $evidence $filename
      if(Test-Path -LiteralPath $artifact){throw 'M1_REBASELINE_LOCKED_BY_CYCLE_EVIDENCE'}
    }
  }
  if(Test-Path -LiteralPath (Join-Path $evidence 'review-result.json')){throw 'M1_REBASELINE_LOCKED_BY_REVIEW'}
  if(!$GamePath -or ![IO.Path]::IsPathRooted($GamePath) -or
     [IO.Path]::GetFileName($GamePath) -ine 'supertuxkart.exe' -or
     !(Test-Path -LiteralPath $GamePath -PathType Leaf)){
    throw 'M1_GAME_PATH_REQUIRED: specify the absolute path to installed supertuxkart.exe.'
  }
  $preflight=Join-Path $release 'services\p0\scripts\p0\m1-host-preflight.ps1'
  if(!(Test-Path -LiteralPath $preflight -PathType Leaf)){throw 'M1_PREFLIGHT_MISSING'}
  $temporary=Join-Path $evidence 'host-preflight-candidate.json'
  if(Test-Path -LiteralPath $temporary){throw 'M1_BASELINE_CANDIDATE_EXISTS'}
  try {
    & $preflight -GamePath $GamePath -StateRoot (Join-Path $root 'state') -OutFile $temporary -ReportOnly
    if($LASTEXITCODE -and $LASTEXITCODE -ne 0){throw 'M1_PREFLIGHT_TOOL_FAILED'}
    $candidate=Get-Content -LiteralPath $temporary -Raw | ConvertFrom-Json
    if($candidate.kind -ne 'cloudplay-m1-host-preflight' -or $candidate.schemaVersion -ne 1 -or $candidate.ready -ne $true -or
       @($candidate.checks.PSObject.Properties | Where-Object {$_.Value -ne $true}).Count -gt 0){
      throw 'M1_REBASELINE_NOT_READY: fix all actual host checks first; baseline unchanged.'
    }
    $original=Get-Content -LiteralPath $initial -Raw | ConvertFrom-Json
    if($original.kind -ne 'cloudplay-m1-host-preflight' -or $original.schemaVersion -ne 1){throw 'M1_BASELINE_INVALID'}
    $archive=Join-Path $evidence ('host-preflight-previous-'+([DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfff'))+'.json')
    [IO.File]::Copy($initial,$archive,$false)
    [IO.File]::Copy($temporary,$initial,$true)
    Write-Host 'M1 baseline replaced only after all new live host checks passed; previous boolean-only baseline archived.'
    Write-Host "Archived previous baseline: $archive"
  }finally{
    if(Test-Path -LiteralPath $temporary){Remove-Item -LiteralPath $temporary -Force}
  }
  return
}
if($Action -eq 'Review'){
  if(!(Test-Path -LiteralPath $index -PathType Leaf)){throw 'M1_INDEX_NOT_FOUND: run Prepare first.'}
  $checkScript=Join-Path $release 'services\p0\scripts\p0\verify-m1-acceptance.mjs'
  if(!(Test-Path -LiteralPath $checkScript -PathType Leaf)){throw 'M1_VERIFIER_MISSING'}
  # A nonzero verifier exit is expected for incomplete real-session evidence.
  # Capture the bounded, sanitized result without copying original source files.
  $raw=(& $node $checkScript $index 2>&1 | Out-String)
  $verifierExit=$LASTEXITCODE
  try{$result=$raw | ConvertFrom-Json}catch{
    throw 'M1_REVIEW_INVALID: the independent verifier did not return a valid JSON review.'
  }
  if($result.kind -ne 'cloudplay-m1-review-result' -or $result.schemaVersion -ne 1){
    throw 'M1_REVIEW_INVALID: no trusted summary was generated.'
  }
  $out=Join-Path $evidence 'review-result.json'
  [IO.File]::WriteAllText($out,(($result|ConvertTo-Json -Depth 12)+"`n"),[Text.UTF8Encoding]::new($false))
  if($verifierExit -ne 0 -or $result.readyForIndependentReview -ne $true){
    Write-Warning ('M1_INCOMPLETE: '+(@($result.failures) -join ', '))
    Write-Host "Review summary: $out (no original media or credentials copied)"
    throw 'M1_REVIEW_NOT_READY: real GPU media / operator evidence is not complete.'
  }
  Write-Host "M1 evidence ready for independent review: $out"
  Write-Host 'Cooperative counters and operator statements are NOT independent proof of playable video/audio/input.'
  return
}
if(!$GamePath -or ![IO.Path]::IsPathRooted($GamePath) -or
   [IO.Path]::GetFileName($GamePath) -ine 'supertuxkart.exe' -or
   !(Test-Path -LiteralPath $GamePath -PathType Leaf)){
  throw 'M1_GAME_PATH_REQUIRED: specify the absolute path to legally installed supertuxkart.exe.'
}
$state=Join-Path $root 'state'
$preflight=Join-Path $release 'services\p0\scripts\p0\m1-host-preflight.ps1'
if(!(Test-Path -LiteralPath $preflight -PathType Leaf)){throw 'M1_PREFLIGHT_MISSING'}
if($Action -eq 'Prepare'){
  if(!(Test-Path -LiteralPath (Join-Path $state 'service-pids.json') -PathType Leaf)){
    & (Join-Path $root 'start-active.ps1') -EnableLocalLaunch -GamePath $GamePath | Out-Host
    if($LASTEXITCODE -and $LASTEXITCODE -ne 0){throw 'M1_LOCAL_SERVICE_START_FAILED'}
  }else{
    # Never auto-restart or change authorization on an already-running service.
    try{
      $status=Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/v1/local/status' -TimeoutSec 3
      if($status.localLaunchEnabled -ne $true){throw 'Operator not enabled'}
    }catch{throw 'M1_ALREADY_RUNNING_WITHOUT_OPERATOR: stop-active.ps1 then run Prepare.'}
  }
  if(!(Test-Path -LiteralPath $index -PathType Leaf)){
    $create=Join-Path $release 'services\p0\scripts\p0\create-m1-index.mjs'
    & $node $create $evidence | Out-Host
    if($LASTEXITCODE -ne 0){throw 'M1_INDEX_CREATE_FAILED'}
  }else{
    Write-Host 'Existing M1 index preserved; no cycle evidence was overwritten.'
  }
}
# Never overwrite the original preflight referenced by the acceptance index.
$initial=Join-Path $evidence 'host-preflight.json'
$destination=if(Test-Path -LiteralPath $initial -PathType Leaf){
  Join-Path $evidence 'host-check-latest.json'
}else{$initial}
& $preflight -GamePath $GamePath -StateRoot $state -OutFile $destination -ReportOnly
if($LASTEXITCODE -and $LASTEXITCODE -ne 0){throw 'M1_PREFLIGHT_TOOL_FAILED'}
$report=Get-Content -LiteralPath $destination -Raw | ConvertFrom-Json
if($report.kind -ne 'cloudplay-m1-host-preflight'){throw 'M1_PREFLIGHT_REPORT_INVALID'}
$failed=@($report.checks.PSObject.Properties | Where-Object {$_.Value -ne $true} | ForEach-Object {$_.Name})
Write-Host ('M1 infrastructure: '+$(if($report.ready){'READY FOR LOCAL TEST (NOT PLAYABLE PROOF)'}else{'INCOMPLETE'}))
if($failed.Count){Write-Host ('Missing checks: '+($failed -join ', '))}
Write-Host "Evidence folder: $evidence"
Write-Host 'For each NEW session: export cycle-N-media.json and cycle-N-manual.json in Next Player; save a separate redacted cycle-N.png.'
Write-Host ("After all 3 cycles: & '"+(Join-Path $root 'm1-accept.ps1')+"' -Action Review -EvidenceDir '"+$evidence+"'")
if($Action -eq 'Prepare' -and $OpenBrowser){
  Start-Process 'http://127.0.0.1:3000/games/supertuxkart'
}
