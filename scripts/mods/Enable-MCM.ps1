<#
  Enable-MCM.ps1

  RETIRED. DO NOT RUN. Issue #1179: patched SkyUI_SE.esp's light flag by hand. The collection (or the settled load order) does this now. It refuses to run, and the rest of the file is kept for the history of how it was installed. Pattern from #405 Add-Bodies.

  What it used to do, and what is left of it:

  The chain that was blocking it:

    QuickLootIE.esp    light,     masters Skyrim.esm      - a 527 byte stub
    SkyUI_SE.esp       light,     masters Skyrim.esm      - holds 7 MCM quests
    MCMHelper.esp      NOT light, masters SkyUI_SE.esp    - the shared MCM quest

  Every MCM Helper mod uses the quest inside MCMHelper.esp; they do not carry
  their own. So QuickLoot's dialog is telling the truth, the quest really is not
  in the game.

  MCMHelper.esp cannot go in the server's load order while its master is light,
  because a light plugin has no normal index and the server's reader refuses a
  plugin whose master is absent. And it cannot be switched on client side alone,
  because then the two lists disagree and every mod form resolves to the wrong
  object.

  So the light flag comes off SkyUI_SE.esp. One bit in its header. It then takes
  a normal index, goes server side, and MCMHelper.esp follows it.

  Its 7 records are SkyUI's own config quests. Moving them out of FE space
  changes their form ids, which the engine fixes up by itself: dependent plugins
  name their masters by filename and are resolved at load. The one real cost is
  to a local save that referenced them, and Thornswood characters live on the
  server, not in a local save.

  The original is kept beside it. Nothing here is one way.
#>

[CmdletBinding()]
param(
  [string] $Game = (& (Join-Path $PSScriptRoot '..\release\Where.ps1') Install),
  [switch] $Undo
)
# The refusal comes before anything else, above the strict mode line and above
# the dot source below it, so no part of the install can run by accident.
throw ('STOP. Enable-MCM.ps1 is retired and installs nothing (issue #1179). ' +
       'SkyUI_SE.esp''s light flag and MCM Helper are settled in the collection load order now. Patching the esp by hand writes through Vortex hard links into staging. ' +
       'The file is kept for the history of how it was installed. Delete this line only if ' +
       'hand installs are meant again, and read the header first.')


Set-StrictMode -Off
$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'

$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Data = Join-Path $Game 'Game\Data'
$esp  = Join-Path $Data 'SkyUI_SE.esp'

function Head($t) { Write-Host ''; Write-Host $t -ForegroundColor Cyan }
function Note($t) { Write-Host "  $t" }
function Bad($t)  { Write-Host "  $t" -ForegroundColor Yellow }

if (Get-Process SkyrimSE, SkyrimSE_VR -ErrorAction SilentlyContinue) {
  Write-Host ''
  Write-Host 'STOP. Skyrim is running. Close it first or these files cannot be written.' -ForegroundColor Red
  return
}
if (-not (Test-Path -LiteralPath $esp)) { throw "not found: $esp" }

function Get-LightFlag([string]$path) {
  $fs = [IO.File]::OpenRead($path)
  try {
    $b = New-Object byte[] 12
    [void]$fs.Read($b, 0, 12)
    if ([Text.Encoding]::ASCII.GetString($b, 0, 4) -ne 'TES4') { throw "$path is not a plugin" }
    return [BitConverter]::ToUInt32($b, 8)
  } finally { $fs.Close() }
}

function Set-Flags([string]$path, [uint32]$flags) {
  $fs = [IO.File]::Open($path, 'Open', 'Write')
  try {
    $fs.Seek(8, 'Begin') | Out-Null
    $fs.Write([BitConverter]::GetBytes($flags), 0, 4)
  } finally { $fs.Close() }
}

# ------------------------------------------------------------------- flag ---
Head 'SkyUI_SE.esp'
$flags = Get-LightFlag $esp
Note ("flags are 0x{0:X8}, light bit is {1}" -f $flags, $(if ($flags -band 0x200) { 'on' } else { 'off' }))

if ($Undo) {
  $want = $flags -bor 0x200
  $verb = 'put back'
} else {
  $want = $flags -band (-bnot [uint32]0x200)
  $verb = 'cleared'
}

if ($want -eq $flags) {
  Note "already $verb, nothing to do to the file"
} else {
  $bak = "$esp.bak"
  if (-not (Test-Path -LiteralPath $bak)) {
    Copy-Item -LiteralPath $esp -Destination $bak -Force
    Note "original kept at SkyUI_SE.esp.bak"
  }
  try {
    Set-Flags $esp $want
  } catch {
    Bad "could not write to SkyUI_SE.esp: $($_.Exception.Message)"
    Bad "something has it open. Close Vortex, MO2 or any tool holding Data, then run this again."
    return
  }
  $now = Get-LightFlag $esp
  if (($now -band 0x200) -eq ($want -band 0x200)) {
    Note ("light flag $verb, flags are now 0x{0:X8}" -f $now)
  } else {
    Bad 'the write did not take. Stopping rather than going on with a half change.'
    return
  }
}

# ---------------------------------------------------------------- plugins ---
Head 'MCMHelper.esp'
$state = if ($Undo) { 'off' } else { 'on' }
foreach ($f in @(
  (Join-Path $Game 'Profile\LocalAppData\Plugins.txt'),
  (Join-Path $Game 'Profile\Default\plugins.txt')
)) {
  if (-not (Test-Path -LiteralPath $f)) { continue }
  $lines = [IO.File]::ReadAllLines($f)
  $hit = $false
  for ($i = 0; $i -lt $lines.Count; $i++) {
    $t = $lines[$i].Trim()
    if ($Undo) {
      if ($t -eq '*MCMHelper.esp') { $lines[$i] = 'MCMHelper.esp'; $hit = $true }
    } else {
      if ($t -eq 'MCMHelper.esp') { $lines[$i] = '*MCMHelper.esp'; $hit = $true }
    }
  }
  if ($hit) {
    [IO.File]::WriteAllLines($f, $lines, (New-Object Text.UTF8Encoding($false)))
    Note "switched $state in $(Split-Path -Leaf $f)"
  } else {
    Note "already $state in $(Split-Path -Leaf $f)"
  }
}

# -------------------------------------------------------------- quickloot ---
Head 'QuickLoot'
$off = Join-Path $Data 'SKSE\Plugins\QuickLootIE.dll.off'
if ((-not $Undo) -and (Test-Path -LiteralPath $off)) {
  Rename-Item -LiteralPath $off -NewName 'QuickLootIE.dll'
  Note 'plugin switched back on'
} else {
  Note 'left as it is'
}

# ------------------------------------------------------------- load order ---
Head 'Rebuilding the server load order'
Note 'Deploy-Gamemode.ps1 builds it now (#4688): ..\deploy\Deploy-Gamemode.ps1'

Head 'Now'
Note 'The server must get the new list before you launch, or the two disagree:'
Note ''
Note '    .\Publish-Server.ps1'
Note ''
Note 'To undo all of this:  .\Enable-MCM.ps1 -Undo   then publish again.'
