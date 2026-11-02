<#
  test-covered-bodies.ps1

      pwsh -NoProfile -File .\launcher\tests\test-covered-bodies.ps1

  scripts\mods\Check-CoveredBodies.ps1 (launcher\app\CoveredBodies.cs) tells
  a covered body from a nude one, and the launcher's build of the bodies
  refuses a nude one, so Play does not start on it (#3715).

  WHY THIS EXISTS. Issue #405, Patrick on 28 Sep: "I really just want no
  nudity in players or NPCs for both males and females." MEASURED that day:
  the female body in C:\Thornswood\Game and C:\Thornswood-DevBuild\Game is
  CBBE 3BA 2.48's prebuilt mesh, shapes 3BA, 3BA_Vagina and 3BA_Anus, no Bra
  or Panty; the male body is HIMBO V5's, with a "HIMBO - Boxers" shape. The
  covered female body arrives through a collection revision, and this holds
  the check that says whether it did.

  The check reads shape names out of the nif rather than searching the bytes,
  because a byte search is wrong both ways: "Bra" is in malebody_1.nif by
  chance, and bone names such as VaginaDeep1 and "NPC Genitals01" sit in every
  body, covered or not. So the meshes built here put those words on bones and
  prove they do not count.

  Every mesh here is written by this harness, a real nif header with shape
  blocks and bone blocks, so it runs on any machine. On a machine with the
  game folder it also reads the real body meshes, and says what they are
  without failing over a collection revision no code can make.

  Writes only under its own temp folder.
#>
[CmdletBinding()]
param([string]$GameRoot = 'C:\Thornswood')
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent (Split-Path -Parent $Here)
$Check = Join-Path $Repo 'scripts\mods\Check-CoveredBodies.ps1'
$Ship = Join-Path $Repo 'scripts\release\Ship.ps1'

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Skip([string]$what) { Write-Host "SKIP  $what" }

# ------------------------------------------------------ writing a nif
# A Skyrim SE nif header (20.2.0.7, user version 12, BS version 100) and one
# 12-byte block per name: the name's index in the string table, then padding.
# Shapes are BSTriShape blocks, bones NiNode blocks, which is all the check
# looks at.
function New-Nif([string]$Path, [string[]]$Shapes, [string[]]$Bones = @()) {
    $ms = New-Object IO.MemoryStream
    $w = New-Object IO.BinaryWriter($ms)
    $w.Write([Text.Encoding]::ASCII.GetBytes("Gamebryo File Format, Version 20.2.0.7`n"))
    $w.Write([uint32]0x14020007)
    $w.Write([byte]1)
    $w.Write([uint32]12)
    $names = @('Scene Root') + $Bones + $Shapes
    $w.Write([uint32]$names.Count)
    $w.Write([uint32]100)
    for ($k = 0; $k -lt 3; $k++) { $w.Write([byte]1); $w.Write([byte]0) }
    $types = @('NiNode', 'BSTriShape')
    $w.Write([uint16]$types.Count)
    foreach ($t in $types) { $w.Write([uint32]$t.Length); $w.Write([Text.Encoding]::ASCII.GetBytes($t)) }
    foreach ($n in $names) { if ($Shapes -contains $n) { $w.Write([uint16]1) } else { $w.Write([uint16]0) } }
    foreach ($n in $names) { $w.Write([uint32]12) }
    $w.Write([uint32]$names.Count)
    $w.Write([uint32](($names | Measure-Object -Property Length -Maximum).Maximum))
    foreach ($n in $names) { $w.Write([uint32]$n.Length); $w.Write([Text.Encoding]::ASCII.GetBytes($n)) }
    $w.Write([uint32]0)
    for ($k = 0; $k -lt $names.Count; $k++) { $w.Write([int32]$k); $w.Write([uint64]0) }
    $w.Flush()
    $null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path)
    [IO.File]::WriteAllBytes($Path, $ms.ToArray())
}

$Bones3BA = @('NPC Genitals01', 'VaginaDeep1', 'L Breast01', 'Bra', 'Panty')

$work = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-covered-' + [Guid]::NewGuid().ToString('N'))
$pwsh = (Get-Process -Id $PID).Path

function Invoke-Check([string]$game) {
    $out = & $pwsh -NoProfile -ExecutionPolicy Bypass -File $Check -Game $game 2>&1 | Out-String
    return [pscustomobject]@{ Code = $LASTEXITCODE; Out = $out }
}

