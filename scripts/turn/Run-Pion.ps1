# Foreground native UDP relay, under its canonical restricted task identity.
[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'PionHost.ps1')
. (Join-Path $PSScriptRoot 'PionPolicy.ps1')
$state=Get-Content -LiteralPath (Join-Path $root 'relay.json') -Raw | ConvertFrom-Json
$policy=Get-Content -LiteralPath (Join-Path $root 'relay-policy.json') -Raw | ConvertFrom-Json
if($state.role -notin 'dev','main'){throw 'Invalid relay role.'}
$role=$policy.roles.($state.role)
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
if($identity.User.Value -ne 'S-1-5-19' -or $state.taskSid -notin @($identity.Groups | ForEach-Object Value)){throw 'Relay must run under its exact restricted task identity.'}
Assert-PionCutover $state.relayIPv4
Assert-PionInstalledFiles $root
$key=Join-Path $root 'private/shared-key.txt'
$config=Join-Path $root 'private/relay-config.json'
Assert-PionSecretAcl $key $state.taskSid
Assert-PionSecretAcl $config $state.taskSid
$expected=Get-PionConfiguration $policy $state.role $state.relayIPv4 $key
Assert-PionConfigShape $expected ([IO.File]::ReadAllBytes($config))
$busy=@(Get-NetUDPEndpoint -ErrorAction Stop | Where-Object {$_.LocalPort -eq $role.udpPort -or ($_.LocalPort -ge $role.minPort -and $_.LocalPort -le $role.maxPort)})
if($busy.Count){throw 'Relay listener/media ports are already held; nothing is started.'}
& (Join-Path $root 'runtime/thornswood-turn.exe') -config $config
exit $LASTEXITCODE
