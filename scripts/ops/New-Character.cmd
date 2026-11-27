@echo off
rem Double click this to throw away the test characters on the server on this
rem machine (New-Character.ps1), so the next launch runs creation from the top.
rem It never reaches the VPS: one character there is Reset-Character.ps1 -Server.
rem PowerShell 7 (pwsh), the only PowerShell these scripts run in (#5356).
rem docs/guide/set-up-a-machine.md "Install the tools" puts it on every machine.
where /q pwsh || (echo PowerShell 7 ^(pwsh^) is not installed. docs/guide/set-up-a-machine.md "Install the tools" says how. & pause & exit /b 1)
cd /d "%~dp0"
pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0New-Character.ps1"
pause
