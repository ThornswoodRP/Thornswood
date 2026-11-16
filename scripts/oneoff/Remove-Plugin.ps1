<#
  Remove-Plugin.ps1

  RETIRED. DO NOT RUN. Issue #1179: took one plugin out of the build by hand. The collection (or the settled load order) does this now. It refuses to run, and the rest of the file is kept for the history of how it was installed. Pattern from #405 Add-Bodies.

  What it used to do, and what is left of it:

      .\scripts\oneoff\Remove-Plugin.ps1

  Takes one plugin out of the Thornswood build, reversibly.

  It moves the plugin and any archive named after it into Game\_removed with
  today's date on it, and takes the line out of plugins.txt so the next
  Deploy-Gamemode builds a load order without it. Nothing is deleted.

  Read this before using it. SkyMP turns a form id into a plugin with plain
  arithmetic on the plugin's POSITION in the load order. Take one out of the
  middle and every plugin below it moves up a slot, so a stored reference made
  under the old numbering now points at a different plugin. That is why this
  prints the slot it is removing and how many move, and why the honest way to
  follow it is Wipe-Saves.ps1 rather than hoping.

  Doing this to the last plugin in the list moves nothing and is free. Doing it
  to slot 6 of 61 moves 55.
#>
#Requires -Version 7
[CmdletBinding()]
param(
  [string]$Plugin,
  [string]$Root = (& (Join-Path $PSScriptRoot '..\release\Where.ps1') Install),
  [switch]$NoPause
)
# The refusal comes before anything else, above the strict mode line and above
# the dot source below it, so no part of the install can run by accident.
throw ('STOP. Remove-Plugin.ps1 is retired and installs nothing (issue #1179). ' +
       'Plugins leave through the Nexus collection revision, not a hand removal that rewrites plugin lists and Vortex staging. ' +
       'The file is kept for the history of how it was installed. Delete this line only if ' +
       'hand installs are meant again, and read the header first.')


$ErrorActionPreference = 'Stop'

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
function Die($m) {
  Write-Host ''
  Write-Host "STOP. $m" -ForegroundColor Red
  if (-not $NoPause) { [void](Read-Host 'Enter to exit') }
  exit 1
}

$Data     = Join-Path $Root 'Game\Data'
$PlugFile = Join-Path $Root 'Profile\Default\plugins.txt'
$stamp    = (Get-Date).ToString('yyyyMMdd-HHmm')

Write-Host ''
Write-Host '  THORNSWOOD  -  take a plugin out of the build' -ForegroundColor White

if (-not (Test-Path -LiteralPath $Data)) { Die "No Data folder at $Data" }

if (-not $Plugin) {
  Write-Host ''
  $Plugin = (Read-Host '  Which plugin (for example Something.esp)').Trim()
}
$Plugin = "$Plugin".Trim().Trim('"')
if (-not $Plugin) { Die 'Nothing given.' }
if ($Plugin -notmatch '\.es[pml]$') { Die "That does not look like a plugin: $Plugin" }

$full = Join-Path $Data $Plugin
if (-not (Test-Path -LiteralPath $full)) { Die "Not in the build: $full" }

# ------------------------------------------------------ what moves with it ---
Head 'What goes'
$base = [IO.Path]::GetFileNameWithoutExtension($Plugin)
$take = @((Get-Item -LiteralPath $full))
foreach ($b in (Get-ChildItem -LiteralPath $Data -Filter ($base + '*.bsa') -File -EA SilentlyContinue)) {
  $take += $b
}
foreach ($t in $take) { Say ("  {0,10:n1} MB  {1}" -f ($t.Length / 1MB), $t.Name) }

# --------------------------------------------------------- what it costs ---
Head 'What it moves in the load order'
$lines = @()
if (Test-Path -LiteralPath $PlugFile) {
  $lines = @(Get-Content -LiteralPath $PlugFile)
  $idx = -1
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i].TrimStart('*').Trim() -ieq $Plugin) { $idx = $i; break }
  }
  if ($idx -lt 0) { Say "  $Plugin is not in plugins.txt, so the load order does not change." 'DarkGray' }
  else {
    $below = $lines.Count - $idx - 1
    Say ("  it is line {0} of {1}" -f ($idx + 1), $lines.Count)
    if ($below -eq 0) { Say '  nothing is below it, so no index moves. This one is free.' 'Green' }
    else {
      Say ("  {0} plugin(s) below it move up a slot" -f $below) 'Yellow'
      Say '  Stored form references made under the old numbering will point at' 'Yellow'
      Say '  the wrong plugin. Run Wipe-Saves.ps1 after this, or expect trouble' 'Yellow'
      Say '  that looks like characters losing things at random.' 'Yellow'
    }
  }
}
else { Say "  no plugins.txt at $PlugFile, so only the files move." 'DarkGray' }

Write-Host ''
$yes = Read-Host "  Move $Plugin out of the build? (y/n)"
if ("$yes".Trim().ToLower() -ne 'y') { Die 'Left alone.' }

# ------------------------------------------------------------------ do it ---
Head 'Moving'
$dest = Join-Path $Data ('_removed\' + $stamp)
[void](New-Item -ItemType Directory -Path $dest -Force)
foreach ($t in $take) {
  Move-Item -LiteralPath $t.FullName -Destination (Join-Path $dest $t.Name) -Force
  Say ("  {0}  ->  _removed\{1}" -f $t.Name, $stamp) 'Green'
}

if ($lines.Count) {
  $kept = @($lines | Where-Object { $_.TrimStart('*').Trim() -ine $Plugin })
  if ($kept.Count -ne $lines.Count) {
    [IO.File]::WriteAllLines($PlugFile, $kept, (New-Object Text.UTF8Encoding($false)))
    Say ("  plugins.txt is now {0} line(s), was {1}" -f $kept.Count, $lines.Count) 'Green'
  }
}

Head 'What now'
Say '  1. .\scripts\deploy\Deploy-Gamemode.ps1     rebuild the server load order' 'DarkGray'
Say '  2. .\scripts\deploy\Deploy-Server.ps1       send it up' 'DarkGray'
Say '  3. .\scripts\ops\Wipe-Saves.ps1          if anything moved above' 'DarkGray'
Say '  4. .\scripts\release\Check-Build.ps1         confirm the build still matches' 'DarkGray'
Write-Host ''
Say "  The files are in Game\Data\_removed\$stamp if you want them back." 'DarkGray'
Write-Host ''
if (-not $NoPause) { [void](Read-Host 'Enter to close') }
