param([string]$Repository = "https://github.com/CavinHuang/cloudplay.git")
$ErrorActionPreference = "Stop"
$src = Split-Path -Parent $MyInvocation.MyCommand.Path
$work = Join-Path $env:TEMP ("cloudplay-github-import-" + [guid]::NewGuid().ToString("N"))
try {
  git clone $Repository $work
  if ($LASTEXITCODE -ne 0) { throw "Cannot clone GitHub repository" }
  Get-ChildItem -LiteralPath $src -Force | Where-Object { $_.Name -ne "push-to-github.ps1" -and $_.Name -ne "push-to-github.sh" } | ForEach-Object {
     Copy-Item -LiteralPath $_.FullName -Destination $work -Recurse -Force
  }
  Push-Location $work
  try {
    git add -A
    git diff --cached --quiet
    if ($LASTEXITCODE -eq 0) { Write-Host "No changes to push"; exit 0 }
    git commit -m "feat: import reviewed CloudPlay v0.12 source and CI workflows"
    if ($LASTEXITCODE -ne 0) { throw "Git commit failed" }
    git push origin HEAD:main
    if ($LASTEXITCODE -ne 0) { throw "Git push failed" }
  } finally { Pop-Location }
} finally { if (Test-Path $work) { Remove-Item -Recurse -Force $work } }
