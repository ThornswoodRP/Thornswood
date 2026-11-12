<#
  Fix-QuickLoot.ps1

  RETIRED. DO NOT RUN. Issue #1179: switched on MCMHelper.esp in server-settings.json and plugins.txt by hand. The collection (or the settled load order) does this now. It refuses to run, and the rest of the file is kept for the history of how it was installed. Pattern from #405 Add-Bodies.

  What it used to do, and what is left of it:

  QuickLoot's settings quest is registered through MCM Helper, and MCM Helper
  needs its own plugin active. It is a hundred byte stub with no records worth
  the name, so on its own it is nothing. The catch is what it does to the
  numbering.

  SkyMP resolves a form as fileIndex * 0x01000000 + localId and nothing
  translates between client and server. The client checks this at startup, in
  loadOrderVerificationService: for every entry the server lists, the client's
  plugin at that same index must match by filename, size and CRC. More mods
  than the server is allowed and gives the yellow warning. A mismatch inside
  the server's list is the red one, and the message it prints is "Expect
  EVERYTHING BREAK", because every form id from a mod plugin then lands on the
  wrong object.

  MCMHelper.esp is not ESL flagged (its TES4 header flags are 0x00000000), so
  it takes a real index. Enabling it client side alone shifts every server
  entry after it by one. That is the whole reason this is a script and not a
  tick box.

  Both sides, or neither.

  WHERE IT GOES. -After is the plugin the new entry is put behind, and the
  default is SkyUI_SE.esp because that is MCMHelper.esp's own master: the
  server's reader refuses a plugin whose masters are absent, so a server list
  that can hold MCMHelper.esp holds SkyUI_SE.esp already, and right behind it
  is the earliest place the entry is legal. Enable-MCM.ps1 is what clears
  SkyUI_SE.esp's light flag so it takes a normal index and can be in that list
  at all, so run that first.

  The default used to be SunHelmDiseases.esp, read off line 79 of one
  machine's plugins.txt in September. SunHelm left the collection with the
  needs rebuild (issue #480), so that anchor is in no load order now and this
  script would have stopped on it. Being behind the master is a rule rather
  than a line number, so it does not go stale the next time the collection is
  rebaked.
#>

#Requires -Version 7
[CmdletBinding()]
param(
  [string] $Game     = (& (Join-Path $PSScriptRoot '..\release\Where.ps1') Install),
  [string] $Settings = (& (Join-Path $PSScriptRoot '..\release\Where.ps1') ServerSettings),
  [string] $After    = 'SkyUI_SE.esp'
)
# The refusal comes before anything else, above the strict mode line and above
# the dot source below it, so no part of the install can run by accident.
throw ('STOP. Fix-QuickLoot.ps1 is retired and installs nothing (issue #1179). ' +
       'MCMHelper.esp is on in the collection load order on both sides now. Switching it in plugins.txt and server-settings.json by hand desyncs form ids. ' +
       'The file is kept for the history of how it was installed. Delete this line only if ' +
       'hand installs are meant again, and read the header first.')


Set-StrictMode -Off
$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'

$Here = Split-Path -Parent $MyInvocation.MyCommand.Path

function Head($t) { Write-Host ''; Write-Host $t -ForegroundColor Cyan }
function Note($t) { Write-Host "  $t" }
function Bad($t)  { Write-Host "  $t" -ForegroundColor Yellow }

if (-not (Test-Path -LiteralPath $Settings)) { throw "server settings not found: $Settings" }

# ------------------------------------------------------------ the server ---
Head 'Server load order'
$raw = Get-Content -LiteralPath $Settings -Raw
$s   = $raw | ConvertFrom-Json
$lo  = @($s.loadOrder)

$already = $false
# A load order entry is a box path; its file name is taken on either separator,
# since GetFileName off Windows does not split on \ (#2989).
function Leaf($p) { @(([string]$p) -split '[\\/]')[-1] }
foreach ($p in $lo) { if ((Leaf $p) -ieq 'MCMHelper.esp') { $already = $true } }

if ($already) {
  Note 'MCMHelper.esp is already in the server list'
} else {
  $at = -1
  for ($i = 0; $i -lt $lo.Count; $i++) {
    if ((Leaf $lo[$i]) -ieq $After) { $at = $i; break }
  }
  # Stopping here is the point. Putting MCMHelper.esp at a guessed position
  # shifts every entry after it, and the client's check calls that "Expect
  # EVERYTHING BREAK". A missing anchor is a list that is not ready for this
  # script, not a list to insert into anyway.
  if ($at -lt 0) {
    throw ("$After is not in the server load order ($($lo.Count) entries), so there is nowhere " +
           "safe to put MCMHelper.esp. Run Enable-MCM.ps1 to clear SkyUI_SE.esp's light flag and " +
           "Deploy-Gamemode.ps1 to rebuild the list, then run this again. Pass -After <plugin> only " +
           "if you know MCMHelper.esp's master sits at or before it.")
  }

  $entry = ($lo[$at] -replace '[^/\\]+$', 'MCMHelper.esp')
  $new = @()
  for ($i = 0; $i -lt $lo.Count; $i++) {
    $new += $lo[$i]
    if ($i -eq $at) { $new += $entry }
  }
  $s.loadOrder = $new

  # No BOM. Node reads this file, and a BOM makes it "Unexpected token" rather
  # than JSON, which is a confusing way to find out.
  $json = $s | ConvertTo-Json -Depth 12
  [IO.File]::WriteAllText($Settings, $json, (New-Object Text.UTF8Encoding($false)))
  Note "inserted after $After, now $($new.Count) entries"
}

# ------------------------------------------------------------ the client ---
Head 'Client load order'
foreach ($f in @(
  (Join-Path $Game 'Profile\LocalAppData\Plugins.txt'),
  (Join-Path $Game 'Profile\Default\plugins.txt')
)) {
  if (-not (Test-Path -LiteralPath $f)) { continue }
  $lines = [IO.File]::ReadAllLines($f)
  $hit = $false
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i].Trim() -eq 'MCMHelper.esp') { $lines[$i] = '*MCMHelper.esp'; $hit = $true }
  }
  if ($hit) {
    [IO.File]::WriteAllLines($f, $lines, (New-Object Text.UTF8Encoding($false)))
    Note "enabled in $(Split-Path -Leaf $f)"
  } else {
    Note "already enabled in $(Split-Path -Leaf $f)"
  }
}

# ------------------------------------------------------------- quickloot ---
Head 'QuickLoot'
$off = Join-Path $Game 'Game\Data\SKSE\Plugins\QuickLootIE.dll.off'
if (Test-Path -LiteralPath $off) {
  Rename-Item -LiteralPath $off -NewName 'QuickLootIE.dll'
  Note 'plugin switched back on'
} else {
  Note 'plugin was never switched off'
}

# ----------------------------------------------------------------- check ---
Head 'Checking both sides line up'
Note 'Deploy-Gamemode.ps1 builds the server list and the launcher puts each list into its order (#4688).'

Head 'Now'
Note 'The server has to be republished before you launch, or the two lists disagree'
Note 'and every form id from a mod plugin lands on the wrong object:'
Note ''
Note '    .\Publish-Server.ps1'
Note ''
Note 'MCMHelper.esp is a header only plugin. If the server will not start after'
Note 'publishing, libespm refused it, and the answer is to take it back out'
Note 'rather than to keep QuickLoot.'
