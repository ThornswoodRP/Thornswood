<#
.SYNOPSIS
  Does anything in the load order need the paid Anniversary upgrade?

.DESCRIPTION
  Does anything in the load order need the paid Anniversary upgrade?

      .\scripts\mods\Check-Editions.ps1
      .\scripts\mods\Check-Editions.ps1 -Full     print every plugin and its masters

  WHY IT MATTERS. Requiring paid content means half the people who would join
  cannot. The download page already says Special Edition on build 1.6.1170 and
  that the Anniversary Edition is not required and never will be. Nothing
  checked that it stayed true, and a plugin that quietly declares a Creation
  Club master would make both sentences false the day it was added.

  WHAT IT CAN AND CANNOT SEE. It reads the MAST records of the TES4 header, so
  it catches a DECLARED dependency, which is the kind that crashes the game at
  load with a missing master. It cannot see a plugin that references a Creation
  Club form id without declaring the master, and it cannot see a mesh or a
  texture that only ships with the upgrade. Those need xEdit and a pair of
  eyes. A clean run here is a floor, not a ceiling, and the message says so.
  The first of those now has its own check (#479): a form id can only point
  into a file its plugin declares, so the undeclared case is a plugin pointing
  at one of the Creation Club records Bethesda keeps in Update.esm, and
  scripts\mods\Check-CreationForms.js reads every record of every plugin for
  that, and the gamemode's tables too. The mesh and texture case is still eyes.

  _ResourcePack.esl is NOT a cut candidate. Bethesda's own free update
  1.6.1130 put it and its archive in every Data folder, and Skyrim.ccc names
  it. It is part of the base game now.

  Exit 0 when nothing in the order needs the upgrade, 1 when something does,
  and 0 with a SKIP when this machine has no game folder to read, so the build
  check can run it on a runner that has neither.

  Read only. It opens plugin headers and writes nothing.
#>
[CmdletBinding()]
param(
  [string]$Data,
  [string]$Plugins,
  [switch]$Full,
  [switch]$NoPause
)

$ErrorActionPreference = 'Continue'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }

# Where the game and the list are, unless told otherwise: under the launcher
# install, which Where.ps1 Install finds (#3003), so a second developer on
# another drive is found.
if (-not $Data -or -not $Plugins) {
  $root = [string](& (Join-Path $Here '..\release\Where.ps1') Install)
  if (-not $Data)    { $Data    = Join-Path $root 'Game\Data' }
  if (-not $Plugins) { $Plugins = Join-Path $root 'Profile\LocalAppData\plugins.txt' }
}

Write-Host ''
Write-Host '  THORNSWOOD  -  does the load order need the Anniversary upgrade?' -ForegroundColor White

if (-not (Test-Path -LiteralPath $Data) -or -not (Test-Path -LiteralPath $Plugins)) {
  Write-Host ''
  Say '  SKIP. No game folder and plugin list on this machine, so there is' 'DarkGray'
  Say '  nothing to read. This is the answer on a build runner.' 'DarkGray'
  Say ("    looked for $Data") 'DarkGray'
  Say ("    and        $Plugins") 'DarkGray'
  Write-Host ''
  if (-not $NoPause) { [void](Read-Host 'Enter to close') }
  exit 0
}

# The base game, plus the two free things Bethesda has since added to every
# install. Anything else with a cc prefix is Creation Club and is the upgrade.
$freeBase = @(
  'Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm',
  '_ResourcePack.esl'
)

