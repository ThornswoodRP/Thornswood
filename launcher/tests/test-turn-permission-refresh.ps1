$ErrorActionPreference='Stop'
$repo=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
. (Join-Path $repo 'tests/Launcher-Csc.ps1')
$driver=Join-Path $PSScriptRoot 'turn-permission-refresh/TurnPermissionCases.cs'
$dll=Build-LauncherCode -Launcher -File $driver -Exe -Main 'Thornswood.TurnPermissionCases'
Invoke-LauncherExe $dll
exit $LASTEXITCODE
