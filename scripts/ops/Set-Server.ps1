<#
  Set-Server.ps1

  Sets the server everyone connects to, in the two places that decide it, and
  sends the feed to the VPS (#907).

      .\Set-Server.ps1 -Address <from scripts\vps\vps.json> -Port 7777

  The two places:
    config.json     this machine's launcher
    version.json    every other launcher, which copies it into their config on
                    the next update check

  Only changing one of them does not hold. Fix config.json alone and the next
  update check puts the published value straight back over it. Fix version.json
  alone and the next publish copies this machine's stale config over that. They
  have to move together, which is what this does.

  It checks the address answers before writing anything, because publishing one
  that does not is how five people end up in single player wondering what they
  broke. -Force skips that.
#>
#Requires -Version 7
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Address,
    [string]$Port = '7777',
    [string]$Root = (& (Join-Path $PSScriptRoot '..\release\Where.ps1') Install),
    [string]$RepoDir,
    [string]$ReleaseDir,
    [switch]$Force,
    [switch]$NoPush,
    [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
if (-not $RepoDir) { $RepoDir = Split-Path -Parent (Split-Path -Parent $Here) }
# The live feed lives on the VPS beside what the site serves (#907). It is
# received into this machine's working folder for main, edited there and sent
# back, which is the moment every launcher can see it; the send refuses if the
# feed changed up there in between. Until #907 this edited and pushed the
# Thornswood-Releases clone. -ReleaseDir works on a folder instead and
# receives nothing.
. (Join-Path $Here '..\release\Feed-Store.ps1')
$receive = -not $ReleaseDir
if (-not $ReleaseDir) { $ReleaseDir = Get-FeedStoreDir 'main' }

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
function Die($m) { Write-Host ''; Write-Host "STOP. $m" -ForegroundColor Red; if (-not $NoPause) { [void](Read-Host 'Enter to exit') }; exit 1 }

Write-Host ''
Write-Host '  THORNSWOOD  -  set the server' -ForegroundColor White
Say "  $Address`:$Port" 'DarkGray'

# A port is a whole number from 1 to 65535, checked before anything is read
# or written (#4242): until then 0, -1 or 'no' went into both files and out
# to every launcher.
$portNumber = 0
if ($Port -notmatch '^[0-9]{1,5}$' -or -not [int]::TryParse($Port, [ref]$portNumber) -or $portNumber -lt 1 -or $portNumber -gt 65535) {
    Die "$Port is not a port: give a whole number from 1 to 65535. Nothing has been changed."
}

# ------------------------------------------------------------- is it there ---
if (-not $Force) {
    Head 'Checking it answers'
    # Game traffic is UDP with nothing to connect to, so the resources folder on
    # 3000 is what a probe can actually reach.
    $up = $false
    try {
        $c = New-Object Net.Sockets.TcpClient
        $null = $c.BeginConnect($Address, 3000, $null, $null).AsyncWaitHandle.WaitOne(2000)
        $up = $c.Connected
        $c.Close()
    } catch { }
    if ($up) { Say '  answering' 'Green' }
    else {
        Die "Nothing is answering at ${Address}:3000. Start the server first, or pass -Force if you know it is coming up later."
    }
}

# ------------------------------------------------------- read both first ---
# Both files are read and checked before either is written (#4242): until
# then this machine's config.json was changed first, so a feed that could not
# be received, or was not JSON, left the two places disagreeing.
$cfgPath = Join-Path $Root 'config.json'
if (-not (Test-Path -LiteralPath $cfgPath)) { Die "not found: $cfgPath" }

$raw = [IO.File]::ReadAllBytes($cfgPath)
$skip = if ($raw.Length -ge 3 -and $raw[0] -eq 0xEF -and $raw[1] -eq 0xBB -and $raw[2] -eq 0xBF) { 3 } else { 0 }
# Named when empty or not JSON, rather than a parse error or a null document.
$cfgText = [Text.Encoding]::UTF8.GetString($raw, $skip, $raw.Length - $skip)
if (-not $cfgText.Trim()) { Die "$cfgPath is empty. Nothing has been changed." }
try { $cfg = $cfgText | ConvertFrom-Json } catch { Die ("$cfgPath is not valid JSON: " + $_.Exception.Message + " Nothing has been changed.") }
if ($cfg -isnot [Management.Automation.PSCustomObject]) { Die "$cfgPath is not one JSON object. Nothing has been changed." }

if ($receive) {
    try { [void](Receive-FeedStore 'main' $ReleaseDir) }
    catch { Die ("Could not receive the live feed from the VPS: " + $_.Exception.Message + " Nothing has been changed.") }
}
$VersionFile = Join-Path $ReleaseDir 'version.json'
if (-not (Test-Path -LiteralPath $VersionFile)) { Die "not found: $VersionFile. Nothing has been changed." }
$docText = "$(Get-Content -LiteralPath $VersionFile -Raw)"
if (-not $docText.Trim([char]0xFEFF, ' ', [char]9, [char]13, [char]10)) { Die "$VersionFile is empty. Nothing has been changed." }
try { $doc = $docText.TrimStart([char]0xFEFF) | ConvertFrom-Json -NoEnumerate } catch { Die ("$VersionFile is not valid JSON: " + $_.Exception.Message + " Nothing has been changed.") }
if ($doc -isnot [Management.Automation.PSCustomObject]) { Die "$VersionFile is not one JSON object, so it is not a feed. Nothing has been changed." }

# ------------------------------------------------------------- config.json ---
Head 'This machine'
Say ("  was  {0}:{1}" -f $cfg.ServerAddress, $cfg.ServerPort) 'DarkGray'
$cfg.ServerAddress = $Address
$cfg.ServerPort = $Port
# No byte order mark. The launcher's reader stops on one.
[IO.File]::WriteAllText($cfgPath, ($cfg | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding($false)))
Say ("  now  {0}:{1}" -f $Address, $Port) 'Green'

# ------------------------------------------------------------ version.json ---
Head 'Everyone else'
$wasA = if ($doc.PSObject.Properties.Name -contains 'serverAddress') { [string]$doc.serverAddress } else { '' }
$wasP = if ($doc.PSObject.Properties.Name -contains 'serverPort') { [string]$doc.serverPort } else { '' }
Say ("  was  {0}:{1}" -f $wasA, $wasP) 'DarkGray'

foreach ($pair in @(@('serverAddress', $Address), @('serverPort', $Port))) {
    if ($doc.PSObject.Properties.Name -contains $pair[0]) { $doc.($pair[0]) = $pair[1] }
    else { $doc | Add-Member -NotePropertyName $pair[0] -NotePropertyValue $pair[1] }
}
Write-FeedVersionFile $VersionFile $doc
Say ("  now  {0}:{1}" -f $Address, $Port) 'Green'

if ($NoPush) {
    Write-Host ''
    Say 'Not pushed, as asked. Until it is, the other launchers still have the old one.' 'Yellow'
    Write-Host ''
    if (-not $NoPause) { [void](Read-Host 'Enter to close') }
    exit 0
}

# The store's receipt says what happened (#4242): Sent names a file it
# replaced, Same one it already held. Until then a send that replaced nothing
# still said the site serves it now.
Head 'Sending'
try { $sent = Send-FeedStore 'main' $ReleaseDir @('version.json') }
catch { Die ("The feed was not sent: " + $_.Exception.Message + " Both files are fixed here, they are just not up yet.") }
if (@($sent.Sent) -contains 'version.json') {
    Say '  sent; the site serves it now' 'Green'
    Write-Host ''
    Say 'Everyone picks this up the next time their launcher checks for updates.' 'Green'
}
elseif (@($sent.Same) -contains 'version.json') {
    Say '  already up: the VPS held this exact version.json, so nothing new went out' 'Green'
}
else {
    Die 'The VPS did not say it took version.json or already held it, so nothing says the site serves it. Both files are fixed here; the feed on the site is unconfirmed until its version.json is read.'
}
if (-not $NoPause) { [void](Read-Host 'Enter to close') }
