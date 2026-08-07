<#
  Launch backend (Django, SQLite dev) + frontend (Vite) in two PowerShell windows.
  Usage:  .\scripts\start_dev.ps1   (works from any directory)
#>
$root = Split-Path -Parent $PSScriptRoot

# Backend — Django dev server on :8000 (SQLite)
Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "cd '$root\backend'; " +
    "`$env:DJANGO_SETTINGS_MODULE='config.settings.development'; " +
    "`$env:SQLITE_LOCAL='1'; " +
    "python manage.py migrate; " +
    "python manage.py runserver 8000"
)

# Frontend — Vite dev server on :3000
Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "cd '$root\frontend'; " +
    "if (-not (Test-Path node_modules)) { npm install }; " +
    "npm run dev"
)

Write-Host ""
Write-Host "  Backend  : http://localhost:8000/admin/   (admin@interlaken.edu.mx / Interla2025Admin!)" -ForegroundColor Green
Write-Host "  API      : http://localhost:8000/api/v1/" -ForegroundColor Green
Write-Host "  Frontend : http://localhost:3000/" -ForegroundColor Green
Write-Host ""
Write-Host "  (Two new windows opened. Close them to stop the servers.)" -ForegroundColor DarkGray
