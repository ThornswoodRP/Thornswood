$ErrorActionPreference='Stop'
$repo=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
. (Join-Path $repo 'tests/Launcher-Csc.ps1')
$driver=Join-Path $PSScriptRoot 'default-endpoints/DefaultEndpointCases.cs'
$dll=Build-LauncherCode -Launcher -File @($driver, (Join-Path $PSScriptRoot 'default-endpoints/VoiceEndpointWorkerCases.cs')) -Exe -Main 'Thornswood.DefaultEndpointCases'
Invoke-LauncherExe $dll
exit $LASTEXITCODE
