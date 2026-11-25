<#
  test-4232-mods-tools.ps1

      pwsh -NoProfile -File .\tests\test-4232-mods-tools.ps1

  #4232. These tools in scripts\mods (Audit-Leftovers in scripts\dev since
  #4740) were run by no test, so a change to one
  had nothing to catch it. This runs each against a scratch folder, with a
  case it must flag and, where one can be made, a case it must pass:

    Check-Editions.ps1       a plugin that declares a Creation Club master,
                             and one that declares only the base game
    Find-MissingMasters.ps1  an enabled plugin whose master is not in Data,
                             and one whose master is
    Audit-ArmorSlots.py      two plugins whose armour claims the same free
                             slot, and two that claim different slots
    Audit-Leftovers.ps1      backups in Downloads and beside a plugin, and a
                             machine with none; it deletes nothing
    Check-FromGame.ps1       a Data folder with no game in it makes nothing
                             and exits 1
    Build-ModMenus.py        a Data folder without the mods' archives, and an
                             archive that is not Skyrim's, stop with exit 1

  Check-FromGame and Build-ModMenus have no case here that passes: they pass
  only on the game's and the mods' own archives, which no test machine may
  hold. The launcher code Check-FromGame runs is held on made-up archives by
  tests\test-2827-from-game.ps1. Audit-Mods.ps1 is run by
  tests\test-4259-audit-mods.ps1. Clean-Leftovers.ps1 -Go is changed to
  remove only Thornswood's own leftovers by #4808, whose harness runs it
  from a scratch copy, so it is not run here against what it does today.

  THE LEFTOVER AUDIT ONLY EVER SEES THE SCRATCH FOLDER. It walks the install
  Where.ps1 names, the engine, Downloads, AppData and Temp, which come from
  THORNSWOOD_INSTALL, USERPROFILE, LOCALAPPDATA and the repository it sits
  in. It runs from a copy of itself with Where.ps1 and layout.json beside
  it, with those three pointed into the scratch folder. It only reads.

  The scratch folder is under out\harness, which git ignores, and not under
  TEMP: the audit counts every file in a folder named temp as scratch, so a
  machine with nothing to find would be found to have everything.

  Writes only under its own scratch folder, which it removes.
#>
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Windows.ps1')
$ps = Get-BoxPowerShell
$Repo = (Resolve-Path (Split-Path -Parent $PSScriptRoot)).Path
$Mods = Join-Path (Join-Path $Repo 'scripts') 'mods'
$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}

$python = $null
foreach ($n in 'python', 'python3') {
    $c = Get-Command $n -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($c) { $python = $c.Source; break }
}

$T = Join-Path (Join-Path (Join-Path $Repo 'out') 'harness') ('ts-4232-' + [Guid]::NewGuid().ToString('N').Substring(0, 10))
New-Item -ItemType Directory -Force -Path $T | Out-Null
$T = (Resolve-Path -LiteralPath $T).Path

# ---- plugins, from nothing ---------------------------------------------------
# A TES4 header naming the masters, and one ARMO record (EDID and BOD2) for
# each biped slot asked for, in an ARMO group. Nothing of Bethesda's.
$Ascii = [Text.Encoding]::ASCII
function Bytes([scriptblock]$write) {
    $ms = [IO.MemoryStream]::new(); $bw = [IO.BinaryWriter]::new($ms)
    & $write $bw
    $bw.Flush()
    return , $ms.ToArray()
}
function ZStr([string]$s) { return , [byte[]]($Ascii.GetBytes($s) + [byte]0) }
function Sub([string]$sig, [byte[]]$data) {
    return , (Bytes { param($w) $w.Write($Ascii.GetBytes($sig)); $w.Write([uint16]$data.Length); $w.Write($data) })
}
function Rec([string]$sig, [byte[]]$data, [uint32]$id) {
    return , (Bytes { param($w)
        $w.Write($Ascii.GetBytes($sig)); $w.Write([uint32]$data.Length); $w.Write([uint32]0); $w.Write($id)
        $w.Write([uint32]0); $w.Write([uint16]44); $w.Write([uint16]0); $w.Write($data) })
}
function Plugin([string]$path, [string[]]$Masters = @(), [int[]]$Slots = @()) {
    [byte[]]$head = Sub 'HEDR' (Bytes { param($w) $w.Write([single]1.7); $w.Write([int32]$Slots.Count); $w.Write([uint32]0x800) })
    foreach ($m in $Masters) { $head = [byte[]]($head + (Sub 'MAST' (ZStr $m)) + (Sub 'DATA' (New-Object byte[] 8))) }
    [byte[]]$file = Rec 'TES4' $head 0
    if ($Slots.Count) {
        [byte[]]$recs = @()
        $i = 0
        foreach ($s in $Slots) {
            $i++
            $bod = Bytes { param($w) $w.Write([uint32]([long]1 -shl ($s - 30))); $w.Write([uint32]0) }
            $body = [byte[]]((Sub 'EDID' (ZStr ('Fixture' + $s + '_' + $i))) + (Sub 'BOD2' $bod))
            $recs = [byte[]]($recs + (Rec 'ARMO' $body ([uint32](0x800 + $i))))
        }
        $grup = Bytes { param($w)
            $w.Write($Ascii.GetBytes('GRUP')); $w.Write([uint32](24 + $recs.Length)); $w.Write($Ascii.GetBytes('ARMO'))
            $w.Write([int32]0); $w.Write([uint32]0); $w.Write([uint32]0) }
        $file = [byte[]]($file + $grup + $recs)
    }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null
    [IO.File]::WriteAllBytes($path, $file)
}
function Put([string]$path, [string]$text) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null
    [IO.File]::WriteAllText($path, $text)
}
function Under([string]$root, [string[]]$parts) { $p = $root; foreach ($x in $parts) { $p = Join-Path $p $x }; return $p }

