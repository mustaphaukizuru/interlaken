@echo off
title Interlaken - Backend
cd /d "%~dp0..\backend"
set DJANGO_SETTINGS_MODULE=config.settings.development
rem MySQL is not installed locally -- use the SQLite fallback for development.
rem Remove the next line once a local MySQL 8.0 instance is available.
set SQLITE_LOCAL=1
python manage.py migrate -v 0
echo.
echo  Backend : http://localhost:8000
echo  Admin   : http://localhost:8000/admin/
echo  API     : http://localhost:8000/api/v1/
echo.
python manage.py runserver 0.0.0.0:8000
pause
