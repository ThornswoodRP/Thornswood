<#
  New-Character.ps1

  Throws the test character away so the next connect builds a fresh one.

  Reset-Appearance.ps1 keeps the character and reopens the race menu, which is
  right when you care about the character. While the creation flow itself is
  what is being tested, you do not: you want the face menu and the choices on
  K every single launch, and you want nothing carried over from the last
  attempt.

  So this deletes the characters' change forms outright. The server then has no actor
  for your profile, takes its create path, and the whole flow runs from the top.
  World objects are left alone.

  THE SERVER MUST BE STOPPED. It holds change forms in memory and writes them on
  its own schedule, so deleting them underneath a running server just gets them
  written straight back.

  WHAT THE SERVER STILL HOLDS OF THE CHARACTER IS LET GO AT ITS NEXT START
  (#2673, as Reset-Character.ps1 does since #2668). A guild trader keys its
  supply waits and a trade still waiting by the character's form id (#2652),
  and that form id can be handed to the next character made. So the
  characters thrown away are written into the release list,
  private\deleted-characters.json in the server's privDir, through the one
  writer in Release-List.ps1: by form id only, never the profile, which keeps
  its id and what it holds. Each form id is read before its change form is
  moved or deleted. -World has to be a server's world\changeForms, because
  the list goes in that server's folder; a list already there that is not one
  stops this before anything is thrown away.
#>
#Requires -Version 7
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$World = (& (Join-Path $PSScriptRoot '..\release\Where.ps1') ChangeForms),
    [switch]$NoBackup
)

$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$ErrorActionPreference = 'Stop'   # before any file loads, so one that is missing stops here (#3006)
. (Join-Path $Here 'Release-List.ps1')
. ([scriptblock]::Create($ThornswoodReleaseList))

if (-not (Test-Path -LiteralPath $World)) { throw "not found: $World" }
$World = (Resolve-Path -LiteralPath $World).ProviderPath.TrimEnd('\')

if (Get-Process -Name node -ErrorAction SilentlyContinue) {
    Write-Host 'A node process is running. If that is the Thornswood server, stop it first or this will be undone.' -ForegroundColor Yellow
}

# Characters' change forms are the numerically named ones. Everything else is a world
# object keyed by form id and plugin, like 13164_JKs Whiterun.esp.json.
$characters = Get-ChildItem -LiteralPath $World -Filter '*.json' |
           Where-Object { $_.BaseName -match '^\d+$' }

if (-not $characters) {
    Write-Host 'No character change forms. The next connect already builds a fresh character.' -ForegroundColor Green
    return
}

# The release list goes in the server whose change forms these are. Without
# knowing that server there is nowhere it would be read, so nothing goes.
$worldDir = Split-Path -Parent $World
$Root = Split-Path -Parent $worldDir
if ((Split-Path -Leaf $World) -ne 'changeForms' -or (Split-Path -Leaf $worldDir) -ne 'world' -or -not $Root) {
    Write-Host "STOP. $World is not a server's world\changeForms, so there is no server to hand the release list to. Nothing was thrown away." -ForegroundColor Red
    exit 1
}
$list = Get-ThornswoodReleaseListPath $Root
if (-not $list) {
    Write-Host ("STOP. " + (Join-Path $Root 'server-settings.json') + " will not parse, so the server's private folder, where the release list goes, is not known. Nothing was thrown away.") -ForegroundColor Red
    exit 1
}
if (-not (Read-ThornswoodReleaseList $list).ok) {
    Write-Host "STOP. $list is not a list of deleted characters, so nothing was thrown away. Look at it, then run this again." -ForegroundColor Red
    exit 1
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$bin = Join-Path $World "_discarded-$stamp"
$gone = 0
$ids = @()
$notes = @()

foreach ($f in $characters) {
    $name = 'unnamed'
    try {
        $j = Get-Content -LiteralPath $f.FullName -Raw | ConvertFrom-Json
        if ($j.appearanceDump -and $j.appearanceDump.name) { $name = $j.appearanceDump.name }
        $profile = $j.profileId
    } catch { $profile = '?' }

    if (-not $PSCmdlet.ShouldProcess("$($f.Name) (profile $profile, '$name')", 'discard')) { continue }

    # Read before it goes: with -NoBackup there is nothing left to read after.
    $found = Get-ThornswoodCharacterIds @($f.FullName)
    try {
        if ($NoBackup) {
            Remove-Item -LiteralPath $f.FullName -Force -ErrorAction Stop
        } else {
            if (-not (Test-Path -LiteralPath $bin)) { New-Item -ItemType Directory -Path $bin -Force | Out-Null }
            Move-Item -LiteralPath $f.FullName -Destination (Join-Path $bin $f.Name) -Force -ErrorAction Stop
        }
    } catch {
        Write-Host ("  could not discard {0}: {1}" -f $f.Name, $_.Exception.Message) -ForegroundColor Red
        continue
    }
    Write-Host ("  discarded {0}  profile {1}  '{2}'" -f $f.Name, $profile, $name) -ForegroundColor Cyan
    $ids += @($found.ids)
    $notes += @($found.notes)
    $gone++
}

Write-Host ''
if ($gone -gt 0) {
    Write-Host "$gone character(s) gone. The next connect runs creation from the top." -ForegroundColor Green
    if (-not $NoBackup) { Write-Host "  the old ones are in $bin if you ever want them" -ForegroundColor DarkGray }
} else {
    Write-Host 'nothing changed.' -ForegroundColor Yellow
    return
}

# Only the characters, never the profile (#2668, #2673): Release-List.ps1 says why.
$bad = $false
foreach ($l in @($notes) + @(Write-ThornswoodReleaseList -Root $Root -Actors $ids)) {
    $b = "$l" -split '\|'
    switch ($b[0]) {
        'RELEASE'     { if ($b[1] -ne 'none') { Write-Host ("  release list: {0}, {1} character(s); the server lets go of what it holds of them at its next start" -f $b[1], $b[3]) -ForegroundColor DarkGray } }
        'RELEASENOTE' { Write-Host ('  ' + $b[1]) -ForegroundColor Yellow }
        default       { $bad = $true; Write-Host ('STOP. ' + $b[1]) -ForegroundColor Red }
    }
}
if ($bad) { exit 1 }
