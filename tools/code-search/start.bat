@echo off
cd /d "%~dp0"
echo Starting Code Search tool...
start "" "http://localhost:4321"
node server.js