# ---- running them --------------------------------------------------------------
# Each in its own process, from the scratch folder, with the variables named
# set for that process only.
function Run([string]$exe, [string[]]$argv, [hashtable]$vars = @{}) {
    $saved = @{}
    foreach ($k in @($vars.Keys)) { $saved[$k] = [Environment]::GetEnvironmentVariable($k); [Environment]::SetEnvironmentVariable($k, [string]$vars[$k]) }
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $o = & $exe @argv 2>&1 | Out-String; $code = $LASTEXITCODE }
    finally {
        $ErrorActionPreference = $old
        foreach ($k in @($saved.Keys)) { [Environment]::SetEnvironmentVariable($k, $saved[$k]) }
    }
    return [pscustomobject]@{ Code = $code; Out = $o }
}
function RunPs([string]$file, [string[]]$argv, [hashtable]$vars = @{}) { return Run $ps (@('-NoProfile', '-File', $file) + $argv) $vars }
function Show($r) { ($r.Out -split "\r?\n") | Where-Object { $_ } | ForEach-Object { Write-Host "      $_" } }

# A copy of the leftover audit (scripts\dev since #4740) with what it calls,
# in a scratch repository layout, so the engine it walks is the copy's and
# not this checkout's.
function Copy-Tool([string]$name, [string]$to) {
    foreach ($rel in @(@('scripts', 'dev', $name), @('scripts', 'release', 'Where.ps1'), @('layout.json'))) {
        $dst = Under $to $rel
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dst) | Out-Null
        Copy-Item -LiteralPath (Under $Repo $rel) -Destination $dst
    }
    # What Clean-Leftovers removes, which the audit reads to mark its rows
    # (#4256). Copied when the checkout has it, so a checkout without it
    # fails on what it says below rather than on the copy.
    $lib = Under $Repo @('scripts', 'dev', 'Leftovers.ps1')
    if (Test-Path -LiteralPath $lib) { Copy-Item -LiteralPath $lib -Destination (Under $to @('scripts', 'dev', 'Leftovers.ps1')) }
    $steamLib = Under $Repo @('scripts', 'mods', 'SteamLibrary.ps1')
    if (Test-Path -LiteralPath $steamLib) {
        $dst = Under $to @('scripts', 'mods', 'SteamLibrary.ps1')
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dst) | Out-Null
        Copy-Item -LiteralPath $steamLib -Destination $dst
    }
    return (Under $to @('scripts', 'dev', $name))
}
# A made-up machine: its install, its home folder and its local app data.
function Machine([string]$at) {
    return @{ THORNSWOOD_INSTALL = (Join-Path $at 'install'); USERPROFILE = (Join-Path $at 'home'); LOCALAPPDATA = (Join-Path $at 'localappdata') }
}

