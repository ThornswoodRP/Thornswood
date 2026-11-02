@echo off
rem Double click this. It installs everything the client needs and rebuilds the
rem launcher. Nothing here starts a game or a server.
rem PowerShell 7 (pwsh), the only PowerShell these scripts run in (#5356).
rem docs/guide/set-up-a-machine.md "Install the tools" puts it on every machine.
where /q pwsh || (echo PowerShell 7 ^(pwsh^) is not installed. docs/guide/set-up-a-machine.md "Install the tools" says how. & pause & exit /b 1)
cd /d "%~dp0"
pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-Thornswood.ps1"
