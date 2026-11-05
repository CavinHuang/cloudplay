#Requires -Version 5.1
<# Verify an assembled Windows offline bundle WITHOUT Node/npm/Rust/MinGW on PATH.
   This is a process and HTTP smoke, NOT a GPU/video/audio/input test. #>
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$BundlePath,[switch]$SkipWeb)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$root=(Resolve-Path -LiteralPath $BundlePath).Path
$node=Join-Path $root 'runtime\node.exe'
$moon=Join-Path $root 'services\moonlight\web-server.exe'
$verify=Join-Path $root 'deploy\verify-offline.mjs'
foreach($f in @($node,$moon,$verify)){if(!(Test-Path -LiteralPath $f -PathType Leaf)){throw "Missing offline component: $f"}}
$oldPath=$env:PATH
$oldNodeEnv=$env:NODE_ENV
$oldPort=$env:PORT
$oldHost=$env:HOSTNAME
$logs=Join-Path $env:TEMP ('cloudplay-offline-smoke-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$ok=$false
try {
  # Intentionally remove development toolchains from PATH: an offline host has none.
  $env:PATH="$env:SystemRoot\System32;$env:SystemRoot;$env:SystemRoot\System32\Wbem"
  & $node $verify $root
  if($LASTEXITCODE -ne 0){throw 'Offline manifest verification failed'}
  & $node --version
  if($LASTEXITCODE -ne 0){throw 'Bundled Node failed without system-wide Node'}
  Push-Location (Split-Path -Parent $moon)
  try {
    & $moon --help 1> (Join-Path $logs 'moonlight.out.log') 2> (Join-Path $logs 'moonlight.err.log')
    if($LASTEXITCODE -ne 0){throw 'Moonlight executable could not start without MinGW; inspect smoke logs'}
    if(!(Get-Content (Join-Path $logs 'moonlight.out.log') -Raw).Trim()){throw 'Moonlight --help returned empty output'}
  } finally {Pop-Location}
  $web=Join-Path $root 'services\web\server.js'
  if(!$SkipWeb -and (Test-Path -LiteralPath $web)){
    $env:NODE_ENV='production';$env:HOSTNAME='127.0.0.1';$env:PORT='39877'
    $proc=$null
    try {
      $proc=Start-Process -FilePath $node -ArgumentList 'server.js' -WorkingDirectory (Split-Path -Parent $web) -PassThru -RedirectStandardOutput (Join-Path $logs 'web.out.log') -RedirectStandardError (Join-Path $logs 'web.err.log')
      $ready=$false
      for($i=0;$i -lt 48;$i++){
        if($proc.HasExited){break}
        try {
          $r=Invoke-WebRequest -Uri 'http://127.0.0.1:39877/api/v1/health' -UseBasicParsing -TimeoutSec 2
          if([int]$r.StatusCode -eq 200){$ready=$true;break}
        } catch {}
        Start-Sleep -Milliseconds 250
      }
      if(!$ready){throw 'Bundled Next.js server failed health check'}
    } finally {if($proc -and !$proc.HasExited){Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue}}
  }
  # Run a REAL packaged M2 private reservation service. Synthetic host booleans
  # exercise the control policy only, never pretend that a physical GPU exists.
  $m2Smoke=Join-Path $root 'deploy\smoke-m2-offline.mjs'
  if(!(Test-Path -LiteralPath $m2Smoke -PathType Leaf)){throw 'M2 installed runtime smoke missing'}
  & $node $m2Smoke $root | Out-Host
  if($LASTEXITCODE -ne 0){throw 'M2 offline real HTTP smoke failed'}
  $ok=$true
  Write-Host 'PASS: offline manifest, bundled Node, Moonlight --help, optional Next.js health and real M2 private HTTP smoke.'
  Write-Host 'NOT CHECKED: Sunshine/GPU video, audio, gamepad, network reachability.'
} finally {
  $env:PATH=$oldPath;$env:NODE_ENV=$oldNodeEnv;$env:PORT=$oldPort;$env:HOSTNAME=$oldHost
  if($ok){Remove-Item $logs -Recurse -Force -ErrorAction SilentlyContinue}
  else{Write-Warning "Offline smoke failed; inspect logs in $logs"}
}
