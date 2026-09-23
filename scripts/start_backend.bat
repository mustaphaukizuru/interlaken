@echo off
title Interlaken - Backend
cd /d "%~dp0..\backend"
set DJANGO_SETTINGS_MODULE=config.settings.development
rem Local development always runs on SQLite (production is managed PostgreSQL).
set SQLITE_LOCAL=1
python manage.py migrate -v 0
echo.
echo  Backend : http://localhost:8000
echo  Admin   : http://localhost:8000/django-admin/
echo  API     : http://localhost:8000/api/v1/
echo.
python manage.py runserver 0.0.0.0:8000
pause
