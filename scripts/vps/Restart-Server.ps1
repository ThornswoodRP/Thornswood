<#
.SYNOPSIS
  Restarts a Thornswood service on the VPS. Nothing is copied and nothing is
  built: this only stops it and starts it again.

.DESCRIPTION
  There was no script for this. Deploy-Server.ps1 redeploys the binary and
  Request-Restart.ps1 warns people without restarting anything, so the only way
  to plainly bounce a service was raw ssh with a hand written command. That is
  how the live server sat for ten hours on 18 September with no private folder:
  the fix was one restart and there was nothing to run.

  It refuses while people are online unless you say -Now, because a restart
  reads from a chair as the world freezing and then everything carrying on.
  Check first, then decide, rather than finding out afterwards.

  The game and dev servers' restart is said in Discord first (#5784): with
  nobody on, Request-Restart.ps1 says it (#updates for the live server, the
  dev updates channel for dev) a minute ahead and this waits the minute out,
  and once the server is started again the notice says it is back. -Now
  says nothing ahead; a restart Request-Restart -ThenRestart counted down
  was said by it, and is said to be back here.

.PARAMETER Service
  Which one. game, dev, docs, voice or bot.

.PARAMETER Now
  Skip the online check. Use it when you already know the room is empty, or
  when the thing being restarted is broken enough that waiting costs more.

.EXAMPLE
  .\Restart-Server.ps1
  Restarts the live game server, refusing if anybody is connected.

.EXAMPLE
  .\Restart-Server.ps1 -Service dev -Now
#>
[CmdletBinding()]
param(
  [ValidateSet('game', 'dev', 'docs', 'voice', 'bot')]
  [string]$Service = 'game',
  [string]$Vps  = '',
  [string]$User = '',
  [switch]$Now,
  [switch]$NoPause
)


$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$ErrorActionPreference = 'Stop'   # before any file loads, so one that is missing stops here (#3006)
. (Join-Path $Here 'Vps.ps1')
. (Join-Path $Here 'Send-Script.ps1')
# The hold the restart writes while the service is stopped (#5155).
. (Join-Path $Here 'ServerHold.ps1')
# The restart said in Discord (#5784).
. (Join-Path $Here 'RestartNotice.ps1')
if (-not $User) { $User = Get-ThornswoodVpsUser }
if (-not $Vps) { $Vps = Get-ThornswoodVpsAddress }
$ssh = @('-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes')

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) {
  Write-Host ''
  Write-Host $m -ForegroundColor Cyan
  Write-Host ('-' * $m.Length) -ForegroundColor DarkGray
}
function Die($m) {
  Write-Host ''
  Write-Host "STOP. $m" -ForegroundColor Red
  if (-not $NoPause) { [void](Read-Host 'Enter to exit') }
  exit 1
}

# Progress stays quiet, or a bar from the far side comes back as lines mixed
# in with the state this prints. The send itself is Send-Script.ps1 (issue
# #1166, the same way as #1070): a long script goes by scp and its run takes
# it off the box before it runs, and the far side's exit code comes back.
function Remote($script) {
  $script = "`$ProgressPreference = 'SilentlyContinue'`r`n" + $script
  return Invoke-ThornswoodRemote -Target "$User@$Vps" -SshArgs $ssh -Script $script
}

$map = @{
  game  = @{ Task = 'Thornswood Server';     Root = 'C:\Thornswood-Server';     Port = 3000 }
  dev   = @{ Task = 'Thornswood Dev Server'; Root = 'C:\Thornswood-Server-Dev'; Port = 7788 }
  docs  = @{ Task = 'Thornswood Docs';       Root = 'C:\Thornswood-Docs';       Port = 0 }
  voice = @{ Task = 'Thornswood Voice';      Root = 'C:\Thornswood-Voice';      Port = 0 }
  # A Windows service since issue #465, restarted by its name.
  bot   = @{ Svc  = 'ThornswoodBot';         Root = 'C:\Thornswood-Bot';        Port = 0 }
}
$it = $map[$Service]

Write-Host ''
Write-Host "  THORNSWOOD  -  restarting $Service" -ForegroundColor White
if ($it.Svc) { Say "  service $($it.Svc)" 'DarkGray' } else { Say "  task $($it.Task)" 'DarkGray' }

