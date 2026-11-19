# #6561: Run actual guard functions against an isolated fake scheduler/health API.
# No script top-level body, real service, file secret, network or task executes.
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Windows.ps1')
. (Join-Path $PSScriptRoot '../scripts/turn/PionHost.ps1')
. (Join-Path $PSScriptRoot '../scripts/deploy/ServiceAccount.ps1')
$source=Join-Path $PSScriptRoot '../scripts/turn/Switch-DevTurnRelay.ps1'
$tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Transaction source does not parse.'}
foreach($f in $ast.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst]},$true)){
 if($f.Name -in 'DevClear','DevTask','StopDev','WaitDevStopped','MainSnapshot','AssertMain') {Invoke-Expression $f.Extent.Text}
}
$pass=0;$fail=0
function Yes($n,[bool]$ok){if($ok){$script:pass++;Write-Host "PASS  $n"}else{$script:fail++;Write-Host "FAIL  $n"}}
function Refuses($n,[scriptblock]$a){$no=$false;try{& $a | Out-Null}catch{$no=$true};Yes $n $no}
$ExpectedDevCommit='a'*40;$taskName='fixture';$voiceSid='S-1-5-87-1-2-3-4-5'
$health=[pscustomobject]@{ok=$true;bind='127.0.0.1';auth='on';turn='ephemeral';peers=0;people=0;tracked=0;deploy=[pscustomobject]@{commit=$ExpectedDevCommit};startedAt='unchanged'}
$script:turnOwner=@{path='C:/fixture/thornswood-owner-123456789abc.exe';sha256=('c'*64)}
function Get-PionOwnerIdentity {return $script:turnOwner}
$voiceRoot=Join-Path ([IO.Path]::GetTempPath()) 'fixture-dev-voice'
$fixtureShell=if($OnWindows){Get-WindowsPath 'System32/cmd.exe'}else{Join-Path ([IO.Path]::GetTempPath()) 'fixture-command-interpreter.exe'}
function Get-PionCommandInterpreter {return $script:fixtureShell}
$fixtureNode=Join-Path ([IO.Path]::GetTempPath()) 'fixture-node.exe'
function Get-Command {return [pscustomobject]@{Source=$script:fixtureNode}}
$cmd='/c "set THORNSWOOD_SITE=http://127.0.0.1:3001&& set THORNSWOOD_VOICE_PORT=7789&& set THORNSWOOD_VOICE_BIND=127.0.0.1&& set THORNSWOOD_VOICE_AUTH=on&& set THORNSWOOD_CHAT_RANGE=4000&& set THORNSWOOD_TURN_URL=turn:fixture.invalid:3478&&  start "" /b /wait /high "'+$fixtureNode+'" "'+(Join-Path $voiceRoot 'server-log.js')+'" --log "'+(Join-Path $voiceRoot 'voice.log')+'" --days 90 --stamp voice-server.js & call exit %^errorlevel%"'
$task=[pscustomobject]@{Principal=[pscustomobject]@{UserId='S-1-5-19';RunLevel='Limited';ProcessTokenSidType='Unrestricted';RequiredPrivilege=@('SeChangeNotifyPrivilege')};Actions=@([pscustomobject]@{Execute=$script:turnOwner.path;Arguments=$voiceSid+' "'+$fixtureShell+'" '+$cmd;WorkingDirectory=$voiceRoot})}
function Health($port){return $script:health}
function Get-ScheduledTask {return $script:task}
$script:disabled=0;$script:enabled=0;$script:stopped=0;$script:listenerCount=1
function Disable-ScheduledTask {$script:disabled++}
function Enable-ScheduledTask {$script:enabled++}
function Stop-ScheduledTask {$script:stopped++;$script:listenerCount=0}
function Get-NetTCPConnection {for($i=0;$i -lt $script:listenerCount;$i++){[pscustomobject]@{OwningProcess=10000+$i}}}
$script:processStart=[DateTime]'2026-01-01T00:00:00Z'
function Get-Process {param($Id);if($script:listenerCount){return [pscustomobject]@{StartTime=$script:processStart}};return $null}
Yes 'exact drained authenticated Dev source is admitted' ((DevClear).peers -eq 0)
$health.peers=1;Refuses 'any live peer blocks a Dev restart' {DevClear};$health.peers=0
$health.people=1;Refuses 'an in-world profile blocks a Dev restart' {DevClear};$health.people=0
$health.tracked=1;Refuses 'a tracked profile outside voice blocks a Dev restart' {DevClear};$health.tracked=0
$AllowChatOnlyMaintenance=$true;$health.peers=1
Yes 'explicit maintenance permits unplaced signaling sockets' ((DevClear).peers -eq 1)
$health.people=1;Refuses 'maintenance never overrides occupied voice places' {DevClear};$health.people=0
$health.tracked=1;Refuses 'maintenance never overrides tracked players' {DevClear};$health.tracked=0;$health.peers=0;$AllowChatOnlyMaintenance=$false
$health.deploy.commit='b'*40;Refuses 'stale source cannot cross the transaction guard' {DevClear};$health.deploy.commit=$ExpectedDevCommit
$health.auth='off';Refuses 'missing native authorization blocks rotation' {DevClear};$health.auth='on'
Yes 'existing restricted task owner is preserved' ((DevTask).Principal.UserId -eq 'S-1-5-19')
$task.Principal.UserId='SYSTEM';Refuses 'SYSTEM task is never accepted as a fallback' {DevTask};$task.Principal.UserId='S-1-5-19'
$originalDirectory=$task.Actions[0].WorkingDirectory;$task.Actions[0].WorkingDirectory='another-role';Refuses 'another role working directory' {DevTask};$task.Actions[0].WorkingDirectory=$originalDirectory
$original=$task.Actions[0].Arguments;$task.Actions[0].Arguments=$original+' THORNSWOOD_TURN_SECRET=fixture';Refuses 'credential-bearing task action is refused' {DevTask};$task.Actions[0].Arguments=$original
$task.Actions[0].Arguments=$original.Replace('&&  start','&& set THORNSWOOD_SITE=http://127.0.0.1:3000&&  start');Refuses 'duplicate overridden environment binding' {DevTask};$task.Actions[0].Arguments=$original
StopDev
Yes 'one drained owned listener is stopped exactly once' ($script:disabled -eq 1 -and $script:stopped -eq 1 -and $script:enabled -eq 0)
$script:disabled=0;$script:stopped=0;$script:enabled=0;$health.peers=1
Refuses 'peer arriving before stop causes a refusal' {StopDev}
Yes 'busy refusal reenables the unchanged original task and never stops it' ($script:disabled -eq 1 -and $script:enabled -eq 1 -and $script:stopped -eq 0)
$health.peers=0;$script:disabled=0;$script:enabled=0;$script:listenerCount=2
Refuses 'ambiguous listener causes a refusal before stop' {StopDev}
Yes 'ambiguous-listener refusal restores original task admission' ($script:enabled -eq 1 -and $script:stopped -eq 0)
$script:listenerCount=1
$before=MainSnapshot
AssertMain $before
Yes 'unchanged Main observation is accepted without actions' ($script:stopped -eq 0)
$health.startedAt='wallclock drift';AssertMain $before;Yes 'derived health timestamp drift cannot masquerade as a restart' $true
$script:processStart=$script:processStart.AddSeconds(1);Refuses 'actual Main process start change is detected' {AssertMain $before}
Write-Host "$pass passed, $fail failed";if($fail){exit 1}
