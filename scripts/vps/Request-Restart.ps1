<#
  Request-Restart.ps1

  Tells the live server to warn everybody and then clear them out, without
  needing to be standing in the world to type /restart.

  Drops a small json file into the server's data folder over ssh. The gamemode
  checks for it every tick and a half, acts on it, and deletes it, so a file
  left behind by a crash cannot fire again on the next boot.

    .\Request-Restart.ps1                     5 minutes, an update
    .\Request-Restart.ps1 -Minutes 10
    .\Request-Restart.ps1 -Mode restart -Why "a server rebuild"
    .\Request-Restart.ps1 -Cancel
    .\Request-Restart.ps1 -Mode restart -ThenRestart

  Only -Mode restart disconnects people, and it has to say which half is
  coming, and is refused outright without one of them. A kick with nothing
  restarting behind it leaves everybody who reconnects in an empty world with
  no NPCs, and they stay that way until the process is bounced, so the two are
  not separable.

    -ThenRestart     this script waits out the countdown and bounces it
    -RestartFollows  you are going to, or your caller is. Deploy-Server
                     passes this, because it stops and starts the task itself

  -Mode notice and -Mode update need neither, because they disconnect nobody:
  an update is a word in chat, and the launcher closes the game itself when
  it sees the pack. Ship.ps1 sends update.

  Mode decides the wording and whether anybody is put out.

    notice   the server is about to blink. A freeze of a few seconds, then
             everything carries on. Nobody is disconnected. This is what a
             server build push actually is.
    update   a pack has been published, so everyone has to quit to the
             launcher to pick it up. Ends with a kick.
    restart  the server itself is going down for longer. Ends with a kick.
#>
[CmdletBinding()]
param(
  [double]$Minutes = 5,
  [ValidateSet('notice','update','restart')]
  [string]$Mode = 'update',
  [string]$Why  = 'an update',
  [switch]$Cancel,
  # Wait out the countdown and then bounce the process, because the kick on its
  # own is what strands people in an empty world. See the block at the bottom.
  [switch]$ThenRestart,
  # For a caller that bounces the process itself, which Deploy-Server does. It
  # is the promise that the other half is coming; without one of these two a
  # mode that kicks is refused outright.
  [switch]$RestartFollows,
  [string]$Vps  = '',
  [string]$User = '',
  [string]$Data = 'C:/Thornswood-Server/data'
)


$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$ErrorActionPreference = 'Stop'   # before any file loads, so one that is missing stops here (#3006)
. (Join-Path $Here 'Vps.ps1')
if (-not $User) { $User = Get-ThornswoodVpsUser }
if (-not $Vps) { $Vps = Get-ThornswoodVpsAddress }
$ssh = @('-o','BatchMode=yes','-o','StrictHostKeyChecking=yes')

if ($ThenRestart -and $Cancel) { throw 'Use one or the other: -Cancel calls it off, -ThenRestart sees it through.' }
if ($ThenRestart -and $Mode -ne 'restart') {
  throw ('-Mode ' + $Mode + ' disconnects nobody, so there is nothing to restart afterwards. Drop -ThenRestart, or use -Mode restart.')
}

# The kick and the process restart are now inseparable, because separating them
# is the whole fault. A kick with nothing restarting behind it leaves everybody
# who reconnects in an empty world with no NPCs, and they stay there.
#
# Saying so at the end was not enough: it still let somebody kick the room and
# walk away. So a mode that disconnects people now has to say which half is
# coming. -ThenRestart means this script does it. -RestartFollows means the
# caller does, which is what Deploy-Server passes.
#
# Only restart kicks. An update has not kicked since 17 September: the server
# stays up, the launcher closes the game five minutes after it sees the pack.
# The first version of this guard refused update too, which refused Ship's
# own announcement on 20 September ("could not announce it").
if (-not $Cancel -and $Mode -eq 'restart' -and -not $ThenRestart -and -not $RestartFollows) {
  throw ('-Mode ' + $Mode + " ends in a kick, and a kick on its own strands everybody who " +
         'reconnects in an empty world with no NPCs. Add -ThenRestart to have this script bounce ' +
         'the process afterwards, or -RestartFollows if you are going to do it yourself. ' +
         'Use -Mode notice if you only meant to warn people, because that disconnects nobody.')
}