# A game folder holding the meshes given, keyed by path under
# meshes\actors\character\character assets.
$script:n = 0
function New-Game([hashtable]$meshes) {
    $script:n++
    $game = Join-Path $work ('g' + $script:n)
    $ca = Join-Path $game 'Data\meshes\actors\character\character assets'
    $null = New-Item -ItemType Directory -Force -Path $ca
    foreach ($k in $meshes.Keys) {
        $spec = $meshes[$k]
        New-Nif (Join-Path $ca $k) $spec.Shapes $spec.Bones
    }
    return $game
}
function S([string[]]$shapes, [string[]]$bones = @()) { return @{ Shapes = $shapes; Bones = $bones } }

try {
    Yes 'Check-CoveredBodies.ps1 is there' (Test-Path -LiteralPath $Check)
    $tk = $null; $pe = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile($Check, [ref]$tk, [ref]$pe)
    Yes 'it parses' (@($pe).Count -eq 0)

    # ------------------------------------------ what is on the machine today
    $g = New-Game @{
        'femalebody_0.nif' = (S @('3BA', '3BA_Vagina', '3BA_Anus') $Bones3BA)
        'femalebody_1.nif' = (S @('3BA', '3BA_Vagina', '3BA_Anus') $Bones3BA)
        'malebody_0.nif'   = (S @('HIMBO - Boxers', 'HIMBO - Body HP'))
        'malebody_1.nif'   = (S @('HIMBO - Boxers', 'HIMBO - Body HP'))
    }
    $r = Invoke-Check $g
    Yes ('the prebuilt 3BA body is nude: exit 2 (got {0})' -f $r.Code) ($r.Code -eq 2)
    Yes 'and it names femalebody_1.nif as NUDE with its shapes' ($r.Out -match 'NUDE\s+femalebody_1\.nif\s+shapes: 3BA, 3BA_Vagina, 3BA_Anus')
    Yes 'and says what is missing' ($r.Out -match 'nothing over the chest, nothing over the groin')
    Yes 'Bra and Panty on bones do not count as covering it' ($r.Out -notmatch 'covered\s+femalebody')
    Yes 'and HIMBO with its boxers is covered' ($r.Out -match 'covered\s+malebody_1\.nif\s+shapes: HIMBO - Boxers')
    Yes 'and the verdict says where the bodies are built from' ($r.Out -match 'records.generated\.json')

    # ------------------------------------------ what the revision brings
    $g = New-Game @{
        'femalebody_0.nif' = (S @('CBBE', 'Bra', 'Panty'))
        'femalebody_1.nif' = (S @('CBBE', 'Bra', 'Panty'))
        'malebody_1.nif'   = (S @('HIMBO - Boxers', 'HIMBO - Body HP'))
    }
    $r = Invoke-Check $g
    Yes ('CBBE NeverNude and HIMBO: exit 0 (got {0})' -f $r.Code) ($r.Code -eq 0)
    Yes 'and it says every body is covered' ($r.Out -match 'Every body is covered')
    Yes 'and a body not loose in Data is the vanilla one' ($r.Out -match 'vanilla\s+malebody_0\.nif')

    $g = New-Game @{ 'femalebody_1.nif' = (S @('3BA', 'Bra', 'Panty', '3BA_Vagina', '3BA_Anus') $Bones3BA) }
    $r = Invoke-Check $g
    Yes ('3BA NeverNude, anatomy under a Bra and Panty, is covered: exit 0 (got {0})' -f $r.Code) ($r.Code -eq 0)

    $g = New-Game @{ 'femalebody_1.nif' = (S @('FemaleUnderwear', 'FemaleUnderwearBody:0')) }
    $r = Invoke-Check $g
    Yes ("Skyrim's own one-piece FemaleUnderwear covers top and bottom: exit 0 (got {0})" -f $r.Code) ($r.Code -eq 0)

    $g = New-Game @{ 'malebody_1.nif' = (S @('MaleUnderwear_1', 'MaleUnderwearBody:0', 'DVPG')) }
    $r = Invoke-Check $g
    Yes ("Skyrim's own MaleUnderwear_1 covers a man: exit 0 (got {0})" -f $r.Code) ($r.Code -eq 0)

    # ------------------------------------------ half covered is nude
    $g = New-Game @{ 'femalebody_1.nif' = (S @('CBBE', 'Panty')) }
    $r = Invoke-Check $g
    Yes ('a Panty with no top is nude: exit 2 (got {0})' -f $r.Code) ($r.Code -eq 2)
    Yes 'and it says nothing is over the chest' ($r.Out -match 'nothing over the chest' -and $r.Out -notmatch 'nothing over the groin')

    $g = New-Game @{ 'femalebody_1.nif' = (S @('CBBE', 'Bracers', 'Topaz')) }
    $r = Invoke-Check $g
    Yes ('"Bracers" is not a bra and "Topaz" is not a top: exit 2 (got {0})' -f $r.Code) ($r.Code -eq 2)

    $g = New-Game @{ 'malebody_1.nif' = (S @('MaleBody', 'TNG_Genitals')) }
    $r = Invoke-Check $g
    Yes ('a man with no boxers is nude: exit 2 (got {0})' -f $r.Code) ($r.Code -eq 2)
    Yes 'and it names malebody_1.nif' ($r.Out -match 'NUDE\s+malebody_1\.nif')

    # ------------------------------------------ anatomy anywhere else
    $g = New-Game @{
        'femalebody_1.nif'  = (S @('CBBE', 'Bra', 'Panty'))
        'TNG\genitals.nif'  = (S @('TNG_Genitals'))
    }
    $r = Invoke-Check $g
    Yes ('a genital mesh elsewhere under character is nude: exit 2 (got {0})' -f $r.Code) ($r.Code -eq 2)
    Yes 'and it names the file' ($r.Out -match 'NUDE\s+meshes\\actors\\character\\character assets\\TNG\\genitals\.nif')

    $g = New-Game @{ 'ygNord\femalebody_1.nif' = (S @('3BA', '3BA_Vagina')) }
    $r = Invoke-Check $g
    Yes ('an extra 3BA body in its own folder is held to the same rule: exit 2 (got {0})' -f $r.Code) ($r.Code -eq 2)

    $g = New-Game @{ 'ygNord\femalebody_1.nif' = (S @('3BA', 'Bra', 'Panty', '3BA_Vagina')) }
    $r = Invoke-Check $g
    Yes ('and passes once it is covered: exit 0 (got {0})' -f $r.Code) ($r.Code -eq 0)

    $g = New-Game @{ '1stpersonfemalebody_1.nif' = (S @('3BA', '3BA_Vagina')) }
    $r = Invoke-Check $g
    Yes ('first-person bodies are not judged, the camera never draws the torso: exit 0 (got {0})' -f $r.Code) ($r.Code -eq 0)

    $g = New-Game @{ '..\FaceGenData\FaceGeom\Skyrim.esm\00013BA1.nif' = (S @('3BA', '3BA_Vagina')) }
    $r = Invoke-Check $g
    Yes ('FaceGenData is heads and is not judged, on any machine''s separator: exit 0 (got {0})' -f $r.Code) ($r.Code -eq 0)

    # ------------------------------------------ Astrid's burned body
    $g = New-Game @{ 'femalebodyastrid_1.nif' = (S @('CBBE')) }
    $r = Invoke-Check $g
    Yes ("Astrid's burned body is listed, not counted: exit 0 (got {0})" -f $r.Code) ($r.Code -eq 0)
    Yes 'and its line says so' ($r.Out -match 'burned\s+femalebodyastrid_1\.nif')

    $g = New-Game @{ 'femalebodyastrid_1.nif' = (S @('CBBE', '3BA_Vagina')) }
    $r = Invoke-Check $g
    Yes ('but a genital shape on it counts: exit 2 (got {0})' -f $r.Code) ($r.Code -eq 2)

    # ------------------------------------------ what it cannot read
    $g = New-Game @{}
    [IO.File]::WriteAllBytes((Join-Path $g 'Data\meshes\actors\character\character assets\femalebody_1.nif'),
                             [Text.Encoding]::ASCII.GetBytes('Gamebryo File Format 3BA Bra Panty'))
    $r = Invoke-Check $g
    Yes ('a mesh that is not a nif it can read is exit 1, not a pass (got {0})' -f $r.Code) ($r.Code -eq 1)
    Yes 'and it says UNREAD' ($r.Out -match 'UNREAD\s+femalebody_1\.nif')

    $r = Invoke-Check (Join-Path $work 'nowhere')
    Yes ('no Data folder is exit 1 (got {0})' -f $r.Code) ($r.Code -eq 1)

    $g = New-Game @{}
    $r = Invoke-Check $g
    Yes ('no loose bodies at all is vanilla, exit 0 (got {0})' -f $r.Code) ($r.Code -eq 0)
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

# ============================================================ the launcher's gate
# Since #3715 the bodies are built on each computer by the launcher, and no
# release carries them, so the gate is the launcher's: the build reads the
# bodies BodySlide built before any is put in place, and every body in the
# folder before it records them, and refuses either; Play does not start on a
# refusal. Ship has no body step any more: nothing it sends has a body in it.

$App = Join-Path $Repo 'launcher\app'
$build = [IO.File]::ReadAllText((Join-Path $App 'GeneratedBuild.cs'))
$here = [IO.File]::ReadAllText((Join-Path $App 'GeneratedHere.cs'))
$play = [IO.File]::ReadAllText((Join-Path $App 'ShellPlay.cs'))
Yes 'the build reads the bodies BodySlide built, and refuses a nude or unreadable one before any is put in place' (
    $build -match '(?s)CoveredResult covered = CoveredBodies\.Check\(stageRoot, false, Say\);\s*if \(covered\.Nude > 0 \|\| covered\.Unread > 0\)\s*throw new GeneratedStop' -and
    $build.IndexOf('CoveredBodies.Check(stageRoot') -lt $build.IndexOf('foreach (string f in built) outputs.Add(PutOutput('))
Yes 'and reads every body in the folder, refusing a nude one, before it writes the record' (
    $build -match '(?s)CoveredResult all = CoveredBodies\.Check\(game, true, Say\);\s*if \(all\.Nude > 0 \|\| all\.Unread > 0\)\s*throw new GeneratedStop' -and
    $build.IndexOf('CoveredBodies.Check(game, true, Say)') -lt $build.IndexOf('GeneratedRecord.Write(recordPath'))
Yes 'Play builds them before the game starts, and a refusal stops Play' (
    $play -match 'GeneratedHere\.Ensure\(SafeLog\)' -and $play -match '(?s)if \(notBuilt != null\)\s*\{.{0,200}Not launching\..{0,300}return;' -and
    $play.IndexOf('GeneratedHere.Ensure(SafeLog)') -lt $play.IndexOf('if (!EnsureServer()) return;'))
Yes 'the launcher builds only in Thornswood''s own folder' ($here -match '(?s)public static string Ensure\(Action<string> say\)\s*\{\s*if \(!OwnGame\.Active\) return null;')

$text = [IO.File]::ReadAllText($Ship)
$ast = [System.Management.Automation.Language.Parser]::ParseInput($text, $Ship, [ref]$null, [ref]$pe)
Yes 'Ship.ps1 parses' (@($pe).Count -eq 0)
$params = @($ast.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath })
Yes 'Ship.ps1 has no -AllowUncoveredBodies and no Covered bodies step: it sends no body' (
    $params -notcontains 'AllowUncoveredBodies' -and $text -notmatch "Head 'Covered bodies'" -and $text -notmatch 'Check-CoveredBodies')

# ======================================================== this machine

# Join-Path stops on a drive this machine does not have (C: off Windows),
# so whether the folder is here at all is asked first.
$live = $(if (Test-Path -LiteralPath $GameRoot) { Join-Path $GameRoot 'Game' } else { '' })
if ($live -and (Test-Path -LiteralPath (Join-Path $live 'Data\meshes\actors\character\character assets\femalebody_1.nif'))) {
    $r = Invoke-Check $live
    $lines = @($r.Out -split "\r?\n" | Where-Object { $_ -match '^\s+(covered|NUDE|UNREAD|vanilla|burned)\s' } | ForEach-Object { $_.Trim() })
    Yes ('the real meshes in ' + $live + ' parse (exit ' + $r.Code + ')') ($r.Code -ne 1)
    if ($r.Code -eq 0) {
        Yes ('every body in the game folder is covered: ' + ($lines -join ' / ')) $true
    } else {
        Skip ('a body in the game folder is still nude: ' + ($lines -join ' / ') +
              '. That changes with a collection revision, which is Patrick''s, not with code.')
    }
} else {
    Skip ('no game folder in ' + $GameRoot)
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
