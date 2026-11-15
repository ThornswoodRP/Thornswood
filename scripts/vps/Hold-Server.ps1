<#
  Hold-Server.ps1

      .\scripts\vps\Hold-Server.ps1 -Service game -Why "swapping the merchant ledger"
      .\scripts\vps\Hold-Server.ps1 -Service game -Why "swapping the merchant ledger" -Minutes 60
      .\scripts\vps\Hold-Server.ps1 -Service game -Clear
      .\scripts\vps\Hold-Server.ps1 -List

  Holds a server on the box stopped on purpose, so the watchdog leaves it
  alone (#5155). For a stop by hand, in a run note: hold it here first, stop
  it, do the work, start it, and take the hold away here. The scripts that
  stop a server on purpose (the deploys, the installs, Restart-Server,
  Reset-Character, Wipe-Saves) write and take away their own hold; this is
  the same hold, ServerHold.ps1, for everything else.

  From a cloud thread, which has no key to the box, the same through the
  deploy gate (it runs this script of main on the box; the why is held to the
  gate's text rule, so letters, digits and . , : ; ' ( ) ! ? _ + - only):

      pwsh scripts/vps/Box-Run.ps1 -Line 'Hold-Server -Service game -Why "swapping the merchant ledger"'
      pwsh scripts/vps/Box-Run.ps1 -Line 'Hold-Server -Service game -Clear'
      pwsh scripts/vps/Box-Run.ps1 -Line 'Hold-Server -List'

  A hold says who, why and until when: 30 minutes unless -Minutes says, 2
  hours at most. While it runs the watchdog (Watch-Services.ps1, every five
  minutes) neither starts that server nor tells anybody it is down. When it
  runs out the watchdog takes it away, says once in #staff-updates who held it
  and why, and starts the server. So a hold nobody takes away costs at most
  its own length, and is said.

  -Service is the server by its short name:
    game       the live game server      Thornswood Server
    dev        the dev game server       Thornswood Dev Server
    voice      live voice                Thornswood Voice
    devvoice   dev voice                 Thornswood Dev Voice
    site       the website's app         Thornswood Docs
    caddy      Caddy, the website's 443  Thornswood Web
    bridge     the ssh bridge            Thornswood Bridge
    tunnel     the Cloudflare tunnel     Thornswood Tunnel
    bot        the Discord bot           ThornswoodBot (its service)
    gate       the deploy gate           Thornswood Gate
    admin      the admin service         Thornswood Admin

  It changes nothing but the hold file in C:\Thornswood-Watch\holds on the
  box: it stops and starts nothing itself.
#>
[CmdletBinding()]
param(
  [ValidateSet('game', 'dev', 'voice', 'devvoice', 'site', 'caddy', 'bridge', 'tunnel', 'bot', 'gate', 'admin')]
  [string]$Service = '',
  [string]$Why = '',
  [int]$Minutes = 30,
  [switch]$Clear,
  [switch]$List,
  [string]$Vps  = '',
  [string]$User = '',
  [switch]$NoPause
)

$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$ErrorActionPreference = 'Stop'   # before any file loads, so one that is missing stops here (#3006)
. (Join-Path $Here 'Vps.ps1')
. (Join-Path $Here 'Send-Script.ps1')
. (Join-Path $Here 'ServerHold.ps1')

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Die($m) {
  Write-Host ''
  Write-Host "STOP. $m" -ForegroundColor Red
  if (-not $NoPause) { [void](Read-Host 'Enter to exit') }
  exit 1
}

# The names the watchdog knows each one by: its task, or the bot's service.
$targets = [ordered]@{
  game = 'Thornswood Server'; dev = 'Thornswood Dev Server'
  voice = 'Thornswood Voice'; devvoice = 'Thornswood Dev Voice'
  site = 'Thornswood Docs'; caddy = 'Thornswood Web'; bridge = 'Thornswood Bridge'; tunnel = 'Thornswood Tunnel'
  bot = 'ThornswoodBot'; gate = 'Thornswood Gate'; admin = 'Thornswood Admin'
}

if (-not $List -and -not $Service) { Die 'Say which server with -Service (game, dev, voice, devvoice, site, caddy, bridge, tunnel, bot, gate or admin), or -List to see the holds. Nothing was sent.' }
if (-not $List -and -not $Clear -and -not "$Why".Trim()) { Die 'Say why with -Why, in a few words staff will read if the hold runs out. Nothing was sent.' }
if ($Minutes -lt 1 -or $Minutes -gt $ThornswoodHoldMost) { Die "-Minutes is 1 to $ThornswoodHoldMost. Nothing was sent." }

if (-not $User) { $User = Get-ThornswoodVpsUser }
if (-not $Vps) { $Vps = Get-ThornswoodVpsAddress }
$ssh = @('-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes')
$q = { param($s) "'" + ([string]$s).Replace("'", "''") + "'" }

$body = Get-ThornswoodHoldScript -Script 'Hold-Server.ps1'
if ($List) { $body += 'Get-ThornswoodHolds' }
elseif ($Clear) { $body += 'Clear-ThornswoodHold -Target ' + (& $q $targets[$Service]) }
else { $body += 'Set-ThornswoodHold -Target ' + (& $q $targets[$Service]) + ' -Why ' + (& $q "$Why".Trim()) + ' -By $HoldBy -Minutes ' + $Minutes }

$out = @(Invoke-ThornswoodRemote -Target "$User@$Vps" -SshArgs $ssh -Script $body)
$bad = $false
foreach ($l in $out) {
  $c = 'Gray'
  if ("$l" -match '^(held|released)') { $c = 'Green' }
  if ("$l" -match '^(NO HOLD|HOLD LEFT)') { $c = 'Red'; $bad = $true }
  Say "  $l" $c
}
if (-not $out.Count) { $bad = $true; Say '  the box said nothing back' 'Red' }
Write-Host ''
if (-not $NoPause) { [void](Read-Host 'Enter to close') }
if ($bad) { exit 1 }
exit 0
