<#
  Rotate-ServerPassword.ps1

  Changes the server password and hands the new one to the site, so the
  launcher can fetch it after checking Discord.

  This is what makes a ban stick. Someone removed from the Discord cannot get a
  new password, but they still have the last one, so after a ban you rotate and
  their copy stops connecting.

    .\Rotate-ServerPassword.ps1
    .\Rotate-ServerPassword.ps1 -Password      asks for one you chose, not shown
    .\Rotate-ServerPassword.ps1 -Minutes 10 -Why 'a ban'

  From a cloud session, or any machine with no key to the box, the deploy
  gate's Rotate-ServerPassword verb runs it on the box with -Yes and a
  password it makes (#2862); -Password, which asks, stays off the gate:

    pwsh scripts/vps/Box-Run.ps1 -Line 'Rotate-ServerPassword'

  READ THIS FIRST. It used to also write the password into the game server's
  settings and restart it, and that step was always a lie. SkyMP has no join
  password: there is no sPassword in server-settings.json, nothing in
  gamemode.js reads one, and the field only exists in the launcher's config
  because the old multiplayer mod had a join screen and SkyMP does not.

  So what this actually changes is which password the SITE hands out, and that
  is all it changes. The game server itself is open to anyone who knows the
  address and port, with or without this. The thing that will close it is a
  check in gamemode.js on connect, and that does not exist yet.

  Which means this is still worth running after a ban, because it stops a
  removed person's launcher from getting a live answer out of the site. It is
  not a door, it is a bolt on one door out of two.

  What it does, in order:

    1. Makes a new password, or asks for yours without showing it. Never
       type it on the command line: a typed value stays in the shell's
       history file (issue #1069).
    2. Writes it into the site's config, so the launcher can be handed it.

  It no longer touches the game server or restarts it, because there was
  nothing to write there and the restart threw everybody out for nothing.

  On a launcher older than 1.0.197 the password comes out of version.json
  rather than the site, so those copies keep whatever they last read. Once
  1.0.197 is out and everyone has it, this starts biting properly.
#>
[CmdletBinding()]
param(
  # Asks for a password you chose, hidden, instead of making one. A switch,
  # never a value typed after it (issue #1069).
  [switch]$Password,
  [int]$Minutes = 5,
  [string]$Why = 'a password change',
  [switch]$Now,
  [string]$Vps  = '',
  [string]$User = '',
  [string]$DocsRoot   = 'C:/Thornswood-Docs',
  [string]$ServerRoot = 'C:/Thornswood-Server',
  [switch]$Yes
)

$ErrorActionPreference = 'Stop'
$ssh  = @('-o','BatchMode=yes','-o','StrictHostKeyChecking=yes')
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
. (Join-Path $Here '..\vps\Vps.ps1')
. (Join-Path $Here '..\vps\Send-Script.ps1')
. (Join-Path $Here '..\vps\Send-Secret.ps1')
. (Join-Path $Here 'SiteConfigSet.ps1')
if (-not $User) { $User = Get-ThornswoodVpsUser }
if (-not $Vps) { $Vps = Get-ThornswoodVpsAddress }

function Remote($script) {
  # Send-Script.ps1 (issue #1070): a long script goes by scp and its run takes
  # it off the box before it runs, and the far side's exit code comes back.
  return Invoke-ThornswoodRemote -Target "$User@$Vps" -SshArgs $ssh -Script $script
}

if (-not $Yes) {
  Write-Host ''
  Write-Host '  This changes the password the site hands out. Nobody is disconnected' -ForegroundColor Yellow
  Write-Host '  and the game server is not touched, because it has no password of its' -ForegroundColor Yellow
  Write-Host '  own. Launchers older than 1.0.197 keep whatever version.json gave them.' -ForegroundColor Yellow
  Write-Host ''
  $a = Read-Host '  Type yes to go ahead'
  if ($a -ne 'yes') { Write-Host '  stopped, nothing changed'; return }
}

$newPassword = ''
if ($Password) {
  $newPassword = Read-ThornswoodSecret '  The new password (it is not shown)'
  if (-not $newPassword) { Write-Host '  nothing was typed, nothing changed'; return }
}
if (-not $newPassword) {
  # Long and from a real random source, because nobody types this one any more.
  # Generated until it is long enough: stripping the non alphanumeric characters
  # out of base64 can leave fewer than asked for, and Substring throws on that.
  function NewKey([int]$n) {
    $out = ''
    while ($out.Length -lt $n) {
      $b = New-Object byte[] 48
      [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
      $out += ([Convert]::ToBase64String($b) -replace '[^A-Za-z0-9]','')
    }
    return $out.Substring(0, $n)
  }
  $newPassword = NewKey 28
}

$docsWin = $DocsRoot.Replace('/','\')
$srvWin  = $ServerRoot.Replace('/','\')

Write-Host ''
Write-Host 'Handing it to the site...'
# The password goes on ssh's standard input, never in the script or on a
# command line on either machine (Send-Secret.ps1, issue #451).
#
# Only serverPassword changes in config.json, through the same block
# Deploy-Docs -Password uses (SiteConfigSet.ps1). Until #2317 this had its own
# copy: it read with Get-Content, which on the box's Windows PowerShell 5.1
# misreads a file with no byte order mark, inside a try with an empty catch, so a file
# that was there and did not parse left an empty table, and {"serverPassword"}
# was written over the whole file, the Discord secret, the bot token, botKey
# and the cookie secret with it. Now such a file is left as it is, nothing is
# written, and the site is not restarted either, because the block returns.
Invoke-ThornswoodSecretRemote -Target "$User@$Vps" -SshArgs $ssh -Secret $newPassword -Script @"
`$ErrorActionPreference = 'Stop'
`$pw = `$ThornswoodSecret; `$ThornswoodSecret = `$null
if (-not `$pw) { 'NOTHING ARRIVED on standard input. Nothing written, the password is unchanged.'; return }
$(Get-ThornswoodSiteConfigSet -ConfigPath "$docsWin\config.json" -Key 'serverPassword' -What 'server password')
`$pw = `$null

Get-CimInstance Win32_Process |
  Where-Object { `$_.Name -eq 'node.exe' -and `$_.CommandLine -like '*Thornswood-Docs*' } |
  ForEach-Object { Stop-Process -Id `$_.ProcessId -Force -EA SilentlyContinue }
Start-Sleep -Seconds 1
Start-ScheduledTask -TaskName 'Thornswood Docs' -EA SilentlyContinue
Start-Sleep -Seconds 3
if (Get-NetTCPConnection -LocalPort 3001 -State Listen -EA SilentlyContinue) { 'site restarted' }
else { 'SITE DID NOT COME BACK' }
"@ | ForEach-Object { "  $_" }
$newPassword = $null

# The game server settings used to be written here. They are not any more.
# There is no sPassword in server-settings.json, nothing in gamemode.js reads
# one, and the write threw every time. The restart that followed it emptied the
# world for a change that was never landing anywhere.
Write-Host ''
Write-Host '  Done. Nobody needs to be told the new password, because nobody' -ForegroundColor Green
Write-Host '  has it. The launcher asks the site for it after checking Discord.' -ForegroundColor Green
Write-Host ''
Write-Host '  It is not printed here on purpose.' -ForegroundColor DarkGray
Write-Host ''
Write-Host '  The game server was not touched and nobody was disconnected.' -ForegroundColor DarkGray
Write-Host '  It has no password of its own to change. Until gamemode.js checks' -ForegroundColor Yellow
Write-Host '  who is connecting, the address and port are the only thing between' -ForegroundColor Yellow
Write-Host '  a stranger and the world.' -ForegroundColor Yellow
