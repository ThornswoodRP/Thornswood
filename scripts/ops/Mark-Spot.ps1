<#
  Mark-Spot.ps1

  Reads the spots you marked in game and prints them in the shape the content
  table wants.

  Why this exists: the arrival coordinates for the nine inns were first
  written by hand, each one the inn's front door moved 110 units along the
  door's own heading, and seven of those eight were not in the room. 1.1.41
  walked five; Solitude, Falkreath and Dawnstar now use the spot the game puts
  you on when you walk in the front door. The old Morthal and Dawnstar points
  only looked like one spot because the two inns share a layout: interior
  coordinates belong to their own cell.

  So they get measured. Walk into an inn, stand where a person should arrive,
  face the way they should be facing, and press the mark key. The plugin writes
  the cell, the position and the angle straight out of the game. Then run this,
  paste what it prints, and the guesswork is gone for good.

  The key is Mark in Data\SKSE\Plugins\Thornswood.ini, F8 by default.
#>
#Requires -Version 7
[CmdletBinding()]
param(
    [string]$Game = ((& (Join-Path $PSScriptRoot '..\release\Where.ps1') Install) + '\Game'),
    [switch]$Clear
)

$ErrorActionPreference = 'Stop'
$file = Join-Path $Game 'Data\Platform\thornswood-spots.txt'

if ($Clear) {
    if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force }
    Write-Host 'Cleared. Go and mark them again.' -ForegroundColor Cyan
    return
}

if (-not (Test-Path -LiteralPath $file)) {
    Write-Host ''
    Write-Host 'Nothing marked yet.' -ForegroundColor Yellow
    Write-Host ''
    Write-Host '  Start the game, walk into an inn, stand where somebody should arrive,' -ForegroundColor Gray
    Write-Host '  face the way they should face, and press the mark key (F8 by default).' -ForegroundColor Gray
    Write-Host '  Do that in each inn you care about, quit, then run this again.' -ForegroundColor Gray
    Write-Host ''
    return
}

$rows = @()
foreach ($line in (Get-Content -LiteralPath $file)) {
    $t = $line.Trim()
    if (-not $t -or $t.StartsWith('#')) { continue }
    # cell<TAB>formIdHex<TAB>x<TAB>y<TAB>z<TAB>angleZ
    $p = $t -split "`t"
    if ($p.Count -lt 6) { continue }
    $rows += [pscustomobject]@{
        Cell = $p[0]
        Form = $p[1]
        X    = [double]$p[2]
        Y    = [double]$p[3]
        Z    = [double]$p[4]
        Rot  = [double]$p[5]
    }
}

if (-not $rows.Count) { Write-Host 'The file is there but has nothing in it.' -ForegroundColor Yellow; return }

# Last mark of a cell wins, so walking back and marking again is how you correct
# one without editing anything.
$best = @{}
foreach ($r in $rows) { $best[$r.Cell] = $r }

Write-Host ''
Write-Host ("{0} spot(s) marked" -f $best.Count) -ForegroundColor Cyan
Write-Host ''
foreach ($k in ($best.Keys | Sort-Object)) {
    $r = $best[$k]
    Write-Host ("  {0,-32} {1}" -f $r.Cell, $r.Form) -ForegroundColor Gray
    Write-Host ('    "arrival": {{"cell":"{0}","desc":"{1}","pos":[{2},{3},{4}],"rot":[0,0,{5}]}}' -f `
        $r.Cell, $r.Form, $r.X, $r.Y, $r.Z, $r.Rot) -ForegroundColor Green
}
Write-Host ''
Write-Host 'Paste that to Claude and it goes into the content table.' -ForegroundColor DarkGray
Write-Host ''