# Every master a plugin declares, out of the MAST records in its header.
function Get-DeclaredMasters([string]$path) {
  $out = @()
  try {
    $fs = [IO.File]::Open($path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
    try {
      $len = [Math]::Min(16384, $fs.Length)
      $b = New-Object byte[] $len
      [void]$fs.Read($b, 0, $len)
    } finally { $fs.Close() }
  } catch { return $out }
  for ($i = 0; $i -lt $b.Length - 6; $i++) {
    # 'MAST', then a UInt16 length, then the name.
    if ($b[$i] -eq 0x4D -and $b[$i+1] -eq 0x41 -and $b[$i+2] -eq 0x53 -and $b[$i+3] -eq 0x54) {
      $sz = [BitConverter]::ToUInt16($b, $i + 4)
      if ($sz -gt 0 -and $sz -lt 260 -and ($i + 6 + $sz) -le $b.Length) {
        $s = [Text.Encoding]::GetEncoding(1252).GetString($b, $i + 6, $sz).TrimEnd([char]0)
        if ($s -match '\.es[pml]$') { $out += $s }
      }
    }
  }
  return @($out | Select-Object -Unique)
}

$enabled = @()
foreach ($l in (Get-Content -LiteralPath $Plugins)) {
  $t = "$l".Trim()
  if ($t.StartsWith('*')) {
    $n = $t.Substring(1).Trim()
    if ($n.Length) { $enabled += $n }
  }
}

Head "Reading $($enabled.Count) enabled plugins"

$paid = @()          # plugins declaring a Creation Club master
$ccEnabled = @()     # Creation Club plugins the list itself switches on
$absent = @()
$rows = @()

foreach ($n in $enabled) {
  $p = Join-Path $Data $n
  if (-not (Test-Path -LiteralPath $p)) { $absent += $n; continue }
  $masters = Get-DeclaredMasters $p
  $rows += [pscustomobject]@{ Name = $n; Masters = $masters }

  if ($n -like 'cc*' -and $freeBase -notcontains $n) { $ccEnabled += $n }

  foreach ($m in $masters) {
    if ($freeBase -contains $m) { continue }
    if ($m -like 'cc*') { $paid += ("$n needs $m"); continue }
  }
}

if ($Full) {
  foreach ($r in $rows) {
    $m = if ($r.Masters.Count) { ($r.Masters -join ', ') } else { 'none' }
    Say ("  {0,-46} {1}" -f $r.Name, $m) 'DarkGray'
  }
  Write-Host ''
}

Say ("  {0} read, {1} named but not in Data" -f $rows.Count, $absent.Count)
if ($absent.Count -and $Full) { foreach ($a in $absent) { Say "    $a" 'DarkGray' } }

Head 'Creation Club'
$bad = 0

if ($ccEnabled.Count) {
  $bad++
  Say ("  {0} Creation Club plugin(s) are enabled in the list:" -f $ccEnabled.Count) 'Red'
  foreach ($c in $ccEnabled) { Say "    $c" 'Red' }
} else {
  Say '  no Creation Club plugin is enabled in the list' 'Green'
}

if ($paid.Count) {
  $bad++
  Say ("  {0} plugin(s) declare a Creation Club master:" -f $paid.Count) 'Red'
  foreach ($x in $paid) { Say "    $x" 'Red' }
} else {
  Say '  nothing declares a Creation Club master' 'Green'
}

Write-Host ''
Write-Host ('  ' + ('=' * 68)) -ForegroundColor DarkGray
if ($bad) {
  Write-Output '  The load order needs the paid Anniversary upgrade.'
  Write-Host ''
  Say '  The download page says Special Edition is enough and that the' 'Yellow'
  Say '  Anniversary Edition is not required and never will be. One of those' 'Yellow'
  Say '  two things has to change.' 'Yellow'
  Write-Host ''
  Say '  Taking a plugin out moves the load order for everybody at once, so it' 'Yellow'
  Say '  is one complete release with the server, not a tickbox. Pull it from' 'Yellow'
  Say '  the collection in Vortex, never by editing plugins.txt.' 'Yellow'
  Write-Host ''
  if (-not $NoPause) { [void](Read-Host 'Enter to close') }
  exit 1
}

Write-Output '  Special Edition is enough for everything in this load order.'
Write-Host ''
Say '  What this does NOT check:' 'DarkGray'
Say '    a plugin pointing at a Creation Club record without declaring a master:' 'DarkGray'
Say '      node scripts\mods\Check-CreationForms.js reads every record for that' 'DarkGray'
Say '    a mesh or texture that only ships with the upgrade: nothing automatic can.' 'DarkGray'
Say '  That last one needs somebody looking, in a playtest on a machine with no' 'DarkGray'
Say '  Creation Club files. A clean run here is the floor, not the ceiling.' 'DarkGray'
Write-Host ''
if (-not $NoPause) { [void](Read-Host 'Enter to close') }
exit 0
