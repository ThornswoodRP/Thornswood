@echo off
rem Double click this to push the server up to the VPS and start it there.
rem PowerShell 7 (pwsh), the only PowerShell these scripts run in (#5356).
rem docs/guide/set-up-a-machine.md "Install the tools" puts it on every machine.
where /q pwsh || (echo PowerShell 7 ^(pwsh^) is not installed. docs/guide/set-up-a-machine.md "Install the tools" says how. & pause & exit /b 1)
cd /d "%~dp0"
pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0Publish-Server.ps1"
