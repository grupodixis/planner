@echo off
cd /d "%~dp0"
echo Levantando s360_planificacion con Docker...
if not exist backups mkdir backups
rem Copia de seguridad de la base de datos antes de actualizar (si ya estaba en marcha)
docker compose exec -T db pg_dump -U s360 s360 > backups\antes-de-actualizar.sql 2>nul
docker compose up -d --build > levantar.log 2>&1
docker compose ps >> levantar.log 2>&1
type levantar.log
echo.
echo Abre http://localhost:8080
timeout /t 15
