# Graceful P0 shutdown. Stop tracked game sessions before terminating the Agent;
# Stop-Process on Windows is not equivalent to SIGTERM and may orphan a game.
[CmdletBinding()]
param([switch]$Force)
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$stateRoot=if($env:CLOUDPLAY_STATE_DIR){[IO.Path]::GetFullPath($env:CLOUDPLAY_STATE_DIR)}else{$root}
$pidFile=Join-Path $stateRoot '.p0-lab-pids.json'
if (-not (Test-Path -LiteralPath $pidFile)) {Write-Host 'No P0 lab PID file; nothing to stop.';exit 0}
$sessionSafe=$false
$tokenFile=Join-Path $stateRoot '.p0-lab-token'
try {
  if (-not (Test-Path -LiteralPath $tokenFile)) {throw 'Missing .p0-lab-token'}
  $token=[IO.File]::ReadAllText($tokenFile).Trim()
  if ($token.Length -lt 32) {throw 'Invalid lab token'}
  $headers=@{Authorization="Bearer $token"}
  $base='http://127.0.0.1:7788'
  $sessions=Invoke-RestMethod -Uri "$base/internal/lab/sessions" -Headers $headers -TimeoutSec 3
  foreach ($item in @($sessions.sessions | Where-Object { $_ -ne $null })) {
    if ($item.state -in @('starting','connecting','reconnecting','stopping','failed')) {
      Write-Host "Requesting game stop for session $($item.id)..."
      Invoke-RestMethod -Uri "$base/internal/lab/sessions/$($item.id)" -Method Delete -Headers $headers -TimeoutSec 3 | Out-Null
    }
  }
  $deadline=(Get-Date).AddSeconds(14)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 750
    $state=Invoke-RestMethod -Uri "$base/internal/status" -Headers $headers -TimeoutSec 3
    $active=@($state.sessions | Where-Object { $_.state -in @('starting','connecting','reconnecting','stopping') })
    $games=@($state.hosts | Where-Object { $_ -ne $null -and $_.activeGame -ne $null -and $_.activeGame.state -eq 'running' })
    if ($active.Count -eq 0 -and $games.Count -eq 0) {$sessionSafe=$true;break}
  }
  if (-not $sessionSafe) {throw 'Game process may still be running; automatic shutdown was NOT confirmed'}
} catch {
  if (-not $Force) {throw "Refusing to kill the Agent before game cleanup is confirmed: $($_.Exception.Message). Retry or use -Force only after manually stopping the game."}
  Write-Warning "Force shutdown: game process cleanup NOT confirmed. Stop any orphaned test game manually. Detail: $($_.Exception.Message)"
}
$record=Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
foreach ($id in @($record.agent,$record.coordinator)) {
  if (-not $id) { continue }
  $process=Get-CimInstance -ClassName Win32_Process -Filter "ProcessId=$([int]$id)" -ErrorAction SilentlyContinue
  if (-not $process) {continue}
  $command=[string]$process.CommandLine
  if ($process.Name -notmatch '^node(\.exe)?$' -or $command -notmatch 'lab[\\/](agent|coordinator)\.mjs') {
    Write-Warning "Skipping PID=$id because it is not a recognized CloudPlay P0 Node process."
    continue
  }
  Stop-Process -Id ([int]$id) -ErrorAction SilentlyContinue
  Write-Host "Stopped CloudPlay P0 PID=$id"
}
Remove-Item -LiteralPath $pidFile -Force
