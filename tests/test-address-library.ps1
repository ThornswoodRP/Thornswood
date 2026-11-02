<#
  test-address-library.ps1

      pwsh -NoProfile -File .\tests\test-address-library.ps1

  The Address Library row on the launcher's Play page. To Do List entry 264:
  "The launcher never checks the Address Library, so a whole class of failure
  reads as green".

  WHY IT MATTERS. Script extender plugins look the game's addresses up in
  Data\SKSE\Plugins\versionlib-<build>.bin, and one that needs it and cannot
  find it does not load. EngineFixes says "failed to locate an appropriate
  address library" and stays out. Setup-Thornswood.ps1 has tested for the file
  all along; the launcher's nine rows never did, so the Play page read all
  green while those plugins stayed out of the game.

  THE ROW IS ADVISORY. It turns amber and never shuts Play. A new row that
  blocks and is wrong on somebody's machine locks them out with nothing they
  can press, so these check that a failing Address Library row leaves Play
  alone as hard as they check that it fails.

  WHICH FILE. The row names the file from SkyrimSE.exe's own version, because
  that is how the plugins name it when the game starts. Measured on
  24 September: C:\Thornswood\Game\SkyrimSE.exe reads 1.6.1170.0 and
  versionlib-1-6-1170-0.bin (795,129 bytes) is the file beside it.

  WHAT IT SAYS TO DO. Missing on the right build, the fix is the collection
  in Vortex, the words the join page uses. Missing on the wrong build, the fix
  is the downgrade, because the launcher keeps the collection card down until
  the build is right and the row must not send somebody the other way.

  This lifts class Check and the three AddressLibrary methods out of the
  shipped Checks.cs by text and builds them the way the launcher project
  builds (the .NET 10 SDK, tests\Launcher-Csc.ps1), so what runs is the
  shipped code rather than a copy of it. The fake game folders get a
  SkyrimSE.exe built the same way, an assembly whose file version is the
  build under test, which FileVersionInfo reads on Windows and Linux alike.

  Read only apart from files under its own temp folder. It reads
  C:\Thornswood\Game when it is there and says SKIP when it is not.
#>
[CmdletBinding()]
param([string]$ChecksPath, [string]$ShellPath, [string]$UiPath)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Launcher-Csc.ps1')   # builds launcher code the way the project does (#498, #4823)
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# The tests are in tests\, the repository is one folder up.
$Here = Split-Path -Parent $Here
if (-not $ChecksPath) { $ChecksPath = Join-Path $Here 'launcher\app\Checks.cs' }
if (-not $ShellPath)  { $ShellPath  = Join-Path $Here 'launcher\app\Shell.cs' }
if (-not $UiPath)     { $UiPath     = Join-Path $Here 'launcher\app\MainWindow.axaml' }

