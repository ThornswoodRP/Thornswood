<#
.SYNOPSIS
  Makes the main menu, the notice board's two meshes and the collection's menus with no gold values from a game's own archives the way the launcher does, and says whether each came out byte for byte (#2827, #3113).

.DESCRIPTION
  Since #2827 Thornswood ships none of Data\Interface\startmenu.swf,
  Data\meshes\thornswood\noticeboard01.nif and dropbox01.nif: each is
  Bethesda's own file edited or put together, so the launcher makes them on
  each machine from that machine's game (launcher\app\MadeFromGame.cs). This
  compiles the launcher's own code for it (launcher\app\FromGame*.cs, with the
  recipes FromGameMenu.cs and FromGameBoard.cs that scripts\mods\Build-StartMenu.py
  and Build-NoticeBoard.py write), makes the three from -Data, and prints for
  each whether it is the sha256 the recipe says, or why not. It is how a
  machine with the game proves a recipe before it is merged, and how anybody
  finds out why their launcher says it could not make one.

  The same goes for the five files of the collection's mods made with no gold
  values since #3113 (SkyUI's config.txt and itemcard.swf, SkyHUD's
  hudmenu.swf, moreHUD's AHZHudInfo.swf twice), and SkyUI's quest_journal.swf
  with no saving, loading, help or Creation Club since #3127, from the recipes
  in FromGameModMenus.cs that scripts\mods\Build-ModMenus.py writes: they are
  their authors' files, made from the mods' own archives in -Data.

  Reads the archives and writes nothing, unless -Out names a folder to write
  them into, to look at. -Out may not be inside the repository: the files
  are Bethesda's and the mods' authors', and are not to be committed.

.PARAMETER Data
  The game's Data folder, whose Skyrim - Interface.bsa and Skyrim - Meshes0.bsa
  and Meshes1.bsa are read, and SkyUI_SE.bsa, SkyHUD.bsa and AHZmoreHUD.bsa. Default Game\Data in the install Where.ps1
  Install finds (C:\Thornswood on most machines).

.PARAMETER Out
  A folder to write them into, under their game folder paths. Optional.

.EXAMPLE
  pwsh -NoProfile -File .\scripts\mods\Check-FromGame.ps1
  Exit 0 when every one comes out byte for byte, 1 when one does not.
#>
#Requires -Version 7
[CmdletBinding()]
param(
  [string] $Data = ((& (Join-Path $PSScriptRoot '..\release\Where.ps1') Install) + '\Game\Data'),
  [string] $Out = ''
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if ($Out) {
  $full = [IO.Path]::GetFullPath($Out)
  if ($full.StartsWith($repo + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    Write-Host 'STOP. -Out is inside the repository; these are Bethesda''s and the mods'' authors'' files and are not to be committed (#2827, #3113).'
    exit 1
  }
}
if (-not ('Thornswood.FromGame' -as [type])) {
  Add-Type -Path @(Get-ChildItem -LiteralPath (Join-Path $repo 'launcher\app') -Filter 'FromGame*.cs' -File | ForEach-Object { $_.FullName })
}
$bad = 0
foreach ($f in [Thornswood.FromGame]::Build($Data)) {
  if ($f.Problem) {
    $bad++
    Write-Host ('  NOT MADE  {0}: {1}' -f $f.Rel, $f.Problem) -ForegroundColor Red
    continue
  }
  Write-Host ('  ok        {0}  {1:n0} bytes, sha256 {2}' -f $f.Rel, $f.Bytes.Length, $f.Sha256)
  if ($Out) {
    $dst = Join-Path $Out $f.Rel
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dst) | Out-Null
    [IO.File]::WriteAllBytes($dst, $f.Bytes)
    Write-Host ('            wrote {0}' -f $dst)
  }
}
if ($bad) { exit 1 }
exit 0
