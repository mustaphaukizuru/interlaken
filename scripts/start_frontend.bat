@echo off
title Interlaken - Frontend
cd /d "%~dp0..\frontend"
if not exist "node_modules" npm install
echo.
echo  Frontend: http://localhost:3000
echo.
npm run dev
pause