$pass = 0; $fail = 0
function Yes($what, $cond) {
  if ($cond) { $script:pass++; Write-Host "PASS  $what" -ForegroundColor Green }
  else       { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
function Done {
  Write-Host ''
  Write-Host "$script:pass passed, $script:fail failed"
  if ($script:fail) { exit 1 } else { exit 0 }
}

# From the start of $at to the brace that closes the first block after it.
function Lift([string]$src, [int]$at) {
  if ($at -lt 0) { return $null }
  $open = $src.IndexOf('{', $at)
  if ($open -lt 0) { return $null }
  $depth = 0
  for ($i = $open; $i -lt $src.Length; $i++) {
    $ch = $src[$i]
    if ($ch -eq [char]'{') { $depth++ }
    elseif ($ch -eq [char]'}') {
      $depth--
      if ($depth -eq 0) { return $src.Substring($at, $i - $at + 1) }
    }
  }
  return $null
}
function LiftAfter([string]$src, [string]$head) { return (Lift $src $src.IndexOf($head)) }

$checksSrc = [IO.File]::ReadAllText($ChecksPath)
$shellSrc  = [IO.File]::ReadAllText($ShellPath)
$uiSrc     = [IO.File]::ReadAllText($UiPath)

# ---- the shipped code, lifted -----------------------------------------------
$m = [regex]::Match($checksSrc, '(?m)^[ \t]*class Check[ \t]*\r?$')
$checkClass = if ($m.Success) { Lift $checksSrc $m.Index } else { $null }
$row  = LiftAfter $checksSrc 'public static Check AddressLibraryRow('
$file = LiftAfter $checksSrc 'public static string AddressLibraryFile('
$name = LiftAfter $checksSrc 'public static string AddressLibraryName('

Yes 'Checks.cs has class Check'                        ($null -ne $checkClass)
Yes 'Checks.cs has AddressLibraryRow, the row itself'  ($null -ne $row)
Yes 'Checks.cs has AddressLibraryFile'                 ($null -ne $file)
Yes 'Checks.cs has AddressLibraryName'                 ($null -ne $name)
if (-not ($checkClass -and $row -and $file -and $name)) {
  Yes 'there is launcher code to run' $false
  Done
}

Yes 'the .NET SDK the launcher builds with is on this machine' (Test-Path -LiteralPath $LauncherDotnet)
if (-not (Test-Path -LiteralPath $LauncherDotnet)) { Done }

$root = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-addrlib-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Force -Path $root

# An assembly whose file version is the one given, copied to $out. The SDK's
# own version attributes are left out, so the one in the source is the one
# FileVersionInfo reads.
function New-Versioned([string]$version, [string]$out) {
  $dll = Build-LauncherCode -Source ('[assembly: System.Reflection.AssemblyFileVersion("' + $version + '")] class FakeSkyrim { }') -Property @{ GenerateAssemblyInfo = 'false' }
  Copy-Item -LiteralPath $dll -Destination $out -Force
}

# A game folder: a SkyrimSE.exe with this version (or none, or one that is not
# an exe at all), and these files in Data\SKSE\Plugins.
function New-Game([string]$label, [string]$version, [string[]]$bins, [switch]$NotAnExe, [switch]$NoPlugins) {
  $game = Join-Path $root $label
  $null = New-Item -ItemType Directory -Force -Path $game
  $exe = Join-Path $game 'SkyrimSE.exe'
  if ($NotAnExe) {
    [IO.File]::WriteAllText($exe, 'not an exe')
  } elseif ($version) {
    New-Versioned $version $exe
  }
  if (-not $NoPlugins) {
    $plugins = Join-Path $game 'Data\SKSE\Plugins'
    $null = New-Item -ItemType Directory -Force -Path $plugins
    foreach ($b in $bins) { [IO.File]::WriteAllBytes((Join-Path $plugins $b), [byte[]](1, 2, 3)) }
  }
  return $game
}

try {
  $lifted = @"
using System;
using System.Diagnostics;
using System.IO;
namespace TsTest264
{
    public $checkClass

    public static class Checks
    {
        $row

        $file

        $name
    }
}
"@
  $compiled = $true
  try { $null = Add-LauncherType -Source $lifted }
  catch { $compiled = $false; Write-Host $_.Exception.Message }
  Yes 'the lifted launcher code builds the way the launcher does' $compiled
  if (-not $compiled) { Done }

  # ---- the name, for one build ----------------------------------------------
  Yes '1.6.1170 is versionlib-1-6-1170-0.bin, the file Setup-Thornswood.ps1 tests for' `
      ([TsTest264.Checks]::AddressLibraryName(1, 6, 1170, 0) -eq 'versionlib-1-6-1170-0.bin')
  Yes '1.6.317, the first 1.6 build, is still a versionlib file' `
      ([TsTest264.Checks]::AddressLibraryName(1, 6, 317, 0) -eq 'versionlib-1-6-317-0.bin')
  Yes 'a 1.5 build is the older version- file' `
      ([TsTest264.Checks]::AddressLibraryName(1, 5, 97, 0) -eq 'version-1-5-97-0.bin')
  Yes 'no version gives no name' `
      ([TsTest264.Checks]::AddressLibraryName(0, 0, 0, 0) -eq '')

  # ---- whether a row blocks -------------------------------------------------
  # The nine rows that were there before still use the three argument
  # constructor, so they must still shut Play when they fail.
  Yes 'an ordinary row that fails still shuts Play' `
      ([TsTest264.Check]::new('Mods', $false, '32 plugins').Blocks)
  Yes 'an ordinary row that passes does not' `
      (-not [TsTest264.Check]::new('Mods', $true, '96 plugins').Blocks)
  Yes 'an advisory row that fails does not shut Play' `
      (-not [TsTest264.Check]::new('x', $false, 'y', $true).Blocks)

  # ---- the row, with nothing for it to find ----------------------------------
  # These read no Address Library file, so they run on any system.
  # A missing exe also fails the Game build row, so buildRight is false here.
  # Not knowing the build has to win over naming a fix for it.
  $noexe = New-Game 'noexe' '' @('versionlib-1-6-1170-0.bin')
  $r = [TsTest264.Checks]::AddressLibraryRow($noexe, $false)
  Yes 'the row is called Address Library'                        ($r.Name -eq 'Address Library')
  Yes 'no SkyrimSE.exe: it says it cannot tell rather than guessing' `
      ((-not $r.Ok) -and $r.Detail -eq 'cannot tell, SkyrimSE.exe gives no version')
  Yes 'and does not shut Play'                                   (-not $r.Blocks)

  $junk = New-Game 'junk' '' @('versionlib-1-6-1170-0.bin') -NotAnExe
  $r = [TsTest264.Checks]::AddressLibraryRow($junk, $false)
  Yes 'a SkyrimSE.exe with no version in it: cannot tell, and no throw' `
      ((-not $r.Ok) -and $r.Detail -eq 'cannot tell, SkyrimSE.exe gives no version' -and (-not $r.Blocks))

  $r = [TsTest264.Checks]::AddressLibraryRow($null, $true)
  Yes 'a game folder that is not known yet does not throw' `
      ((-not $r.Ok) -and (-not $r.Blocks))

  # ---- the row, against game folders ----------------------------------------
  # The row looks under Data\SKSE\Plugins with Windows' separator, as the
  # game is a Windows game, so these run on Windows.
  if ($OnWindows) {
    $good = New-Game 'good' '1.6.1170.0' @('versionlib-1-6-1170-0.bin', 'versionlib-1-6-1130-0.bin', 'version-1-5-97-0.bin')
    $r = [TsTest264.Checks]::AddressLibraryRow($good, $true)
    Yes 'installed: the row is green'                              ($r.Ok)
    Yes 'installed: it names the build, "versionlib 1.6.1170"'     ($r.Detail -eq 'versionlib 1.6.1170')
    Yes 'installed: it does not shut Play'                         (-not $r.Blocks)

    $b = ''
    $f = [TsTest264.Checks]::AddressLibraryFile($good, [ref]$b)
    Yes 'the file it looks for is under Data\SKSE\Plugins' `
        ($f -eq (Join-Path $good 'Data\SKSE\Plugins\versionlib-1-6-1170-0.bin'))
    Yes 'and the build comes back as 1.6.1170'                     ($b -eq '1.6.1170')

    # Other builds' files sitting there are not this build's. This is the case
    # a "is any versionlib there" test would have called green.
    $wrong = New-Game 'wrong' '1.6.1170.0' @('versionlib-1-6-1130-0.bin', 'versionlib-1-6-1179-0.bin', 'version-1-5-97-0.bin')
    $r = [TsTest264.Checks]::AddressLibraryRow($wrong, $true)
    Yes 'only other builds'' files: the row fails'                  (-not $r.Ok)
    Yes 'it says what is missing and what fixes it' `
        ($r.Detail -eq 'missing for 1.6.1170, install the collection in Vortex')
    Yes 'it is advisory'                                           ($r.Advisory)
    Yes 'and it does not shut Play'                                (-not $r.Blocks)

    # A Steam update moved the exe on and the Address Library has no file for
    # the new build. Vortex does not fix that; the downgrade does, and the
    # collection card is held down until it has.
    $newer = New-Game 'newer' '1.7.104.0' @('versionlib-1-6-1170-0.bin', 'versionlib-1-6-1179-0.bin')
    $r = [TsTest264.Checks]::AddressLibraryRow($newer, $false)
    Yes 'wrong build, no file for it: the row fails' `
        (-not $r.Ok)
    Yes 'wrong build: it sends somebody to the downgrade, not to Vortex' `
        ($r.Detail -eq 'missing for 1.7.104, downgrade first')
    Yes 'wrong build: still advisory, the Game build row is what shuts Play' `
        ($r.Advisory -and -not $r.Blocks)

    $none = New-Game 'none' '1.6.1170.0' @() -NoPlugins
    $r = [TsTest264.Checks]::AddressLibraryRow($none, $true)
    Yes 'no Plugins folder at all: the row fails without throwing' `
        ((-not $r.Ok) -and $r.Detail -eq 'missing for 1.6.1170, install the collection in Vortex')
    Yes 'and does not shut Play'                                   (-not $r.Blocks)

    # The row follows the exe, not a pinned name, so moving the pin needs no
    # edit here.
    $other = New-Game 'other' '1.6.1130.0' @('versionlib-1-6-1130-0.bin')
    $r = [TsTest264.Checks]::AddressLibraryRow($other, $false)
    Yes 'a 1.6.1130 exe looks for the 1.6.1130 file, not a pinned one' `
        ($r.Ok -and $r.Detail -eq 'versionlib 1.6.1130')

  } else {
    Write-Host 'SKIP  the row against game folders with the Address Library in them: the row reads Data\SKSE\Plugins with Windows'' separator, which only Windows has'
  }

  # ---- how the launcher uses it ---------------------------------------------
  $all = LiftAfter $checksSrc 'public static List<Check> All(Config cfg)'
  # The game the row reads: Paths.Game, or before a folder chosen at install is made the Steam copy it is made from (#1226).
  Yes 'Checks.All adds the Address Library row, told whether the build is right' `
      ($all -and $all.Contains('l.Add(AddressLibraryRow(game, bytes == cfg.ExpectedExeBytes));') -and $all.Contains('string game = Paths.OwnFirst ? Paths.SteamCopy : Paths.Game;'))
  Yes 'and the Game build row it follows asks the same question' `
      ($all -and $all.Contains('new Check("Game build", bytes == cfg.ExpectedExeBytes,'))
  # Ten when this was written; nine since #772 took the Auto load row out.
  Yes 'Checks.All has nine rows' `
      ($all -and ([regex]::Matches($all, 'l\.Add\(')).Count -eq 9)

  # Since #607 DrawStatus also counts the problems for the Play summary, and
  # the colours moved into FillStatusRow, which fills each row in place.
  $draw = LiftAfter $shellSrc 'static bool DrawStatus()'
  Yes 'DrawStatus shuts Play on Blocks, so an advisory row leaves it alone' `
      ($draw -and $draw -match 'if \(c\.Blocks\)\s*\{?\s*all = false;' -and $draw -notmatch 'if \(!c\.Ok\)')
  $fill = LiftAfter $shellSrc 'static void FillStatusRow(Border back, Check c)'
  Yes 'FillStatusRow draws a failing advisory row amber, not red, dot and text both' `
      ($fill -and ([regex]::Matches($fill, 'c\.Advisory \? "Warn" : "Bad"')).Count -eq 2)
  Yes 'the Warn brush it uses exists in the window' `
      ($uiSrc.Contains('x:Key="Warn"'))

  if ($OnWindows) {
    # ---- this machine, read only ----------------------------------------------
    # Proves the naming rule against a real install rather than against itself:
    # when the Address Library is installed here at all, the name read off the
    # real exe must be one of its files.
    $real = Join-Path ([string](& (Join-Path $Here 'scripts\release\Where.ps1') Install)) 'Game'
    $realPlugins = Join-Path $real 'Data\SKSE\Plugins'
    if ((Test-Path (Join-Path $real 'SkyrimSE.exe')) -and (Test-Path $realPlugins) -and
        @(Get-ChildItem $realPlugins -Filter 'version*.bin' -File -ErrorAction SilentlyContinue).Count -gt 0) {
      $rb = ''
      $rf = [TsTest264.Checks]::AddressLibraryFile($real, [ref]$rb)
      $r = [TsTest264.Checks]::AddressLibraryRow($real, $true)
      Write-Host ("      this machine: {0}  [{1}]" -f $r.Detail, $rf)
      Yes 'on this machine the name read off the real exe is a file the Address Library installed' `
          ($rf.Length -gt 0 -and (Test-Path $rf))
    } else {
      Write-Host "SKIP  no Address Library install at $real to measure against"
    }
  }
}
finally {
  try { Remove-Item -Recurse -Force $root -ErrorAction Stop } catch { }
}

Done
