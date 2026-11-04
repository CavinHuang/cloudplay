#Requires -Version 5.1
<##
CloudPlay v0.9 - Pinned Moonlight Web source build runner for Windows.
This does NOT install Sunshine, create accounts, configure credentials, or
expose the service to the network. Never run on a shared game server without
reviewing build dependencies. Requires distinct Node 26.4+/npm 11.17+ toolchain.
Usage:
  .\scripts\p0\build-moonlight-web.ps1 -MoonlightPath C:\dev\moonlight-web-stream
  .\scripts\p0\build-moonlight-web.ps1 -MoonlightPath C:\dev\moonlight-web-stream -Build
#>
param(
  [Parameter(Mandatory=$true)][string]$MoonlightPath,
  [switch]$Build,
  [switch]$FrontendOnly
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$cloudplayRoot=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$moonlight=(Resolve-Path $MoonlightPath).Path
$pinned='7b9821430e07087f459db3db9aac550e1e9c9bff'

function Invoke-Checked([string]$Program,[string[]]$Arguments) {
  Write-Host ('> ' + $Program + ' ' + ($Arguments -join ' '))
  & $Program @Arguments
  if($LASTEXITCODE -ne 0){ throw "$Program failed with exit code $LASTEXITCODE" }
}

$installedCommit=(& git -C $moonlight rev-parse HEAD).Trim()
if($LASTEXITCODE -ne 0 -or $installedCommit -ne $pinned){throw "Moonlight checkout must be pinned to $pinned (found $installedCommit)"}
if(!(Test-Path (Join-Path $moonlight 'package.json'))){throw 'Moonlight package.json not found'}

# Ensure that `node` and `npm` on PATH refer to Moonlight upstream toolchain.
Invoke-Checked 'node' @((Join-Path $cloudplayRoot 'scripts\p0\check-moonlight-toolchain.mjs'))
Invoke-Checked 'node' @((Join-Path $cloudplayRoot 'scripts\p0\integrate-moonlight-web.mjs'),$moonlight,'--dry-run')
Write-Host 'Pinned source/toolchain checks passed.'
if($FrontendOnly -and -not $Build){throw '-FrontendOnly requires -Build'}
if(-not $Build) {
  Write-Host 'Preflight only. Re-run with -Build to patch and compile Moonlight Web.'
  exit 0
}

# Frontend-only build still compiles Rust-generated JS bindings, but skips the
# native Windows GNU web-server artifact. It is NOT a usable game service.
# A full Windows release build needs the GNU Rust target and MinGW.
$gnu='x86_64-pc-windows-gnu'
if(-not (Get-Command 'cargo' -ErrorAction SilentlyContinue)){ throw 'cargo not found on PATH' }
if(-not (Get-Command 'wasm-bindgen' -ErrorAction SilentlyContinue)){ throw 'wasm-bindgen-cli not found; install matching wasm-bindgen-cli and retry' }
$wasmVersion=(& wasm-bindgen --version) -join ' '
if($LASTEXITCODE -ne 0 -or $wasmVersion -notmatch '(?<!\d)0\.2\.128(?!\d)'){
  throw "Pinned Moonlight Web requires wasm-bindgen-cli 0.2.128 (installed: $wasmVersion). Build machine must install the matching CLI."
}

if(-not $FrontendOnly) {
$rustTargets=(& rustup target list --installed) -join "`n"
if($LASTEXITCODE -ne 0 -or $rustTargets -notmatch [regex]::Escape($gnu)) {
  throw "Missing Rust GNU target $gnu. Install rustup, target, and MinGW toolchain before building."
}
if(-not (Get-Command 'gcc' -ErrorAction SilentlyContinue)){
  throw 'GNU gcc / MinGW not found on PATH; required for the Windows GNU Rust target.'
}
}

Invoke-Checked 'node' @((Join-Path $cloudplayRoot 'scripts\p0\integrate-moonlight-web.mjs'),$moonlight)
Push-Location $moonlight
try {
  if(Test-Path 'package-lock.json') { Invoke-Checked 'npm' @('ci','--no-audit','--no-fund') }
  else { Invoke-Checked 'npm' @('install','--no-audit','--no-fund') }
  Invoke-Checked 'npm' @('run','build')
  if(!(Test-Path 'dist')){ throw 'Moonlight front-end dist/ is absent after npm build.' }
  Invoke-Checked 'node' @((Join-Path $cloudplayRoot 'scripts\p0\check-moonlight-output.mjs'),(Join-Path $moonlight 'dist'))
  if($FrontendOnly) {
    Write-Host 'Frontend bundle compiled AND verified to contain CloudPlay telemetry. No Windows native web server was built.'
    return
  }
  if(Test-Path 'static'){ throw 'Refusing to overwrite an existing static/ folder. Move or back it up before the release build.' }
  Copy-Item -Path 'dist' -Destination 'static' -Recurse
  Invoke-Checked 'cargo' @('build','--release','--target',$gnu)
  Write-Host 'Frontend and native backend compiled. Verify that release executable can locate static/ before starting it.'
  Write-Host 'Do not claim successful play until Sunshine/gamepad/audio are verified on a Windows GPU host.'
} finally { Pop-Location }