if ($Cancel) {
  $body = '{"cancel":true}'
  $what = 'cancelling'
} else {
  if ($Minutes -le 0) { throw 'Minutes has to be more than zero.' }
  $secs = [int][Math]::Round($Minutes * 60)
  $body = @{ seconds = $secs; mode = $Mode; why = $Why } | ConvertTo-Json -Compress
  $what = "$Mode in $Minutes min for $Why"
}

# Written through a base64 hop so quoting survives ssh, cmd and PowerShell.
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($body))
$remote = @"
`$ErrorActionPreference = 'Stop'
if (-not (Test-Path '$Data')) { New-Item -ItemType Directory -Path '$Data' -Force | Out-Null }
[IO.File]::WriteAllBytes((Join-Path '$Data' 'restart.json'),
                         [Convert]::FromBase64String('$b64'))
'dropped'
"@
$enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($remote))

$out = Invoke-ThornswoodNative { & ssh @ssh "$User@$Vps" "pwsh -NoProfile -EncodedCommand $enc" } 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Host "  could not reach the server to announce it: $out" -ForegroundColor Yellow
  exit 1
}

Write-Host "  server told: $what" -ForegroundColor Green

# The kick is only half of it, and the missing half is not obvious from here.
#
# 'update' and 'restart' both end in everybody being disconnected. A kick with
# no process restart behind it leaves the kicked character in a state where the
# reconnecting client is never sent the world: they come back to an empty
# Skyrim with no NPCs in it, and they stay that way until the process is
# bounced. gamemode.js records 13 reconnects like that on 17 September, and it
# was reported again on 20 September.
#
# Deploy-Server.ps1 calls this and then stops and starts the task, so that path
# was always whole. Running this by hand is where the half happens, so -ThenRestart
# sees it through and the bare call says what it is leaving undone.
# -Cancel calls the countdown off, so nothing was kicked and nothing is owed.
# It used to fall through here and announce a kick it had just prevented.
if ($Mode -eq 'restart' -and -not $Cancel) {
  if ($ThenRestart) {
    $wait = [int][Math]::Round($Minutes * 60) + 15   # the countdown, plus the tick that acts on it
    Write-Host ''
    Write-Host "  -ThenRestart: waiting $wait seconds for the countdown, then restarting the process." -ForegroundColor Cyan
    Write-Host '  Leave this window open. Ctrl+C stops the restart, not the kick.' -ForegroundColor DarkGray
    Start-Sleep -Seconds $wait
    $restart = Join-Path $PSScriptRoot 'Restart-Server.ps1'
    if (-not (Test-Path -LiteralPath $restart)) {
      Write-Host "  Restart-Server.ps1 is missing, so the process was NOT restarted." -ForegroundColor Red
      Write-Host '  Bounce it yourself or people will come back to an empty world.' -ForegroundColor Red
      exit 1
    }
    # -Now because the room was just cleared on purpose: the online check would
    # refuse on anybody who has already reconnected, which is exactly who this
    # is for.
    & $restart -Service game -Now -Vps $Vps -User $User -NoPause
    if ($LASTEXITCODE -ne 0) {
      Write-Host '  The restart did not go through. Run .\scripts\vps\Restart-Server.ps1 yourself.' -ForegroundColor Red
      exit 1
    }
    Write-Host '  kicked and restarted. Nobody is stranded.' -ForegroundColor Green
  } else {
    # -RestartFollows: the caller said it would bounce the process. Nothing to
    # do but say what is owed, so a half finished run is visible in the log.
    Write-Host ''
    Write-Host '  The kick is sent. The caller restarts the process; if it does not,' -ForegroundColor DarkGray
    Write-Host '  everybody who reconnects lands in an empty world. .\scripts\vps\Restart-Server.ps1' -ForegroundColor DarkGray
  }
}
