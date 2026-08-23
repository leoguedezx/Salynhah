@echo off
chcp 65001 >nul
start "CineLeo Studio" powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -File "%~dp0CineLeoStudio.ps1"

