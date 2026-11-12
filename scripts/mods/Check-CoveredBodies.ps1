<#
.SYNOPSIS
  Says whether every body the game folder shows people is covered by
  underwear, men and women alike, and exits 2 when one is not.

.DESCRIPTION
  Issue #405. Patrick, 28 Sep: "I really just want no nudity in players or
  NPCs for both males and females." A body in Skyrim is one mesh per sex
  (femalebody_0.nif and _1.nif, malebody_0.nif and _1.nif), and every actor of
  that sex wears it under whatever they have on: people, NPCs, a body on the
  ground after it has been looted, and the figure in the race menu. So the
  underwear has to be part of that mesh. Vanilla Skyrim's are: FemaleUnderwear
  and MaleUnderwear_1 are shapes inside the stock meshes. A body replacer that
  leaves them out makes everybody of that sex nude the moment their clothes
  come off.

  MEASURED 28 SEP on the shipping machine: the female body the collection
  deploys is CBBE 3BA 2.48's prebuilt mesh, shapes 3BA, 3BA_Vagina and
  3BA_Anus with no Bra or Panty, and the male body is HIMBO V5's NeverNude
  build, whose shapes include "HIMBO - Boxers". So the bodies are built
  covered, by the launcher on each computer since #3715 (records\generated.json),
  and this is the check that reads what was built and that nothing has undone
  it since. The launcher's build runs the same check, from the same code:
  launcher\app\CoveredBodies.cs, which this compiles (Generated.ps1).

  It reads each mesh's own list of shapes out of the nif (the names of its
  BSTriShape and NiTriShape blocks), rather than searching the file for a word:
  "Bra" turns up by chance in the bytes of malebody_1.nif, and bone names such
  as VaginaDeep1 and "NPC Genitals01" are in every skeleton-weighted body,
  covered or not. Then:

  - A woman's body (femalebody_0/_1) is covered when it has a shape for the
    top (Bra, a top, or a one-piece Underwear) and one for the bottom (Panty,
    Underwear, briefs, a loincloth).
  - Astrid's burned body (femalebodyastrid_0/_1, one NPC, after one Dark
    Brotherhood scene) is charred skin with no underwear even in Skyrim's own
    mesh, so it is listed on its own line and fails only when it carries a
    genital shape. Whether it should be covered as well is Patrick's call on
    issue #405.
  - A man's body (malebody_0/_1) is covered when it has a shape for the bottom
    (Boxers, Underwear, briefs, a loincloth).
  - A body that is not loose in Data comes from the game's own archive, and
    Skyrim's own bodies are covered.
  - Any other mesh under meshes\actors\character with a genital shape in it (a
    3BA extra body, The New Gentleman, Schlongs of Skyrim) has to cover it the
    same way, or it counts as nude too.

  First-person bodies are not checked: the first-person camera draws the arms
  and hands, never the torso.

  Read only. It opens meshes to read their headers and writes nothing.
  Exits 0 when every body is covered, 2 when one is nude, 1 when the folder
  is not there or a body mesh cannot be read.

.PARAMETER Game
  The game folder, the one with Data in it. Thornswood's own by default.

.PARAMETER Quiet
  Print only what is nude or unreadable, and the verdict.

.EXAMPLE
  .\scripts\mods\Check-CoveredBodies.ps1
  One line for each body mesh saying covered, nude or vanilla, with the shapes
  it found, then the verdict.

.EXAMPLE
  .\scripts\mods\Check-CoveredBodies.ps1 -Game C:\Thornswood-DevBuild\Game
  The same for the dev build's folder.
#>
#Requires -Version 7
[CmdletBinding()]
param(
    [string]$Game = ((& (Join-Path $PSScriptRoot '..\release\Where.ps1') Install) + '\Game'),
    [switch]$Quiet
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'Generated.ps1')

$said = [Action[string, string]] {
    param($m, $c)
    if ($c -eq 'Head') { $c = 'Cyan' }
    Write-Host $m -ForegroundColor $c
}
$r = [Thornswood.CoveredBodies]::Check($Game, [bool]$Quiet, $said)
exit $r.ExitCode
