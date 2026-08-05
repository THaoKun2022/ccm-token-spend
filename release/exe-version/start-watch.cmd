@echo off
chcp 65001 >nul
cd /d "%~dp0"
ccm-token-spend.exe --watch --cdp
pause
