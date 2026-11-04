#Requires -Version 5.1
<# Build-machine-only entrypoint. Do not run on the offline game host.
   The complete patched Moonlight source is reused from a pinned local directory;
   production deployment will never clone GitHub or run npm/cargo.
#>
[CmdletBinding()]
param(
 [Parameter(Mandatory=$true)][string]$MoonlightPath,
 [Parameter(Mandatory=$true)][string]$Node24Home,
 [Parameter(Mandatory=$true)][string]$Node26Home,
 [Parameter(Mandatory=$true)][string]$OutputPath,
 [switch]$P0Only
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$upstream=(Resolve-Path $MoonlightPath).Path
$origPath=$env:PATH
function Checked([string]$Command,[string[]]$Arg){
 Write-Host ('> '+$Command+' '+($Arg -join ' '))
 & $Command @Arg
 if($LASTEXITCODE -ne 0){throw "$Command failed ($LASTEXITCODE)"}
}
try {
  # No silent install of Node runtimes or Rust toolchain.
  foreach($folder in @($Node24Home,$Node26Home)){if(!(Test-Path (Join-Path $folder 'node.exe'))){throw "Missing Node runtime in $folder"}}
  $env:PATH=$Node24Home+[IO.Path]::PathSeparator+$origPath
  Push-Location $root
  try {
    if(-not $P0Only) {
      if(Test-Path 'package-lock.json'){Checked 'npm.cmd' @('ci','--no-audit','--no-fund')}
      else { Checked 'npm.cmd' @('install','--package-lock-only','--no-audit','--no-fund'); Checked 'npm.cmd' @('ci','--no-audit','--no-fund') }
      Checked 'npm.cmd' @('test')
      Checked 'npm.cmd' @('run','build')
      $notice=Join-Path $root 'web-DEPENDENCIES.txt'
      & 'node.exe' 'scripts/release/generate-notices.mjs' | Set-Content -LiteralPath $notice -Encoding UTF8
      if($LASTEXITCODE -ne 0){throw 'Cannot generate third-party dependency notices'}
    }
    $env:PATH=$Node26Home+[IO.Path]::PathSeparator+$origPath
    Checked 'node.exe' @('scripts/p0/check-moonlight-toolchain.mjs')
    & (Join-Path $root 'scripts\p0\build-moonlight-web.ps1') -MoonlightPath $upstream -Build
    if($LASTEXITCODE -and $LASTEXITCODE -ne 0){throw 'Moonlight build failed'}
    $moonExe=Join-Path $upstream 'target\x86_64-pc-windows-gnu\release\web-server.exe'
    if(!(Test-Path $moonExe)){throw 'Moonlight native web-server.exe not found after build'}
    $env:PATH=$Node24Home+[IO.Path]::PathSeparator+$origPath
    $arguments=@('scripts/release/pack-offline.mjs','--mode',$(if($P0Only){'windows-p0'}else{'windows-full'}),'--out',$OutputPath,
      '--node',(Join-Path $Node24Home 'node.exe'),'--node-license',(Join-Path $Node24Home 'LICENSE'),
      '--moonlight-server',$moonExe,'--moonlight-static',(Join-Path $upstream 'static'),'--moonlight-source',$upstream)
    if(-not $P0Only){$arguments+=@('--next-standalone',(Join-Path $root '.next\standalone'),'--next-static',(Join-Path $root '.next\static'),'--public',(Join-Path $root 'public'),'--web-notices',(Join-Path $root 'web-DEPENDENCIES.txt'))}
    Checked 'node.exe' $arguments
    Checked 'node.exe' @('scripts/release/verify-offline.mjs',$OutputPath)
    Write-Host "Offline release ready: $OutputPath (no further project downloads on deployment host)"
  } finally {Pop-Location}
} finally {$env:PATH=$origPath}
