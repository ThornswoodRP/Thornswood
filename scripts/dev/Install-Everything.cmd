@echo off
rem Double click this. It installs everything the client needs, builds the
rem launcher, and then publishes the result to the dev channel, which needs this
rem machine's VPS access and signing: it is for a machine that ships
rem (docs/guide/set-up-a-machine.md, "Setting up a machine"). It never
rem publishes to main. Nothing here starts a game or a server.
rem Install-Everything.cmd -NoShip only installs: nothing is published. Any
rem other parameter of Install-Thornswood.ps1 is handed on the same way.
rem PowerShell 7 (pwsh), the only PowerShell these scripts run in (#5356).
rem docs/guide/set-up-a-machine.md "Install the tools" puts it on every machine.
where /q pwsh || (echo PowerShell 7 ^(pwsh^) is not installed. docs/guide/set-up-a-machine.md "Install the tools" says how. & pause & exit /b 1)
cd /d "%~dp0"
pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-Thornswood.ps1" %*
