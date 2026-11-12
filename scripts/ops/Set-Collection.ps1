<#
  Set-Collection.ps1

      .\scripts\ops\Set-Collection.ps1

  Asks for the collection address and publishes it, in the two places that
  decide it, the same two Set-Server.ps1 uses:

      config.json     this machine's launcher
      version.json    everybody else's, which copies it in on the next check

  Why it matters more than it looks. The installer stopped carrying the mods:
  anything the collection provides is left out of it. So a launcher that does
  not know the collection address is a launcher that installs a game with no
  mods and no way to say where they went, and the error the person sees is the
  server turning them away, which reads as a broken launcher.

  Publishing this is what makes the small installer safe to hand out.

      .\scripts\ops\Set-Collection.ps1 -Clear     put it back to carrying everything
#>
#Requires -Version 7
[CmdletBinding()]
param(
  [string]$Url,
  [string]$Root = (& (Join-Path $PSScriptRoot '..\release\Where.ps1') Install),
  [string]$ReleaseDir,
  [switch]$Clear,
  [switch]$NoPush,
  [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$RepoDir = Split-Path -Parent (Split-Path -Parent $Here)
# The live feed lives on the VPS beside what the site serves (#907): received
# into this machine's working folder for main, edited there, and sent back,
# refused if it changed up there in between. Until #907 this edited and pushed
# the Thornswood-Releases clone. -ReleaseDir works on a folder instead and
# receives nothing.
. (Join-Path $Here '..\release\Feed-Store.ps1')
$receive = -not $ReleaseDir
if (-not $ReleaseDir) { $ReleaseDir = Get-FeedStoreDir 'main' }

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
function Die($m) {
  Write-Host ''
  Write-Host "STOP. $m" -ForegroundColor Red
  if (-not $NoPause) { [void](Read-Host 'Enter to exit') }
  exit 1
}
function ReadJson($path) {
  $raw = [IO.File]::ReadAllBytes($path)
  $skip = 0
  if ($raw.Length -ge 3 -and $raw[0] -eq 0xEF -and $raw[1] -eq 0xBB -and $raw[2] -eq 0xBF) { $skip = 3 }
  $text = [Text.Encoding]::UTF8.GetString($raw, $skip, $raw.Length - $skip)
  # Named when empty or not JSON, rather than a parse error or a null document.
  if (-not $text.Trim()) { Die "$path is empty. Nothing has been changed there." }
  try { return ($text | ConvertFrom-Json) } catch { Die ("$path is not valid JSON: " + $_.Exception.Message) }
}
function WriteJson($path, $doc) {
  # No byte order mark. The launcher's reader stops on one and node refuses it.
  [IO.File]::WriteAllText($path, ($doc | ConvertTo-Json -Depth 8), (New-Object Text.UTF8Encoding($false)))
}

Write-Host ''
Write-Host '  THORNSWOOD  -  where the mods come from' -ForegroundColor White

if ($Clear) { $Url = '' }
elseif (-not $Url) {
  Write-Host ''
  Say '  Paste the collection address from Nexus. It looks like a normal page' 'DarkGray'
  Say '  address for your collection.' 'DarkGray'
  Write-Host ''
  $Url = (Read-Host '  Collection address').Trim()
}
$Url = "$Url".Trim().Trim('"')

if (-not $Clear) {
  if (-not $Url) { Die 'Nothing given. Nothing has been changed.' }
  if ($Url -notmatch '^https?://') { Die "That is not a web address: $Url" }
  if ($Url -notmatch 'nexusmods\.com') {
    Say '  That is not a nexusmods.com address. Carrying on, but check it.' 'Yellow'
  }
}

# ------------------------------------------------------------ this machine ---
Head 'This machine'
$cfgPath = Join-Path $Root 'config.json'
if (-not (Test-Path -LiteralPath $cfgPath)) { Die "not found: $cfgPath" }
$cfg = ReadJson $cfgPath
$was = if ($cfg.PSObject.Properties.Name -contains 'CollectionUrl') { [string]$cfg.CollectionUrl } else { '' }
Say ("  was  " + $(if ($was) { $was } else { '(none)' })) 'DarkGray'
if ($cfg.PSObject.Properties.Name -contains 'CollectionUrl') { $cfg.CollectionUrl = $Url }
else { $cfg | Add-Member -NotePropertyName 'CollectionUrl' -NotePropertyValue $Url }
WriteJson $cfgPath $cfg
Say ("  now  " + $(if ($Url) { $Url } else { '(none)' })) 'Green'

# ----------------------------------------------------------- everybody else ---
Head 'Everybody else'
if ($receive) {
  try { [void](Receive-FeedStore 'main' $ReleaseDir) }
  catch { Die ("Could not receive the live feed from the VPS, so only this machine was changed: " + $_.Exception.Message) }
}
$vFile = Join-Path $ReleaseDir 'version.json'
if (-not (Test-Path -LiteralPath $vFile)) { Die "not found: $vFile" }
$doc = ReadJson $vFile
$wasV = if ($doc.PSObject.Properties.Name -contains 'collectionUrl') { [string]$doc.collectionUrl } else { '' }
Say ("  was  " + $(if ($wasV) { $wasV } else { '(none)' })) 'DarkGray'
if ($doc.PSObject.Properties.Name -contains 'collectionUrl') { $doc.collectionUrl = $Url }
else { $doc | Add-Member -NotePropertyName 'collectionUrl' -NotePropertyValue $Url }
Write-FeedVersionFile $vFile $doc
Say ("  now  " + $(if ($Url) { $Url } else { '(none)' })) 'Green'

if ($NoPush) {
  Write-Host ''
  Say 'Not pushed, as asked. Until it is, other launchers still have the old one.' 'Yellow'
}
else {
  Head 'Sending'
  try { [void](Send-FeedStore 'main' $ReleaseDir @('version.json')) }
  catch { Die ("The feed was not sent: " + $_.Exception.Message + " Both files are set here, they are just not up yet.") }
  Say '  sent; the site serves it now' 'Green'
}

Write-Host ''
if ($Url) {
  Say 'The Add-ons tab now shows where the mods come from, with a button that' 'Green'
  Say 'opens it. Everybody picks it up on their next update check.' 'Green'
}
else {
  Say 'Cleared. Build the installer with -NoVortex or it will ship without mods' 'Yellow'
  Say 'and without telling anybody where they went.' 'Yellow'
}
Write-Host ''
if (-not $NoPause) { [void](Read-Host 'Enter to close') }
