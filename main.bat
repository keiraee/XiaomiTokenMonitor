@echo off
setlocal enabledelayedexpansion
title XiaomiTokenMonitor
cd /d "%~dp0"

:menu
cls
echo.
echo  ==========================================
echo    XiaomiTokenMonitor
echo  ==========================================
echo.
echo    [1] Start Service
echo    [2] Stop Service
echo    [3] Restart Service
echo    [4] View Status
echo    [5] View Logs
echo    [6] Re-login (Refresh Cookie)
echo    [7] Install Auto-Start
echo    [8] Uninstall Auto-Start
echo    [0] Exit
echo.
echo  ==========================================
echo.
set /p choice="  Select option: "

if "%choice%"=="1" goto start
if "%choice%"=="2" goto stop
if "%choice%"=="3" goto restart
if "%choice%"=="4" goto status
if "%choice%"=="5" goto logs
if "%choice%"=="6" goto relogin
if "%choice%"=="7" goto install
if "%choice%"=="8" goto uninstall
if "%choice%"=="0" exit
echo  Invalid option.
timeout /t 2 >nul
goto menu

:: ========== Start ==========
:start
echo.
echo  [START] Launching service ...
if exist server.pid (
    set /p PID=<server.pid
    tasklist /FI "PID eq !PID!" 2>nul | findstr /I "node.exe" >nul
    if !errorlevel! equ 0 (
        echo  [INFO] Already running (PID: !PID!)
        goto wait
    )
)
if exist server.log del /q server.log
powershell -Command "Start-Process -FilePath 'node' -ArgumentList 'src\server.js' -WindowStyle Hidden -WorkingDirectory '%~dp0'"
timeout /t 5 /nobreak >nul
if exist server.pid (
    set /p PID=<server.pid
    echo  [OK] Started (PID: !PID!)
    echo       URL: http://localhost:9999
    echo       API: http://localhost:9999/usage
) else (
    echo  [ERROR] Failed to start. Check server.log
)
goto wait

:: ========== Stop ==========
:stop
echo.
if not exist server.pid (
    echo  [INFO] Service not running.
    goto wait
)
set /p PID=<server.pid
tasklist /FI "PID eq !PID!" 2>nul | findstr /I "node.exe" >nul
if !errorlevel! neq 0 (
    echo  [INFO] PID !PID! not found. Already stopped.
    del /q server.pid 2>nul
    goto wait
)
echo  [STOP] Killing PID !PID! ...
taskkill /PID !PID! /F >nul 2>&1
timeout /t 2 /nobreak >nul
tasklist /FI "PID eq !PID!" 2>nul | findstr /I "node.exe" >nul
if !errorlevel! neq 0 (
    echo  [OK] Stopped.
    del /q server.pid 2>nul
) else (
    echo  [ERROR] Failed. Kill manually.
)
goto wait

:: ========== Restart ==========
:restart
echo.
echo  [RESTART] ...
call :stop_silent
timeout /t 2 /nobreak >nul
call :start_silent
echo  [OK] Restarted.
goto wait

:: ========== Status ==========
:status
echo.
if not exist server.pid (
    echo  [STATUS] Not running.
    goto wait
)
set /p PID=<server.pid
tasklist /FI "PID eq !PID!" 2>nul | findstr /I "node.exe" >nul
if !errorlevel! neq 0 (
    echo  [STATUS] PID file exists but process not found.
    del /q server.pid 2>nul
    goto wait
)
echo  [STATUS] Running
echo    PID:    !PID!
echo    Port:   9999
echo    URL:    http://localhost:9999
echo    API:    http://localhost:9999/usage
echo    Log:    %~dp0server.log
goto wait

:: ========== Logs ==========
:logs
echo.
if not exist server.log (
    echo  [INFO] No log file yet.
    goto wait
)
echo  --- Last 20 lines of server.log ---
echo.
powershell -Command "Get-Content server.log -Tail 20"
goto wait

:: ========== Re-login ==========
:relogin
echo.
echo  [RELOGIN] Deleting cookies and opening browser ...
if exist cookies.json del /q cookies.json
node -e "const a=require('./src/auth');a.login().then(()=>console.log('  [OK] Login success')).catch(e=>console.error('  [ERROR]',e.message))"
goto wait

:: ========== Install Auto-Start ==========
:install
echo.
powershell -Command "Start-Process -FilePath '%~f0' -ArgumentList '_install' -Verb RunAs"
goto menu

:_install
schtasks /create /tn "XiaomiTokenMonitor" /tr "node \"%~dp0src\server.js\"" /sc onlogon /rl highest /f
if !errorlevel! equ 0 (
    echo  [OK] Auto-start installed.
) else (
    echo  [ERROR] Failed.
)
echo.
pause
exit

:: ========== Uninstall Auto-Start ==========
:uninstall
echo.
schtasks /delete /tn "XiaomiTokenMonitor" /f >nul 2>&1
if !errorlevel! equ 0 (
    echo  [OK] Auto-start removed.
) else (
    echo  [INFO] Task not found or already removed.
)
goto wait

:: ========== Helpers ==========
:stop_silent
if exist server.pid (
    set /p PID=<server.pid
    taskkill /PID !PID! /F >nul 2>&1
    del /q server.pid 2>nul
)
goto :eof

:start_silent
if exist server.log del /q server.log
powershell -Command "Start-Process -FilePath 'node' -ArgumentList 'src\server.js' -WindowStyle Hidden -WorkingDirectory '%~dp0'"
timeout /t 5 /nobreak >nul
goto :eof

:wait
echo.
pause
goto menu
