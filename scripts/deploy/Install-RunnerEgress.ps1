<#
  Install-RunnerEgress.ps1

  Puts the box runners' way out on the VPS (#5495): the proxy
  thornswood-agent.exe egress (tools\DeployAgent\Egress.cs,
  docs\DEPLOY-AGENT.md "The box runners' way out"), as the task
  "Thornswood Runner Egress", listening on loopback at the address
  records\runner-egress.json names. It was made for tw-hermes-box, which
  came off the box on 9 Nov 2026 (#5565); no runner goes through it since,
  and #5577 says whether it stays.

      .\scripts\deploy\Install-RunnerEgress.ps1           install it, or put the
                                                        newest agent and the
                                                        list in, and start it
      .\scripts\deploy\Install-RunnerEgress.ps1 -Status   what is there and its log
      .\scripts\deploy\Install-RunnerEgress.ps1 -Remove   take it off: the task,
                                                        its program and its folder,
                                                        then read each back

  From a cloud thread the deploy gate runs all three with main's script, the
  last as a verb of its own, since -Remove is never a gate word:

      pwsh scripts/vps/Box-Run.ps1 -Line 'Install-RunnerEgress'
      pwsh scripts/vps/Box-Run.ps1 -Line 'Install-RunnerEgress -Status'
      pwsh scripts/vps/Box-Run.ps1 -Line 'Remove-RunnerEgress'

  Remove-RunnerEgress was added on 9 Nov 2026 so the way out can come off
  from a cloud thread (#5577). It stops before sending anything while a
  runner record still sends a runner through it.

  WHY BY NAME. The runner accounts' rules decided by address, from GitHub's
  published lists. On 3 Nov 2026 GitHub gave tw-hermes-box the token host
  vstoken.actions.githubusercontent.com, on an edge address many Microsoft
  services share. The runner never came online, and a rule
  letting that address out would have let a job reach every one of them.
  Patrick chose to decide by name (3 Nov, #5495).

  THE PROGRAM. The deploy agent's own signed program, which
  Install-DeployAgent.ps1 put in C:\Thornswood-Agent and which updates
  itself from each signed Release. It is copied into -Root and held there
  to the launcher's own signature check (Signature.cs, for the signer
  launcher\app\Updater.cs names, both sent from this checkout) before the
  task is stopped. A newer agent reaches the proxy when this runs again.

  THE LIST. records\runner-egress.json's hosts, which GitHub documents for a
  self-hosted runner and the jobs' own downloads, and each runner record's
  allowHost (a records\*-runner.json with "egress": true). Its egress.json is written from
  this checkout and the proxy refuses a list it cannot hold to its rules
  (an address, a pattern wider than *.a.b, an empty list).

  WHAT IT RUNS AS. LOCAL SERVICE, Limited, with a SID of its own
  (NT TASK\Thornswood Runner Egress), like the game servers and the bridge
  (ServiceAccount.ps1, #2578): never SYSTEM. Its folder takes nothing from
  C:\: SYSTEM and Administrators, and the task's SID reading the program
  and the list and writing its logs, which it owns (thornswood-owner.exe,
  #4077). It is checked against the places no service may read before it is
  started, and left off when one is open or its folder cannot be given to it.

  THE CHECK. After the start it asks the proxy for github.com, which must
  answer 200, and for example.com, which must answer 403. Either wrong and
  this says STOP.

  Keep it ASCII: Windows PowerShell 5.1 at the far end reads what is sent as
  ANSI.
#>
[CmdletBinding()]
param(
    [string]$VpsHost  = '',
    [string]$VpsUser  = '',
    [string]$Root     = 'C:\Thornswood-Egress',
    [string]$Agent    = 'C:\Thornswood-Agent\thornswood-agent.exe',
    [string]$TaskName = 'Thornswood Runner Egress',
    [switch]$Status,
    [switch]$Remove,
    [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$RepoDir = (Resolve-Path (Join-Path $Here '..\..')).Path
. (Join-Path $Here '..\vps\Vps.ps1')
. (Join-Path $Here '..\vps\Send-Script.ps1')
. (Join-Path $Here 'ServiceAccount.ps1')
. (Join-Path $Here 'RunnerEgress.ps1')
if (-not $VpsUser) { $VpsUser = Get-ThornswoodVpsUser }
if (-not $VpsHost) { $VpsHost = Get-ThornswoodVpsAddress }

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Die($m) { Write-Host ''; Write-Host "STOP. $m" -ForegroundColor Red; if (-not $NoPause) { [void](Read-Host 'Enter to exit') }; exit 1 }

if ($Status -and $Remove) { Die '-Status and -Remove each do one thing, so pass one of them. Nothing was sent.' }
foreach ($p in $Root, $Agent) { if ($p -notmatch '^[A-Za-z]:\\[A-Za-z0-9._\\ -]+$') { Die "$p is not a plain path on the box. Nothing was sent." } }

# The address and the list, from this checkout.
try { $egress = Get-ThornswoodRunnerEgress $RepoDir } catch { Die ($_.Exception.Message + '. Nothing was sent.') }
$listen = $egress.Listen
$port = $egress.Port
$allow = @($egress.Allow)
foreach ($f in @(Get-ChildItem -LiteralPath (Join-Path $RepoDir 'records') -Filter '*-runner.json' -File)) {
    $r = Get-Content -LiteralPath $f.FullName -Raw | ConvertFrom-Json
    if ($r.egress) { $allow += @($r.allowHost | ForEach-Object { [string]$_ }) }
}
$allow = @($allow | ForEach-Object { $_.Trim().ToLowerInvariant() } | Where-Object { $_ } | Sort-Object -Unique)
foreach ($h in $allow) { if ($h -notmatch '^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$') { Die "the list holds $h, which is not a host name or *.<name>. Nothing was sent." } }
if (-not $allow.Count) { Die 'the list is empty. Nothing was sent.' }
$egressJson = ([ordered]@{ listen = $listen; allow = $allow; home = $Root } | ConvertTo-Json -Depth 3)
$egressB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($egressJson))

$target = "$VpsUser@$VpsHost"
$ssh = @('-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes')
function Remote($script) { return Invoke-ThornswoodRemote -Target $target -SshArgs $ssh -Script $script }

$exe = $Root.TrimEnd('\') + '\thornswood-agent.exe'
$log = $Root.TrimEnd('\') + '\logs\egress.log'

# Asks the proxy for a host and says its status line (RunnerEgress.ps1).
$askLib = Get-ThornswoodEgressAskScript

# ------------------------------------------------------------------ status --
if ($Status) {
    Remote ($askLib + @"
`$ErrorActionPreference = 'SilentlyContinue'
`$t = Get-ScheduledTask -TaskName '$TaskName'
if (`$t) { `$i = Get-ScheduledTaskInfo -TaskName '$TaskName'; 'task      ' + `$t.State + ' as ' + `$t.Principal.UserId + ', last ran ' + `$i.LastRunTime + ' result ' + `$i.LastTaskResult } else { 'task      NOT REGISTERED' }
if (Test-Path -LiteralPath '$exe') { 'program   ' + (& '$exe' version 2>&1) + ', the agent beside it ' + (& '$Agent' version 2>&1) } else { 'program   NOT THERE' }
`$cfg = Join-Path '$Root' 'egress.json'
if (Test-Path -LiteralPath `$cfg) { 'list      ' + @(([IO.File]::ReadAllText(`$cfg) | ConvertFrom-Json).allow).Count + ' host rule(s)' }
'ask       github.com: ' + (Ask-Egress $port 'github.com')
'ask       example.com: ' + (Ask-Egress $port 'example.com')
if (Test-Path -LiteralPath '$log') { '--- egress.log, last 30 ---'; Get-Content -LiteralPath '$log' -Tail 30 } else { 'log       none yet' }
"@) | ForEach-Object { Say "  $_" }
    exit 0
}

# ------------------------------------------------------------------ remove --
if ($Remove) {
    # A runner still sent through it would reach nothing once it is off, so none may be.
    $sent = @(Get-ChildItem -LiteralPath (Join-Path $RepoDir 'records') -Filter '*-runner.json' -File | Where-Object { (Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json).egress })
    if ($sent.Count) { Die ('runner record(s) ' + (($sent | ForEach-Object { $_.Name }) -join ', ') + ' still send a runner through it. Nothing was sent.') }
    $out = @(Remote @"
`$ErrorActionPreference = 'SilentlyContinue'
function Mine { @(Get-CimInstance Win32_Process -Filter "Name='thornswood-agent.exe'" | Where-Object { ('' + `$_.ExecutablePath) -ieq '$exe' }) }
Stop-ScheduledTask -TaskName '$TaskName'
Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false
foreach (`$p in Mine) { Stop-Process -Id `$p.ProcessId -Force; Wait-Process -Id `$p.ProcessId -Timeout 20 }
if (Test-Path -LiteralPath '$Root') { Remove-Item -LiteralPath '$Root' -Recurse -Force }
if (Get-ScheduledTask -TaskName '$TaskName') { 'task      STILL THERE' } else { 'task      NOT REGISTERED' }
if ((Mine).Count) { 'program   STILL RUNNING' } else { 'program   not running' }
if (Test-Path -LiteralPath '$Root') { 'folder    STILL THERE: ' + ((Get-ChildItem -LiteralPath '$Root' -Recurse -Force | Select-Object -First 5 | ForEach-Object { `$_.FullName }) -join ', ') } else { 'folder    $Root NOT THERE' }
if (Get-NetTCPConnection -State Listen -LocalPort $port) { 'port      $port STILL LISTENED ON' } else { 'port      nothing listens on $port' }
"@ | ForEach-Object { Say "  $_"; "$_".Trim() })
    if (-not $out.Count -or @($out | Where-Object { $_ -match 'STILL' }).Count) { Die 'the way out is not all off. The lines above say what is left.' }
    Say "  REMOVED the runners' way out: its task, program and folder are off the box." 'Green'
    exit 0
}

# ----------------------------------------------------------------- install --
$updater = [IO.File]::ReadAllText((Join-Path $RepoDir 'launcher\app\Updater.cs'))
$m = [regex]::Match($updater, 'ExpectedSigner\s*=\s*"([^"]+)"')
if (-not $m.Success) { Die 'ExpectedSigner is not in launcher\app\Updater.cs. Nothing was sent.' }
$signer = $m.Groups[1].Value.Trim()
if ($signer -notmatch '^[A-Za-z0-9 .,-]+$') { Die 'ExpectedSigner holds characters this script will not send. Nothing was sent.' }
$sigCs = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $RepoDir 'launcher\app\Signature.cs')))
$svcLib = Get-ThornswoodServiceAccountScript

Say "Putting the runners' way out on $VpsHost, $($allow.Count) host rule(s), on $listen..." Cyan
$out = @(Remote ($svcLib + $askLib + @"
`$ErrorActionPreference = 'Stop'
`$root = '$Root'
`$exe = '$exe'
`$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
`$stage = Join-Path `$root ('.stage-' + `$stamp)
function Refuse([string]`$why) { 'REFUSED: ' + `$why + '. Nothing was stopped or changed.'; if (Test-Path -LiteralPath `$stage) { Remove-Item -LiteralPath `$stage -Recurse -Force }; exit 1 }

if (-not (Test-Path -LiteralPath '$Agent')) { Refuse ('there is no deploy agent at $Agent; Install-DeployAgent puts it there first') }
if (Get-NetTCPConnection -State Listen -LocalPort $port -EA SilentlyContinue | Where-Object { -not (Get-ScheduledTask -TaskName '$TaskName' -EA SilentlyContinue) }) { Refuse ('something that is not the proxy listens on port $port') }

# The folder: nothing from C:\, SYSTEM and Administrators only until the task's SID is given its part.
if (-not (Test-Path -LiteralPath `$root)) { New-Item -ItemType Directory -Path `$root | Out-Null }
& icacls.exe `$root /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
if (`$LASTEXITCODE -ne 0) { Refuse ('icacls could not set the rules on ' + `$root) }
New-Item -ItemType Directory -Force -Path `$stage | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path `$root 'logs') | Out-Null

# The agent's program, copied and held to the launcher's own check.
`$new = Join-Path `$stage 'thornswood-agent.exe'
Copy-Item -LiteralPath '$Agent' -Destination `$new
`$src = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('$sigCs'))
`$sha = [Security.Cryptography.SHA256]::Create()
`$hash = -join (`$sha.ComputeHash([Text.Encoding]::UTF8.GetBytes(`$src)) | Select-Object -First 8 | ForEach-Object { `$_.ToString('x2') })
`$ns = 'ThornswoodSign' + `$hash
if (-not ((`$ns + '.Signature') -as [type])) { Add-Type -TypeDefinition ([regex]::Replace(`$src, '(?m)^namespace Thornswood\s*`$', ('namespace ' + `$ns))) -Language CSharp }
`$t = (`$ns + '.Signature') -as [type]
`$said = ''
`$why = `$t::Refusal(`$new, '$signer', [ref]`$said)
if (`$why) { Refuse ('the agent''s program ' + `$why) }
`$version = [string](& `$new version 2>&1)
'signed: thornswood-agent ' + `$version
[IO.File]::WriteAllText((Join-Path `$stage 'egress.json'), [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('$egressB64')), (New-Object Text.UTF8Encoding(`$false)))
# The list held to the proxy's own rules before anything stops.
`$check = @(& `$new egress-check --config (Join-Path `$stage 'egress.json') 2>&1 | ForEach-Object { "`$_" })
if (`$LASTEXITCODE -ne 0) { Refuse ('the proxy would not take the list: ' + (`$check -join ' ')) }
'list      ' + (`$check -join ' ')

# The task: stopped, the files swapped in, registered as LOCAL SERVICE.
Stop-ScheduledTask -TaskName '$TaskName' -EA SilentlyContinue
foreach (`$p in @(Get-CimInstance Win32_Process -Filter "Name='thornswood-agent.exe'" -EA SilentlyContinue | Where-Object { ('' + `$_.ExecutablePath) -ieq `$exe })) { Stop-Process -Id `$p.ProcessId -Force -EA SilentlyContinue }
Start-Sleep -Seconds 1
Move-Item -LiteralPath `$new -Destination `$exe -Force
Move-Item -LiteralPath (Join-Path `$stage 'egress.json') -Destination (Join-Path `$root 'egress.json') -Force
Remove-Item -LiteralPath `$stage -Recurse -Force
`$action = New-ScheduledTaskAction -Execute `$exe -Argument ('egress --config "' + (Join-Path `$root 'egress.json') + '"') -WorkingDirectory `$root
`$trigger = New-ScheduledTaskTrigger -AtStartup
`$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName '$TaskName' -Action `$action -Trigger `$trigger -Settings `$settings -Principal (New-ThornswoodServicePrincipal) -Force | Out-Null
`$sid = Get-ThornswoodTaskSid '$TaskName'
if (-not `$sid) { Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false; Refuse 'Windows gave the task no SID of its own, so it was taken off again' }
try {
  Grant-ThornswoodServiceFolder -Root `$root -Sid `$sid -Writable @('logs') | ForEach-Object { 'rules     ' + `$_ }
  # What it makes is its own, not every service's (#4077).
  Set-ThornswoodTaskOwner -TaskName '$TaskName' -Sid `$sid -Roots `$root | ForEach-Object { 'owner     ' + `$_ }
} catch { Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false; 'REFUSED: its folder could not be given to it (' + `$_.Exception.Message + '), so the task was taken off again; it never runs as SYSTEM'; exit 1 }
`$open = @(Test-ThornswoodServiceCannotReach -Paths (Get-ThornswoodServiceNeverReach -Own `$root) -Sids @(`$sid))
if (`$open.Count) { Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false; `$open | ForEach-Object { 'OPEN      ' + `$_ }; 'REFUSED: LOCAL SERVICE could read what no service may, so the task was taken off again'; exit 1 }
Start-ScheduledTask -TaskName '$TaskName'
`$deadline = (Get-Date).AddSeconds(20)
do { Start-Sleep -Milliseconds 500; `$up = Get-NetTCPConnection -State Listen -LocalAddress 127.0.0.1 -LocalPort $port -EA SilentlyContinue } while (-not `$up -and (Get-Date) -lt `$deadline)
`$a = Ask-Egress $port 'github.com'
`$b = Ask-Egress $port 'example.com'
'ask       github.com: ' + `$a
'ask       example.com: ' + `$b
if (`$a -match ' 200 ' -and `$b -match ' 403 ') { 'EGRESS OK' } else { if (Test-Path -LiteralPath '$log') { Get-Content -LiteralPath '$log' -Tail 10 | ForEach-Object { 'log       ' + `$_ } }; 'EGRESS NOT ANSWERING AS IT SHOULD' }
"@) | ForEach-Object { Say "  $_"; "$_".Trim() })
if ($out -notcontains 'EGRESS OK') { Die 'the proxy is not answering as it should. The lines above say where it stopped.' }
Say '  The runners'' way out is up.' 'Green'
exit 0
