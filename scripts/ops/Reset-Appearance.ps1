<#
  Reset-Appearance.ps1

  Puts a character back into the race menu without deleting them.

  How it works, because it is worth knowing it is not a hack: the server
  serialises "no appearance" as appearanceDump: null (MpChangeForms.cpp:46-50),
  reads it back the same way (:210-214), and MpActor::ApplyChangeForm then does

      if (changeForm.appearanceDump.empty()) { changeForm.isRaceMenuOpen = true; }

  because an actor with no appearance would be invisible. MpActor::VisitProperties
  stamps that flag onto the CreateActorMessage, and the client opens the race
  menu on receipt. So clearing the appearance is the supported way to ask for
  character creation again. Inventory, position, spells and everything else on
  the character are untouched.

  Each change form it edits is copied first to <id>.json.bak-<stamp> beside
  it, a whole copy of the character, which the game server's server-log.js
  deletes 30 days later (#3620).

  THE SERVER MUST BE STOPPED. It holds change forms in memory and writes them
  out on its own schedule, so editing them underneath a running server just gets
  the edit overwritten.
#>
#Requires -Version 7
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$World = (& (Join-Path $PSScriptRoot '..\release\Where.ps1') ChangeForms),
    [int]   $ProfileId = 1,
    [switch]$All,
    [switch]$KeepTrade      # leave the trade and starting town already chosen
)

$ErrorActionPreference = 'Stop'   # before any file loads, so one that is missing stops here (#3006)
if (-not (Test-Path -LiteralPath $World)) { throw "not found: $World" }

if (Get-Process -Name node -ErrorAction SilentlyContinue) {
    Write-Host 'A node process is running. If that is the Thornswood server, stop it first or this edit will be overwritten.' -ForegroundColor Yellow
}

# The characters' change forms, by the one rule (#5168, Release-List.ps1): a
# runtime form's id in lowercase hex and no plugin, 0.json or 1f.json, with a
# profileId above 0 and not deleted. Digits alone missed every character
# whose id has a letter, and -All took the world's own runtime forms too.
. (Join-Path $PSScriptRoot 'Release-List.ps1')
. ([scriptblock]::Create($ThornswoodReleaseList))
$chars = Get-ThornswoodCharacterForms $World 'it is left as it is'
foreach ($n in $chars.notes) { Write-Host ('  ' + ("$n" -split '\|', 2)[1]) -ForegroundColor Yellow }
$characters = @($chars.files | ForEach-Object { Get-Item -LiteralPath $_ })

if (-not $characters) { Write-Host 'no characters'' change forms found' -ForegroundColor Yellow; return }

$done = 0
foreach ($f in $characters) {
    $raw = Get-Content -LiteralPath $f.FullName -Raw
    $j = $raw | ConvertFrom-Json -AsHashtable
    if (-not $All -and $j.profileId -ne $ProfileId) { continue }

    $name = 'unnamed'
    if ($j.appearanceDump -and $j.appearanceDump.name) { $name = $j.appearanceDump.name }
    if ($null -eq $j.appearanceDump) {
        Write-Host ("  {0}  profile {1} already has no appearance, skipping" -f $f.Name, $j.profileId) -ForegroundColor DarkGray
        continue
    }

    if (-not $PSCmdlet.ShouldProcess("$($f.Name) (profile $($j.profileId), '$name')", 'clear appearance')) { continue }

    $bak = "$($f.FullName).bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    Copy-Item -LiteralPath $f.FullName -Destination $bak -Force

    $j.appearanceDump  = $null
    $j.isRaceMenuOpen  = $true

    # The gamemode keeps its own record of how far creation got, in the change
    # form's dynamicFields. Clearing the appearance without clearing that leaves
    # a character stuck: the race menu opens, and then the state machine reads
    #'done' and never hands out the writs. Drop it unless asked not to.
    $trade = $null
    if (-not $KeepTrade -and $j.dynamicFields -and $j.dynamicFields.ContainsKey('thornswoodChargen')) {
        $trade = $j.dynamicFields['thornswoodChargen']
        [void]$j.dynamicFields.Remove('thornswoodChargen')
    }

    $j | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $f.FullName -Encoding UTF8

    # Re-read rather than trust the write. A change form the server cannot parse
    # takes the whole save down with it.
    $check = Get-Content -LiteralPath $f.FullName -Raw | ConvertFrom-Json -AsHashtable
    if ($null -ne $check.appearanceDump -or $check.profileId -ne $j.profileId) {
        Copy-Item -LiteralPath $bak -Destination $f.FullName -Force
        throw "rewrite of $($f.Name) did not come back clean, restored from backup"
    }
    if (-not $KeepTrade -and $check.dynamicFields -and $check.dynamicFields.ContainsKey('thornswoodChargen')) {
        Copy-Item -LiteralPath $bak -Destination $f.FullName -Force
        throw "creation state survived the rewrite of $($f.Name), restored from backup"
    }

    Write-Host ("  {0}  profile {1}  '{2}' -> race menu on next connect" -f $f.Name, $j.profileId, $name) -ForegroundColor Cyan
    if ($trade) {
        Write-Host ("      also cleared creation state ({0})" -f ($trade.stage)) -ForegroundColor DarkGray
    } elseif ($KeepTrade) {
        Write-Host '      creation state kept, so the trade and town stay as they are' -ForegroundColor DarkGray
    }
    Write-Host ("      backup: {0}" -f (Split-Path $bak -Leaf)) -ForegroundColor DarkGray
    $done++
}

Write-Host ''
if ($done -gt 0) {
    Write-Host "$done character(s) will be asked to create an appearance next time they connect." -ForegroundColor Green
} else {
    Write-Host "nothing changed. Use -ProfileId <n> or -All to widen the match." -ForegroundColor Yellow
}
