<#
.SYNOPSIS
  Run the Interlaken implementation prompts through Claude Code, in order,
  with full permission bypass. Auto-commits after each so diffs stay reviewable.

.EXAMPLE
  .\prompts\run-prompts.ps1                 # run all (01..20)
  .\prompts\run-prompts.ps1 -From 2 -To 5   # run 02..05 only
  .\prompts\run-prompts.ps1 -From 8 -To 8   # run just prompt 08
  .\prompts\run-prompts.ps1 -NoCommit       # don't auto-commit
#>
[CmdletBinding()]
param(
    [int]$From = 1,
    [int]$To = 20,
    [switch]$NoCommit,
    [string]$Model = "opus"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot   # repo root (prompts/ lives under it)
Set-Location $root

$logDir = Join-Path $PSScriptRoot "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$files = Get-ChildItem (Join-Path $PSScriptRoot "[0-9]*.md") | Sort-Object Name

foreach ($file in $files) {
    if ($file.Name -notmatch '^(\d+)-') { continue }
    $num = [int]$Matches[1]
    if ($num -lt $From -or $num -gt $To) { continue }

    Write-Host ""
    Write-Host "=== [$num] $($file.Name) =============================" -ForegroundColor Cyan
    $body = Get-Content -Raw $file.FullName
    $log  = Join-Path $logDir ("{0:D2}.log" -f $num)

    claude --dangerously-skip-permissions --model $Model -p $body 2>&1 | Tee-Object -FilePath $log

    if ($LASTEXITCODE -ne 0) {
        Write-Host "Prompt $num exited with $LASTEXITCODE - stopping." -ForegroundColor Red
        break
    }

    if (-not $NoCommit) {
        $msg = "prompt " + $file.BaseName + ": automated run"
        git add -A
        git commit -m $msg 2>$null | Out-Null
    }
    Write-Host "=== [$num] done ===" -ForegroundColor Green
}
