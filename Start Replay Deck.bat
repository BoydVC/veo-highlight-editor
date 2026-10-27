@echo off
cd /d "%~dp0"
start "" http://localhost:4242
node server.js
