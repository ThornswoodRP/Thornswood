<#
  Fix-MaleBody.ps1

  RETIRED. DO NOT RUN. Issue #1179: moved the collection's HIMBO male body aside by hand. The collection (or the settled load order) does this now. It refuses to run, and the rest of the file is kept for the history of how it was installed. Pattern from #405 Add-Bodies.

  What it used to do, and what is left of it:

  The male body mesh in the game folder is a genital-slotted one, left behind
  when The New Gentleman was taken out. The plugin that supplied the part is
  gone, so the slot in the body renders as a hole you can see the sky through.

  malebody_0.nif here is about 1 MB. The stock one inside Skyrim - Meshes0.bsa
  is a fraction of that and has no slot, so moving the loose files aside is the
  whole fix: the archive supplies the body again the moment nothing overrides
  it. Nothing is deleted, so putting it back is one move.

  The female body is left alone. It is a CBBE build with no slot and no missing
  part, and replacing it would undo work that is not broken.
#>
#Requires -Version 7
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$Data = ((& (Join-Path $PSScriptRoot '..\release\Where.ps1') Install) + '\Game\Data'),
    [switch]$Undo
)
# The refusal comes before anything else, above the strict mode line and above
# the dot source below it, so no part of the install can run by accident.
throw ('STOP. Fix-MaleBody.ps1 is retired and installs nothing (issue #1179). ' +
       'The male body meshes come from the Nexus collection now. Moving HIMBO leftovers by hand writes into Game\Data and, where those files are Vortex links, into staging. ' +
       'The file is kept for the history of how it was installed. Delete this line only if ' +
       'hand installs are meant again, and read the header first.')


$assets = Join-Path $Data 'meshes\actors\character\character assets'
$stash  = Join-Path $Data '_removedBody\meshes\actors\character\character assets'
$names  = 'malebody_0.nif', 'malebody_1.nif', 'malebody.tri'

if (-not (Test-Path -LiteralPath $assets)) { throw "not found: $assets" }

$from = if ($Undo) { $stash }  else { $assets }
$to   = if ($Undo) { $assets } else { $stash }

if (-not (Test-Path -LiteralPath $to)) { New-Item -ItemType Directory -Path $to -Force | Out-Null }

$moved = 0
foreach ($n in $names) {
    $src = Join-Path $from $n
    if (-not (Test-Path -LiteralPath $src)) {
        Write-Host ("  not there  {0}" -f $n) -ForegroundColor DarkGray
        continue
    }
    $mb = [math]::Round((Get-Item -LiteralPath $src).Length / 1MB, 2)
    if (-not $PSCmdlet.ShouldProcess($n, $(if ($Undo) { 'restore' } else { 'move aside' }))) { continue }
    Move-Item -LiteralPath $src -Destination (Join-Path $to $n) -Force
    Write-Host ("  {0,-18} {1} MB  ->  {2}" -f $n, $mb, (Split-Path $to -Leaf)) -ForegroundColor Cyan
    $moved++
}

Write-Host ''
if ($moved -eq 0) {
    Write-Host 'nothing moved.' -ForegroundColor Yellow
} elseif ($Undo) {
    Write-Host "$moved file(s) restored. The slotted body is back." -ForegroundColor Green
} else {
    Write-Host "$moved file(s) moved aside. Skyrim falls back to the body in Skyrim - Meshes0.bsa." -ForegroundColor Green
    Write-Host 'Run with -Undo to put them back.' -ForegroundColor DarkGray
}
