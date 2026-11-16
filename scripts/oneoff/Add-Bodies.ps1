<#
  Add-Bodies.ps1

  RETIRED. DO NOT RUN. Issue #405: every run poured the nude CBBE and 3BA
  female body (femalebody_0.nif and _1.nif, shapes 3BA, 3BA_Vagina and
  3BA_Anus, no Bra or Panty) back over Game\Data, whatever body had been
  put there since. It is also from before the own game folder: those meshes
  are Vortex hard links now (Profile\OwnGame\files.txt records them as L|V),
  so a run wrote straight into Vortex's own staging copy, and
  Publish-Update never packs a Vortex deployed file, so nothing it wrote
  would ship anyway. The bodies come from the Nexus collection, and the
  covered female body goes in there, as a collection revision, the way
  every other mesh reaches everybody. It refuses to run, and the rest of
  the file is kept for the history of how it was installed. Pattern from
  #735 Add-TempleRespawn and #768 Add-JContainers.

  What it used to do, and what is left of it:

  Bodies, genitals and physics. Skeleton, female body, male body, and the
  jiggle that hangs off both.

  Installed in this order because each one writes over the last: skeleton
  first, then the bodies, then the physics that needs them both.

  Two of these archives are FOMOD installers with mutually exclusive option
  folders. Where the right option is known it is named below with the reason.
  Where an archive turns out to have a shape this script does not recognise
  it stops and prints what it found, rather than copying every option over
  the top of every other one and leaving a body that is quietly wrong.

      .\scripts\oneoff\Add-Bodies.ps1

  Options:
      -SkipRefits      leave out the 842 MB outfit conversion pack
      -Notes "..."     what the News page says about this release
      -NoShip          install only, publish nothing
#>
#Requires -Version 7
[CmdletBinding()]
param(
    [string]$Root      = (& (Join-Path $PSScriptRoot '..\release\Where.ps1') Install),
    [string]$Downloads = "$env:USERPROFILE\Downloads",
    [switch]$SkipRefits,
    [string]$Notes = "Bodies, and the physics to go with them`n- CBBE and 3BA for women, HIMBO and The New Gentleman for men, all nude by default`n- XPMSSE skeleton underneath, CBPC doing the physics`n- everyone gets identical meshes, because mismatched bodies is the one thing that actually breaks co-op",
    [switch]$NoShip,
    [switch]$NoPause
)

# The refusal comes before anything else, above the strict mode line and above
# the dot source below it, so no part of the install can run by accident.
throw ('STOP. Add-Bodies.ps1 is retired and installs nothing (issue #405). ' +
       'It pours the nude CBBE and 3BA female body back over Game\Data, which undoes a covered ' +
       'body the moment it lands, and the meshes there are Vortex hard links, so it writes into ' +
       "Vortex's own staging copy. Bodies come from the Nexus collection now: the covered female " +
       'body goes into a collection revision, not this script. ' +
       'The file is kept for the history of how it was installed. Delete this line only if ' +
       'bodies are meant to be hand-installed again, and read the header first.')

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
function Die($m) { Write-Host ''; Write-Host "STOP. $m" -ForegroundColor Red; if (-not $NoPause) { [void](Read-Host 'Enter to exit') }; exit 1 }

$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
. (Join-Path $Here '..\dev\Close-Launcher.ps1')

$Data    = Join-Path $Root 'Game\Data'
$Golden  = Join-Path $Root 'Profile\Default'
$LocalAD = Join-Path $Root 'Profile\LocalAppData'
if (-not (Test-Path $Data)) { Die "No build at $Data." }

Head 'Making room'
if (Test-GameRunning -Root $Root) { Die 'Skyrim is running. Quit the game first.' }
$null = Stop-Launcher -Root $Root

$7z = @(
    "$env:ProgramFiles\7-Zip\7z.exe"
    "${env:ProgramFiles(x86)}\7-Zip\7z.exe"
    "$env:LOCALAPPDATA\Programs\7-Zip\7z.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $7z) { Die '7-Zip is not installed.' }

$work = Join-Path $env:TEMP 'Bodies-install'
if (Test-Path $work) { Remove-Item $work -Recurse -Force }
$null = New-Item -ItemType Directory -Force -Path $work

function Newest($pattern) {
    return @(Get-ChildItem -LiteralPath $Downloads -Filter $pattern -File -ErrorAction SilentlyContinue |
             Sort-Object LastWriteTime -Descending | Select-Object -First 1)
}

function Unpack($archive, $name) {
    $dest = Join-Path $work $name
    $null = New-Item -ItemType Directory -Force -Path $dest
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & $7z x -y "-o$dest" $archive | Out-Null; $code = $LASTEXITCODE }
    finally { $ErrorActionPreference = $old }
    if ($code -gt 1) { Die "Could not unpack $(Split-Path $archive -Leaf)." }
    return $dest
}

