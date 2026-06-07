@echo off
title Odysseus Portable
setlocal enabledelayedexpansion

echo ===================================================
echo   Odysseus Portable Launcher
echo ===================================================

rem Check if Node.js is installed
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js is not installed or not in your system PATH.
    echo Please download and install Node.js from https://nodejs.org/
    echo then try launching this script again.
    pause
    exit /b 1
)

echo Starting orchestrator...
node src/start.js

if errorlevel 1 (
    echo [ERROR] Orchestrator exited with an error.
    pause
)
