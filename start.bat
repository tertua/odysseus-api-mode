@echo off
title Odysseus Portable
setlocal enabledelayedexpansion

cd /d "%~dp0"
set "ROOT=%~dp0"

REM ============================================================
REM  PORTABLE -- Semua path relatif ke %ROOT%
REM ============================================================
set "PYTHONUSERBASE=%ROOT%.cache\python_packages"
set "PIP_CACHE_DIR=%ROOT%.cache\pip_cache"
set PIP_USER=1
set PYTHONNOUSERSITE=1

set "TMP=%ROOT%tmp"
set "TEMP=%ROOT%tmp"

set "NPM_CONFIG_PREFIX=%ROOT%.cache\npm_global"
set "NPM_CONFIG_CACHE=%ROOT%.cache\npm_cache"

if not exist "%PYTHONUSERBASE%" mkdir "%PYTHONUSERBASE%"
if not exist "%PIP_CACHE_DIR%" mkdir "%PIP_CACHE_DIR%"
if not exist "%TMP%" mkdir "%TMP%"
if not exist "%NPM_CONFIG_PREFIX%" mkdir "%NPM_CONFIG_PREFIX%"
if not exist "%NPM_CONFIG_CACHE%" mkdir "%NPM_CONFIG_CACHE%"

REM ============================================================
REM  BOOTSTRAP NODE.JS
REM ============================================================
set "NODE_VERSION=22.16.0"
set "NODE_DIR=%ROOT%bin\node"
set "NODE_EXE=%NODE_DIR%\node.exe"

echo ===================================================
echo   Odysseus Portable -- Full Isolation
echo ===================================================
echo  Python userbase : %PYTHONUSERBASE%
echo  Pip cache      : %PIP_CACHE_DIR%
echo  Npm prefix     : %NPM_CONFIG_PREFIX%
echo  Npm cache      : %NPM_CONFIG_CACHE%
echo  Temp           : %TMP%
echo ===================================================

if not exist "%NODE_EXE%" (
    echo [Bootstrap] Node.js not found. Downloading...
    if /I "%PROCESSOR_ARCHITECTURE%"=="ARM64" (
        set "NODE_ARCH=arm64"
    ) else (
        set "NODE_ARCH=x64"
    )
    powershell.exe -NoProfile -ExecutionPolicy Bypass ^
        -File "%ROOT%scripts\bootstrap-node.ps1" ^
        -Version "%NODE_VERSION%" -NodeDir "%NODE_DIR%"
    if errorlevel 1 (
        echo [ERROR] Gagal download Node.js portable.
        pause
        exit /b 1
    )
)

echo.
"%NODE_EXE%" src/start.js %*

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Orchestrator exit code %ERRORLEVEL%
    pause
)