# Copies one folder's contents into Data as if it were the Data folder.
$script:Copied = 0
function Pour($from) {
    if (-not (Test-Path -LiteralPath $from)) { return $false }
    foreach ($f in @(Get-ChildItem -LiteralPath $from -Recurse -File -Force)) {
        $rel = $f.FullName.Substring($from.Length).TrimStart('\')
        if ($rel -match '(^|\\)[Ss]ource\\') { continue }
        if ($rel -match '(^|\\)fomod\\') { continue }
        if ($rel -match '\.(pdb|psd)$') { continue }
        if ($rel -match '\.(txt|md|pdf|jpg|png|webp|html)$' -and $rel -notmatch '\\') { continue }
        $dest = Join-Path $Data $rel
        $dir  = Split-Path -Parent $dest
        if (-not (Test-Path -LiteralPath $dir)) { $null = New-Item -ItemType Directory -Force -Path $dir }
        Copy-Item -LiteralPath $f.FullName -Destination $dest -Force
        $script:Copied++
    }
    return $true
}

# Works out which folder inside an archive is the one that maps onto Data.
# Returns $null when it cannot tell, which is a stop rather than a guess.
function Resolve-DataRoot($dir, $depth) {
    if ($depth -gt 4) { return $null }
    if (Test-Path -LiteralPath (Join-Path $dir 'Data')) { return (Join-Path $dir 'Data') }

    $tells = @('meshes', 'textures', 'scripts', 'SKSE', 'CalienteTools', 'interface', 'tools')
    foreach ($t in $tells) {
        if (Test-Path -LiteralPath (Join-Path $dir $t)) { return $dir }
    }
    if (@(Get-ChildItem -LiteralPath $dir -File -Filter '*.es*' -ErrorAction SilentlyContinue).Count) { return $dir }

    $subs = @(Get-ChildItem -LiteralPath $dir -Directory -ErrorAction SilentlyContinue |
              Where-Object { $_.Name -notmatch '^(fomod|Fomod|FOMod|docs?)$' })
    if ($subs.Count -eq 1) { return (Resolve-DataRoot $subs[0].FullName ($depth + 1)) }
    return $null
}

# Archives whose shape this script does not recognise are collected rather
# than fatal, so one run surfaces every one of them instead of stopping at the
# first and making you run it again to find the next.
$script:Unknown = @()

function PourArchive($label, $pattern, $required, $picks) {
    $a = @(Newest $pattern)
    if (-not $a.Count) {
        if ($required) { Die "Could not find '$pattern' in $Downloads." }
        Say "  $label, not found, skipping" 'Yellow'
        return
    }
    Say "  $label" 'Green'
    $dir = Unpack $a[0].FullName ($label -replace '[^A-Za-z0-9]', '')

    # A named list of option folders beats anything guessed. Each one is
    # poured in turn, later ones writing over earlier ones, which is how a
    # FOMOD would have applied them anyway.
    if ($picks -and @($picks).Count) {
        $base = $dir
        $solo = @(Get-ChildItem -LiteralPath $dir -Directory |
                  Where-Object { $_.Name -notmatch '^(fomod|Fomod|FOMod)$' })
        if ($solo.Count -eq 1 -and -not (Test-Path -LiteralPath (Join-Path $dir $picks[0]))) {
            $base = $solo[0].FullName
        }
        $got = 0
        foreach ($p in @($picks)) {
            if (Pour (Join-Path $base $p)) { $got++; Say "    $p" 'DarkGray' }
            else { Say "    missing in archive: $p" 'Yellow' }
        }
        if ($got -eq 0) {
            $names = @(Get-ChildItem -LiteralPath $base -Directory | ForEach-Object { $_.Name })
            $script:Unknown += ,@($label, $names)
        }
        return
    }

    $root = Resolve-DataRoot $dir 0
    if (-not $root) {
        $names = @(Get-ChildItem -LiteralPath $dir -Directory | ForEach-Object { $_.Name })
        $script:Unknown += ,@($label, $names)
        Say "    shape not recognised, noted for the end" 'Yellow'
        return
    }
    $null = Pour $root
}

# ---------------------------------------------------------------- skeleton
Head 'Skeleton'
$x = @(Newest 'XP32 Maximum Skeleton*')
if (-not $x.Count) { Die "Could not find 'XP32 Maximum Skeleton*' in $Downloads." }
Say "  $($x[0].Name)" 'Green'
$xd = Unpack $x[0].FullName 'xpmsse'

# Named rather than guessed. HDT is the rig CBPC expects; RaceMenuMCM is the
# character creation option that matches having both RaceMenu and SkyUI, and
# FNIS Alternate Animations is the one to take when FNIS is installed, which
# it is.
foreach ($part in @(
    'Skeleton Meshes',
    'Skeleton Rig\HDT',
    'Creature Meshes',
    'Creature Rig\HDT',
    'Animations\Base\FNIS Alternate Animations',
    'Character Creation\RaceMenuMCM\assets',
    'Character Creation\RaceMenuMCM\plugin'
)) {
    if (-not (Pour (Join-Path $xd $part))) { Say "    missing in archive: $part" 'Yellow' }
}
if (-not (Test-Path -LiteralPath (Join-Path $Data 'XPMSE.esp'))) { Die 'XPMSE.esp did not land in Data.' }
Say '  skeleton, rig and XPMSE.esp in place' 'Green'

# ---------------------------------------------------------------- bodies
Head 'Bodies'
# CBBE's installer offers thirty odd folders. These are the ones that make a
# nude body with RaceMenu sliders and no underwear, which is what was asked
# for. Every NeverNude and Underwear option is left out on purpose, and the
# face and brow packs are left out because this build already has face mods
# that would fight them.
PourArchive 'CBBE' "Caliente's Beautiful Bodies*" $true @(
    '00 Required (Slim)',
    '01 Curvy',
    '07 Outfits Curvy',
    '09 Outfits BodySlide',
    '11 Pubic Hair',
    '26 RaceMenu Morphs',
    '27 Morph Files (Body)',
    '28 Morph Files (Outfits)'
)

# 3BA's base body, its physics patch, RaceMenu sliders and the texture that
# makes the nude body more than a smooth shape. The ygBase and
# UniqueCharacterBase options are alternative bodies, not additions, and the
# ECE slider is for a character editor this build does not use. "20 Compatible"
# is left out on purpose: it carries patches for other mods, and a patch whose
# master is not installed is a crash on load rather than a missing feature.
PourArchive 'CBBE 3BA' 'CBBE 3BA*' $true @(
    '00 Base',
    '10 Physics Patch',
    '15 RaceMenuMorphs',
    '30 Vagina Texture'
)
PourArchive 'BodySlide'      'BodySlide and Outfit Studio*' $true  $null
PourArchive 'HIMBO'          '01*HIMBO*'                    $true  $null
PourArchive 'HIMBO physics'  '04*HIMBO*'                    $false $null
if (-not $SkipRefits) { PourArchive 'HIMBO refits' '02*HIMBO*' $false $null }
else { Say '  HIMBO refits skipped, you asked for -SkipRefits' 'DarkGray' }
# Core is the mod, Body is the mesh it hangs off. Patches is skipped for the
# same reason as 3BA's: patches for mods this build may not have are a missing
# master, which is a crash rather than a shrug.
PourArchive 'The New Gentleman' 'The New Gentleman*' $true @(
    'Core',
    'Body'
)

if ($script:Unknown.Count) {
    Write-Host ''
    Say '  These archives have option folders this script does not know yet:' 'Yellow'
    foreach ($u in $script:Unknown) {
        Write-Host ''
        Say "  == $($u[0]) ==" 'Yellow'
        foreach ($n in $u[1]) { Say "    $n" 'Yellow' }
    }
    Write-Host ''
    Die 'Send Claude the lists above and it will name the right folders. Everything before this point installed fine.'
}

# ---------------------------------------------------------------- physics
Head 'Physics'
$c = @(Newest 'CBPC*')
if (-not $c.Count) { Die "Could not find 'CBPC*' in $Downloads." }
Say "  $($c[0].Name)" 'Green'
$cd = Unpack $c[0].FullName 'cbpc'

$cbpRoot = @(Get-ChildItem -LiteralPath $cd -Recurse -Directory -Filter '00 Data' -ErrorAction SilentlyContinue |
             Select-Object -First 1)
if (-not $cbpRoot.Count) { Die 'The CBPC archive has no "00 Data" folder. Did it change shape?' }
$cbp = $cbpRoot[0].FullName

$plugins = Join-Path $Data 'SKSE\Plugins'
$null = New-Item -ItemType Directory -Force -Path $plugins

# The config files sit loose at the top of 00 Data, and the dll lives in a
# folder per game build. Everything else in there is an alternative preset.
foreach ($f in @(Get-ChildItem -LiteralPath $cbp -File -Force)) {
    Copy-Item -LiteralPath $f.FullName -Destination (Join-Path $plugins $f.Name) -Force
    $script:Copied++
}
$dll = Join-Path $cbp 'SSE 1.6.1170\cbp.dll'
if (-not (Test-Path -LiteralPath $dll)) { Die 'CBPC has no build for SSE 1.6.1170. Check the archive.' }
Copy-Item -LiteralPath $dll -Destination (Join-Path $plugins 'cbp.dll') -Force
$script:Copied++
Say '  cbp.dll (the 1.6.1170 build) and its config' 'Green'

Say ''
Say ("  {0:n0} files into Game\Data all together" -f $script:Copied) 'Green'

# ---------------------------------------------------------------- load order
Head 'Load order'
$plug = Join-Path $Golden 'plugins.txt'
$lo   = Join-Path $Golden 'loadorder.txt'
if (-not (Test-Path $plug)) { Die "No reference plugin list at $plug." }

$plugLines = @(Get-Content $plug)
$loLines   = @(Get-Content $lo)

function InsertBeforeUnbound($lines, $entry) {
    $out = @(); $placed = $false
    foreach ($line in $lines) {
        if (-not $placed -and $line -match '^\*?Skyrim Unbound') { $out += $entry; $placed = $true }
        $out += $line
    }
    if (-not $placed) { $out += $entry }
    return $out
}

# Whatever actually landed, rather than a list typed from memory. Body mods
# vary in how many plugins they bring depending on the options chosen.
$found = @(Get-ChildItem -LiteralPath $Data -File -ErrorAction SilentlyContinue |
           Where-Object { $_.Extension -match '^\.es[pml]$' } |
           ForEach-Object { $_.Name } |
           Where-Object { $_ -match 'XPMSE|TNG|Gentleman|HIMBO|3BA|CBBE|Schlong' })

$added = 0
foreach ($name in $found) {
    if ($plugLines -notcontains "*$name" -and $plugLines -notcontains $name) {
        $plugLines = @(InsertBeforeUnbound $plugLines "*$name")
        $added++
        Say "  + $name" 'Green'
    }
    if ($loLines -notcontains $name) { $loLines = @(InsertBeforeUnbound $loLines $name) }
}
if ($added -eq 0) { Say '  nothing new to add' 'DarkGray' }

[IO.File]::WriteAllLines($plug, [string[]]$plugLines, (New-Object Text.UTF8Encoding($false)))
[IO.File]::WriteAllLines($lo,   [string[]]$loLines,   (New-Object Text.UTF8Encoding($false)))

if (-not (Test-Path $LocalAD)) { $null = New-Item -ItemType Directory -Force -Path $LocalAD }
Copy-Item $plug (Join-Path $LocalAD 'plugins.txt') -Force
Copy-Item $lo   (Join-Path $LocalAD 'loadorder.txt') -Force
Say "  $($plugLines.Count) lines in plugins.txt, $($loLines.Count) in loadorder.txt" 'DarkGray'

Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ''
Say '  Everyone gets the same meshes, so nobody needs to run BodySlide for' 'Gray'
Say '  this to work. Run it yourself only if you want to change the shapes,' 'Gray'
Say '  and then ship the built meshes so the five of you still match.' 'Gray'
Write-Host ''

if ($NoShip) {
    Head 'Done'
    Say 'Installed. Nothing published, you asked for -NoShip.' 'Green'
    if (-not $NoPause) { Write-Host ''; [void](Read-Host 'Enter to close') }
    exit 0
}

Head 'Handing over to Ship'
& (Join-Path $Here '..\release\Ship.ps1') -Notes $Notes -Root $Root
