@echo off
rem Abre a interface grafica no navegador. Precisa do Node.js instalado.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo O Node.js nao foi encontrado. Instale a versao LTS em https://nodejs.org e tente de novo.
  pause
  exit /b 1
)
node src\server.js
pause