Push-Location -LiteralPath $T
try {
    Yes 'Python is on this machine, to run the two Python tools' ([bool]$python)

    # ---- Check-Editions ----------------------------------------------------------
    $ed = Join-Path $T 'editions'
    $edData = Join-Path $ed 'Data'
    Plugin (Join-Path $edData 'Skyrim.esm')
    Plugin (Join-Path $edData 'Fishing.esp') @('Skyrim.esm', 'ccBGSSSE001-Fish.esm')
    Plugin (Join-Path $edData 'Plain.esp') @('Skyrim.esm')
    $edFlag = Join-Path $ed 'flag-plugins.txt'; Put $edFlag "*Skyrim.esm`n*Fishing.esp`n"
    $edPass = Join-Path $ed 'pass-plugins.txt'; Put $edPass "*Skyrim.esm`n*Plain.esp`n"
    $editions = Join-Path $Mods 'Check-Editions.ps1'
    $r = RunPs $editions @('-Data', $edData, '-Plugins', $edFlag, '-NoPause')
    Yes 'Check-Editions flags a plugin that declares a Creation Club master, and exits 1' ($r.Code -eq 1 -and $r.Out -match 'Fishing\.esp needs ccBGSSSE001-Fish\.esm' -and $r.Out -match 'needs the paid Anniversary upgrade')
    if ($r.Code -ne 1) { Show $r }
    $r = RunPs $editions @('-Data', $edData, '-Plugins', $edPass, '-NoPause')
    Yes '  and passes a load order that declares only the base game, exit 0' ($r.Code -eq 0 -and $r.Out -match '2 read, 0 named but not in Data' -and $r.Out -match 'Special Edition is enough')
    if ($r.Code -ne 0) { Show $r }

    # ---- Find-MissingMasters -----------------------------------------------------
    $masters = Join-Path $Mods 'Find-MissingMasters.ps1'
    $fmFlag = Under $T @('masters', 'flag')
    Plugin (Join-Path $fmFlag 'Skyrim.esm')
    Plugin (Join-Path $fmFlag 'Needs.esp') @('Skyrim.esm', 'Gone.esm')
    $fmPass = Under $T @('masters', 'pass')
    Plugin (Join-Path $fmPass 'Skyrim.esm')
    Plugin (Join-Path $fmPass 'Needs.esp') @('Skyrim.esm')
    $fmList = Under $T @('masters', 'plugins.txt'); Put $fmList "*Needs.esp`n"
    $r = RunPs $masters @('-Data', $fmFlag, '-Plugins', $fmList, '-NoPause')
    Yes 'Find-MissingMasters flags an enabled plugin whose master is not in Data' ($r.Out -match 'Needs\.esp\s+Gone\.esm\s+ENABLED' -and $r.Out -match '1 ENABLED plugin\(s\) have a missing master')
    if ($r.Out -notmatch 'Gone\.esm') { Show $r }
    $r = RunPs $masters @('-Data', $fmPass, '-Plugins', $fmList, '-NoPause')
    Yes '  and passes one whose master is there, counting what it read' ($r.Out -match 'no missing masters: 2 plugin\(s\)' -and $r.Out -match '1 of them enabled' -and $r.Out -notmatch 'Gone\.esm')
    if ($r.Out -notmatch 'no missing masters') { Show $r }

    # ---- Audit-ArmorSlots.py -------------------------------------------------------
    if ($python) {
        $slots = Join-Path $Mods 'Audit-ArmorSlots.py'
        $arFlag = Under $T @('armour', 'flag')
        Plugin (Join-Path $arFlag 'Cloaks.esp') @('Skyrim.esm') @(46)
        Plugin (Join-Path $arFlag 'Packs.esp') @('Skyrim.esm') @(46, 32)
        $arPass = Under $T @('armour', 'pass')
        Plugin (Join-Path $arPass 'Cloaks.esp') @('Skyrim.esm') @(46)
        Plugin (Join-Path $arPass 'Packs.esp') @('Skyrim.esm') @(47, 32)
        $r = Run $python @('-I', $slots, $arFlag)
        Yes 'Audit-ArmorSlots.py flags two plugins whose armour claims the same free slot' ($r.Code -eq 0 -and $r.Out -match '3 armour records across 2 plugins' -and $r.Out -match 'slot 46 \(chest primary\) is claimed by 2 plugins')
        if ($r.Out -notmatch 'claimed by 2 plugins') { Show $r }
        $r = Run $python @('-I', $slots, $arPass)
        Yes '  and passes two that claim different slots' ($r.Code -eq 0 -and $r.Out -match '3 armour records across 2 plugins' -and $r.Out -match 'No contested slot is claimed by more than one plugin')
        if ($r.Out -notmatch 'No contested slot') { Show $r }
    }

    # ---- the leftover tools ------------------------------------------------------
    # Machine A has two backups and two files that are not; machine B only the two.
    $A = Join-Path $T 'machine-a'
    $B = Join-Path $T 'machine-b'
    foreach ($m in $A, $B) {
        Put (Under $m @('install', 'Game', 'Data', 'Thing.esp')) 'a plugin'
        Put (Under $m @('home', 'Downloads', 'pack.zip')) 'a download'
    }
    $bakData = Under $A @('install', 'Game', 'Data', 'Thing.esp.bak')
    $bakDown = Under $A @('home', 'Downloads', 'pack.zip.bak')
    Put $bakData 'an old plugin'
    Put $bakDown 'an old download'
    $keepA = @((Under $A @('install', 'Game', 'Data', 'Thing.esp')), (Under $A @('home', 'Downloads', 'pack.zip')))
    function AllThere([string[]]$paths) { return (@($paths | Where-Object { -not (Test-Path -LiteralPath $_) }).Count -eq 0) }

    $audit = Copy-Tool 'Audit-Leftovers.ps1' (Join-Path $T 'audit-repo')
    $repA = Join-Path $T 'audit-a.txt'
    $r = RunPs $audit @('-Report', $repA, '-NoPause') (Machine $A)
    $text = if (Test-Path -LiteralPath $repA) { [IO.File]::ReadAllText($repA) } else { '' }
    $found = if ($text.Contains('BACKUPS, PREVIOUS COPIES AND SCRATCH')) { $text.Substring($text.IndexOf('BACKUPS, PREVIOUS COPIES AND SCRATCH')) } else { '' }
    Yes 'Audit-Leftovers flags a backup in Downloads and one beside a plugin, in its report' ($found.Contains($bakDown) -and $found.Contains($bakData))
    if (-not $found) { Show $r }
    Yes '  and lists neither file that is not one' (-not $found.Contains($keepA[0] + [Environment]::NewLine) -and -not $found.Contains($keepA[1] + [Environment]::NewLine) -and -not ($found -match [regex]::Escape($keepA[1]) + '\s*$'))
    Yes '  and deletes, moves and renames nothing' ((AllThere $keepA) -and (AllThere @($bakData, $bakDown)))
    $repB = Join-Path $T 'audit-b.txt'
    $r = RunPs $audit @('-Report', $repB, '-NoPause') (Machine $B)
    $text = if (Test-Path -LiteralPath $repB) { [IO.File]::ReadAllText($repB) } else { '' }
    $found = if ($text.Contains('BACKUPS, PREVIOUS COPIES AND SCRATCH')) { $text.Substring($text.IndexOf('BACKUPS, PREVIOUS COPIES AND SCRATCH')) } else { $null }
    Yes '  and on a machine with no backups lists nothing of it' ($null -ne $found -and -not $found.Contains($B))
    if ($null -eq $found -or $found.Contains($B)) { Show $r }

    # ---- what the audit says Clean-Leftovers frees (#4256) -------------------------
    # One definition of what Clean-Leftovers -Go removes, Leftovers.ps1, read
    # by both: the audit marks each row Clean leaves, and its total counts only
    # what Clean frees. Machine A gains Thornswood's own leftover in the
    # install and in the dev build's install beside it (Where.ps1 InstallDev).
    $Dev = Join-Path (Join-Path $Repo 'scripts') 'dev'
    $lib = Under $Dev @('Leftovers.ps1')
    Yes 'scripts\dev\Leftovers.ps1 says what Clean-Leftovers removes' (Test-Path -LiteralPath $lib)
    $cleanSrc = [IO.File]::ReadAllText((Join-Path $Dev 'Clean-Leftovers.ps1'))
    $auditSrc = [IO.File]::ReadAllText((Join-Path $Dev 'Audit-Leftovers.ps1'))
    $loads = ". (Join-Path `$PSScriptRoot 'Leftovers.ps1')"
    Yes '  both scripts load it, and neither names Thornswood.exe.old itself' ($cleanSrc.Contains($loads) -and $auditSrc.Contains($loads) -and -not $cleanSrc.Contains("'Thornswood.exe.old'") -and -not $auditSrc.Contains("'Thornswood.exe.old'"))
    $ownMain = Under $A @('install', 'Launcher', 'Thornswood.exe.old')
    $ownDev = Under $A @('install-DevBuild', 'Launcher', 'Thornswood.exe.old')
    Put $ownMain 'the launcher before its update'
    Put $ownDev 'the dev launcher before its update'
    $repC = Join-Path $T 'audit-c.txt'
    $r = RunPs $audit @('-Report', $repC, '-NoPause') (Machine $A)
    $text = if (Test-Path -LiteralPath $repC) { [IO.File]::ReadAllText($repC) } else { '' }
    $rows = @($text -split "\r?\n")
    function Row([string]$path) { return @($rows | Where-Object { $_.Contains($path) } | Select-Object -First 1) -join '' }
    $leaves = '(Clean-Leftovers leaves this)'
    Yes 'the audit marks each row Clean-Leftovers leaves: the backup beside a plugin and the one in Downloads' ((Row $bakData).EndsWith($leaves) -and (Row $bakDown).EndsWith($leaves))
    Yes '  and not Thornswood''s own leftover, in the install or the dev build''s' ((Row $ownMain) -ne '' -and -not (Row $ownMain).EndsWith($leaves) -and (Row $ownDev) -ne '' -and -not (Row $ownDev).EndsWith($leaves))
    $wantBytes = (Get-Item -LiteralPath $ownMain).Length + (Get-Item -LiteralPath $ownDev).Length
    $frees = [regex]::Match($text, 'Clean-Leftovers -Go frees ([0-9.,]+) GB in ([0-9,]+) file\(s\)')
    Yes ('  and its total counts only what Clean-Leftovers -Go frees: the two, ' + $wantBytes + ' bytes') ($frees.Success -and $frees.Groups[2].Value -eq '2')
    if (-not $frees.Success) { Show $r }
    Yes '  and still deletes nothing' ((AllThere @($ownMain, $ownDev, $bakData, $bakDown)) -and (AllThere $keepA))

    # ---- Check-FromGame ------------------------------------------------------------
    $noGame = Join-Path $T 'no-game'
    New-Item -ItemType Directory -Force -Path $noGame | Out-Null
    $r = RunPs (Join-Path $Mods 'Check-FromGame.ps1') @('-Data', $noGame)
    $notMade = [regex]::Matches($r.Out, '(?m)^\s*NOT MADE ').Count
    Yes ('Check-FromGame makes nothing from a Data folder with no game in it, says so for each file (' + $notMade + ') and exits 1') ($r.Code -eq 1 -and $notMade -ge 3 -and $r.Out -notmatch '(?m)^\s*ok\s')
    if ($r.Code -ne 1) { Show $r }
    Yes '  and writes nothing' (@(Get-ChildItem -LiteralPath $noGame -Force).Count -eq 0)

    # ---- Build-ModMenus.py -----------------------------------------------------------
    if ($python) {
        $menus = Join-Path $Mods 'Build-ModMenus.py'
        $recipe = Join-Path $T 'FromGameModMenus.cs'
        Copy-Item -LiteralPath (Under $Repo @('launcher', 'app', 'FromGameModMenus.cs')) -Destination $recipe
        $before = (Get-FileHash -LiteralPath $recipe -Algorithm SHA256).Hash
        $r = Run $python @('-I', $menus, '--data', $noGame, '--check', '--recipe', $recipe)
        Yes 'Build-ModMenus.py stops when the Data folder has none of the mods'' archives, exit 1' ($r.Code -eq 1 -and $r.Out -match 'STOP\. SkyUI_SE\.bsa is not in')
        if ($r.Code -ne 1) { Show $r }
        $junk = Join-Path $T 'junk-data'
        Put (Join-Path $junk 'SkyUI_SE.bsa') 'not an archive'
        $r = Run $python @('-I', $menus, '--data', $junk, '--check', '--recipe', $recipe)
        Yes '  and when the archive is not a Skyrim Special Edition archive' ($r.Code -eq 1 -and $r.Out -match 'is not a Skyrim Special Edition archive')
        if ($r.Code -ne 1) { Show $r }
        Yes '  and changes no recipe either time' ((Get-FileHash -LiteralPath $recipe -Algorithm SHA256).Hash -eq $before)
    }
}
finally {
    Pop-Location
    if (Test-Path -LiteralPath $T) { Remove-Item -LiteralPath $T -Recurse -Force }
}
Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
