<#
  Discord-Hook.ps1

  The Discord webhooks releases post through, kept in one place on the VPS
  instead of a file on each machine that ships.

      .\scripts\ops\Discord-Hook.ps1 -Name dev             prints the dev updates webhook (scripts read it this way)
      .\scripts\ops\Discord-Hook.ps1 -Name news -Save       asks for the #news one, not shown, and stores it on the VPS
      .\scripts\ops\Discord-Hook.ps1 -Name dev -Check      says where it is found, never prints it

  WHY THIS EXISTS. Until 25 September each machine that shipped needed its
  own bot\dev-webhook.txt and bot\news-webhook.txt, so every new developer's
  first Ship posted nothing and the URL was pasted around in chats to fix it.
  Patrick asked for them to live somewhere safe that everybody with VPS access
  can reach. A webhook needs no login to post, so it never goes in git.

  WHERE. C:\Thornswood-Bot\webhooks\<name>.txt on the VPS, beside the bot's
  own config. Everyone who ships already has an ssh key there, and the build
  runner's account is shut out of every C:\Thornswood-* folder. Read over ssh
  each time, so replacing a leaked webhook is one -Save and every machine has
  the new one on its next Ship.

  NEVER TYPED ON THE COMMAND LINE (issue #1069). -Save asks for the address
  without showing it. A value typed after a parameter stays in the shell's
  history file and in the command line of the process running this, and a
  webhook needs no login to post. Another script that already asked for it
  (Set-DevNews.ps1) hands it over as -Url, a SecureString, which nobody can
  type.

  A copy in bot\dev-webhook.txt or bot\news-webhook.txt on this machine is
  still read when the VPS cannot be reached, so a machine set up the old way keeps posting.
#>
#Requires -Version 7
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateSet('dev', 'news')][string]$Name,
    # Asks for the webhook address, hidden, and stores it on the VPS.
    [switch]$Save,
    # The address from another script that already asked for it. A
    # SecureString, so it cannot be typed.
    [System.Security.SecureString]$Url,
    [switch]$Check,
    # For the harness: what runs a script on the VPS.
    [string]$RemoteScript = (Join-Path $PSScriptRoot '..\vps\Remote.ps1')
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\vps\Send-Secret.ps1')
$far = "C:\Thornswood-Bot\webhooks\$Name.txt"
$local = if ($Name -eq 'dev') { Join-Path $PSScriptRoot '..\..\bot\dev-webhook.txt' } else { Join-Path $PSScriptRoot '..\..\bot\news-webhook.txt' }
$shape = '^https://(canary\.|ptb\.)?discord(app)?\.com/api/webhooks/\d+/[A-Za-z0-9_-]+$'

function OnVps([string]$body) {
    $ErrorActionPreference = 'Continue'
    $out = @(& $RemoteScript $body 2>&1 | ForEach-Object { "$_" })
    return @{ Code = $LASTEXITCODE; Out = $out }
}

# The webhook goes on ssh's standard input and the script finds it in
# $ThornswoodSecret (Remote.ps1 -Secret, issue #451). It used to be written
# into the script, which put it on the command line of ssh here and of
# powershell on the VPS. Handed over as a SecureString (issue #1069).
function OnVpsWith([string]$body, [System.Security.SecureString]$value) {
    $ErrorActionPreference = 'Continue'
    $out = @(& $RemoteScript $body -Secret $value 2>&1 | ForEach-Object { "$_" })
    return @{ Code = $LASTEXITCODE; Out = $out }
}

if ($Url -and -not $Save) { Write-Host 'STOP. -Url goes with -Save. Nothing was saved.' -ForegroundColor Red; exit 1 }
if ($Save) {
    # $webhook, not $url: PowerShell names are not case sensitive, so a $url
    # here would be the -Url parameter itself.
    if ($Url) { $webhook = (ConvertFrom-ThornswoodSecureString $Url).Trim() }
    else { $webhook = (Read-ThornswoodSecret "  The $Name webhook address (it is not shown)").Trim() }
    $Url = $null
    if ($webhook -notmatch $shape) { $webhook = $null; Write-Host 'STOP. That is not a Discord webhook address. Nothing was saved.' -ForegroundColor Red; exit 1 }
    $r = OnVpsWith ("`$u = `$ThornswoodSecret; `$ThornswoodSecret = `$null; if (-not `$u) { 'NOTHING ARRIVED'; return }; " +
                    "`$d = 'C:\Thornswood-Bot\webhooks'; New-Item -ItemType Directory -Force -Path `$d | Out-Null; " +
                    "[IO.File]::WriteAllText('$far', `$u, (New-Object Text.UTF8Encoding(`$false))); `$u = `$null; 'SAVED'") (ConvertTo-SecureString $webhook -AsPlainText -Force)
    $webhook = $null
    if ($r.Code -ne 0 -or -not ($r.Out -contains 'SAVED')) { Write-Host 'STOP. The VPS did not take it; nothing was saved there. Is this machine''s ssh key on it (.\scripts\vps\Setup-SshKey.ps1 -Test)?' -ForegroundColor Red; exit 1 }
    if (Test-Path -LiteralPath $local) { Remove-Item -LiteralPath $local -Force }
    Write-Host "  saved on the VPS as $far; every machine reads it from there" -ForegroundColor Green
    exit 0
}

$r = OnVps ("`$f = '$far'; if (Test-Path -LiteralPath `$f) { 'HOOK ' + ([IO.File]::ReadAllText(`$f)).Trim() } else { 'NOHOOK' }")
$hook = ''; $from = ''
$line = @($r.Out | Where-Object { $_ -like 'HOOK *' } | Select-Object -First 1)
if ($r.Code -eq 0 -and $line.Count -and $line[0].Substring(5).Trim() -match $shape) { $hook = $line[0].Substring(5).Trim(); $from = 'the VPS' }
elseif (Test-Path -LiteralPath $local) {
    # "$()": an empty file reads as $null (even through [string](...)), and a method on $null throws.
    $t = ("$(Get-Content -LiteralPath $local -Raw)").Trim()
    if ($t -match $shape) { $hook = $t; $from = "the copy on this machine, $local" }
}

if ($Check) {
    if ($hook) { Write-Host "  the $Name webhook is set, read from $from" -ForegroundColor Green }
    elseif ($r.Out -contains 'NOHOOK') { Write-Host "  no $Name webhook on the VPS yet: .\scripts\ops\Discord-Hook.ps1 -Name $Name -Save" -ForegroundColor Yellow }
    else { Write-Host "  the VPS could not be asked and this machine has no copy" -ForegroundColor Yellow }
    exit 0
}
if ($hook) { Write-Output $hook }
exit 0
