# Runs only as the canonical task identity after the active-source cutover gate.
# No secret is passed on the command line or printed to this stream.
[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'CoturnHost.ps1')
. (Join-Path $PSScriptRoot 'CoturnPolicy.ps1')
$state=Get-Content -LiteralPath (Join-Path $root 'relay.json') -Raw | ConvertFrom-Json
$policy=Get-Content -LiteralPath (Join-Path $root 'relay-policy.json') -Raw | ConvertFrom-Json
$role=$policy.roles.($state.role)
if($state.role -notin 'dev','main'){throw 'Invalid relay role.'}
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
if($identity.User.Value -ne 'S-1-5-19' -or $state.taskSid -notin @($identity.Groups | ForEach-Object Value)){throw 'Relay must run under its exact restricted task identity.'}
Assert-CoturnCutover $state.relayIPv4
Assert-CoturnInstalledFiles $root
$options=@(Get-CoturnPublicOptions $policy $state.role $state.relayIPv4)
$config=Join-Path $root 'private/turnserver.conf'
Assert-CoturnSecretAcl $config $state.taskSid
Assert-CoturnConfigShape -Options $options -Bytes ([IO.File]::ReadAllBytes($config))
$busy=@(Get-NetUDPEndpoint -ErrorAction Stop | Where-Object {$_.LocalPort -eq $role.udpPort -or ($_.LocalPort -ge $role.minPort -and $_.LocalPort -le $role.maxPort)})
if($busy.Count){throw 'The relay listener/media ports are already held; nothing is started.'}
# Explicit public binding/auth/limits remain on argv even if the native
# config reader ever regresses. The secret is only in the protected file.
$nativeArguments=@('-c','turnserver.conf')+@($options | Where-Object {$_ -notmatch '^(pidfile|log-file)='} | ForEach-Object {'--'+$_})
$nativeArguments+=@('--log-file=stdout','--pidfile=../logs/relay.pid')
Set-Location -LiteralPath (Join-Path $root 'private')
& (Join-Path $root 'runtime/bin/turnserver.exe') @nativeArguments
exit $LASTEXITCODE
