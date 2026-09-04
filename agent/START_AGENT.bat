@echo off
title UnFi-PCO Agent Launcher
echo =======================================================
echo          UnFi-PCO Agent Docker Launcher
echo =======================================================
echo.

cd /d "%~dp0"

rem Ensure service-account.json exists as a file so Docker mounts it properly
if not exist "%~dp0service-account.json" (
    echo {} > "%~dp0service-account.json"
)

rem Ensure .env exists as a file
if not exist "%~dp0.env" (
    if exist "%~dp0.env.example" (
        copy "%~dp0.env.example" "%~dp0.env" > nul
    ) else (
        echo UNIFI_HOST= > "%~dp0.env"
    )
)

echo Building and launching container...
docker compose up -d --build

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Docker command failed. Please ensure Docker Desktop is running.
    pause
    exit /b 1
)

echo.
echo =======================================================
echo  SUCCESS! UnFi-PCO Agent is running.
echo.
echo  Open your web browser to configure the agent:
echo  --> http://localhost:8080
echo =======================================================
echo.
echo Streaming logs (Press Ctrl+C to stop viewing logs):
echo.
docker compose logs -f
