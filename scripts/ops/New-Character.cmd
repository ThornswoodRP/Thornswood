@echo off
rem Double click this to throw away the character on the server, so the next
rem launch runs creation from the top. Nothing is deleted, it is moved aside.
rem PowerShell 7 (pwsh), the only PowerShell these scripts run in (#5356).
rem docs/guide/set-up-a-machine.md "Install the tools" puts it on every machine.
where /q pwsh || (echo PowerShell 7 ^(pwsh^) is not installed. docs/guide/set-up-a-machine.md "Install the tools" says how. & pause & exit /b 1)
cd /d "%~dp0"
pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0Reset-Character.ps1"