# ------------------------------------------------------------- who is on ----
if (-not $Now -and $it.Port -gt 0) {
  Head 'Who is online'
  $n = -1
  try {
    $r = Invoke-WebRequest -Uri ("http://{0}:{1}/online.json" -f $Vps, $it.Port) `
                           -TimeoutSec 15 -UseBasicParsing
    $n = [int](($r.Content | ConvertFrom-Json).now)
  } catch {
    Say '  could not read online.json, so this is treated as unknown' 'Yellow'
  }
  if ($n -gt 0) {
    Say "  $n online." 'Yellow'
    Die "They would be dropped. Warn them with Request-Restart.ps1, or pass -Now."
  }
  elseif ($n -eq 0) { Say '  nobody is online' 'Green' }
}

# ------------------------------------------------------------- said first ---
# A game server's restart is said in Discord a minute ahead and the minute
# waited out (#5784). Nobody is on, or this stopped above.
if (-not $Now -and $it.Port -gt 0) {
  Head 'Saying it in Discord'
  & (Join-Path $Here 'Request-Restart.ps1') -Minutes 1 -Mode notice -Why 'a restart' -Vps $Vps -User $User `
    -Data ($it.Root.Replace('\', '/') + '/data') -RestartFollows
  if ($LASTEXITCODE -ne 0) { Die 'Discord could not be told, so nothing was restarted. Run this again, or pass -Now to restart without saying so.' }
  Say '  said; waiting the minute out' 'Green'
  Start-Sleep -Seconds 75
}

# ------------------------------------------------------------- the bounce ---
Head 'Restarting'
if ($it.Svc) {
  $out = Remote @"
if (-not (Get-Service -Name '$($it.Svc)' -EA SilentlyContinue)) { 'NO SUCH SERVICE: $($it.Svc)'; return }
$(Get-ThornswoodHoldScript -Script 'Restart-Server.ps1')
# Held from the stop to the start (#5155, ServerHold.ps1), so the watchdog leaves it.
Set-ThornswoodHold -Target '$($it.Svc)' -Why 'restarting it' -By `$HoldBy
try { Restart-Service -Name '$($it.Svc)' -Force -ErrorAction Stop } catch { 'COULD NOT RESTART: ' + `$_.Exception.Message }
Clear-ThornswoodHold -Target '$($it.Svc)'
Start-Sleep -Seconds 12
'state ' + (Get-Service -Name '$($it.Svc)').Status
"@
  $out | ForEach-Object { Say "  $_" }
  if ("$out" -match 'NO SUCH SERVICE') { Die "There is no service called $($it.Svc) on the VPS. Install-Bot.ps1 puts it there." }
} else {
  $out = Remote ($ThornswoodRestartNoticeText + @"
$(Get-ThornswoodHoldScript -Script 'Restart-Server.ps1')
# Held from the stop to the start (#5155, ServerHold.ps1), so the watchdog leaves it.
Set-ThornswoodHold -Target '$($it.Task)' -Why 'restarting it' -By `$HoldBy
Stop-ScheduledTask -TaskName '$($it.Task)' -EA SilentlyContinue
Start-Sleep -Seconds 4
Start-ScheduledTask -TaskName '$($it.Task)' -EA SilentlyContinue
Clear-ThornswoodHold -Target '$($it.Task)'
# A restart said to be coming in Discord is said to be over (#5784): back
# once the resources port takes a connection, the swap's own sign, within the
# 170 seconds every swap gives a started server (ServerReadyWait.ps1);
# otherwise down, which the watchdog then takes up.
if ($($it.Port) -gt 0) {
  `$until = (Get-Date).AddSeconds(170)
  `$up = `$false
  while (-not `$up -and (Get-Date) -lt `$until) {
    `$c = New-Object Net.Sockets.TcpClient
    try { `$c.Connect('127.0.0.1', $($it.Port)); `$up = `$true } catch { Start-Sleep -Seconds 2 } finally { `$c.Dispose() }
  }
  if (`$up) { Set-ThornswoodRestartNotice -Root '$($it.Root)' -State back }
  else { Set-ThornswoodRestartNotice -Root '$($it.Root)' -State down }
}
Start-Sleep -Seconds 12
`$t = Get-ScheduledTask -TaskName '$($it.Task)' -EA SilentlyContinue
if (`$t) { 'state ' + `$t.State } else { 'NO SUCH TASK: $($it.Task)' }
"@)
  $out | ForEach-Object { Say "  $_" }
  if ("$out" -match 'NO SUCH TASK') { Die "There is no scheduled task called $($it.Task) on the VPS." }
}

# ------------------------------------------------------------- did it come back
Head 'What it said on the way up'
Remote @"
foreach (`$n in 'server.log', 'voice.log', 'docs.log', 'data\bot.log') {
  `$p = Join-Path '$($it.Root)' `$n
  if (Test-Path `$p) { Get-Content `$p -Tail 8 -EA SilentlyContinue }
}
"@ | Select-Object -Last 10 | ForEach-Object { Say "  $_" }

if ($it.Port -gt 0) {
  Head 'Answering again'
  try {
    $r = Invoke-WebRequest -Uri ("http://{0}:{1}/online.json" -f $Vps, $it.Port) `
                           -TimeoutSec 20 -UseBasicParsing
    Say "  http $($r.StatusCode) on $($it.Port), $($r.Content)" 'Green'
  } catch {
    Say "  nothing on $($it.Port) yet. Give it a moment, then check again." 'Yellow'
  }
}

Write-Host ''
if (-not $NoPause) { [void](Read-Host 'Enter to close') }
