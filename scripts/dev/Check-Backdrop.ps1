<#
  Check-Backdrop.ps1

  Read only. Says what the main menu backdrop is in a game folder: the two
  logo meshes (their hashes, how many shapes each carries, and whether
  logo01ae.nif's one shape is hidden, which decides whether a second plate
  draws and whether the game crashes at the main menu) and the wallpaper texture (size, mip levels,
  format), against what the repo carries in game\menu. Nothing is changed.

    .\scripts\dev\Check-Backdrop.ps1                          C:\Thornswood\Game
    .\scripts\dev\Check-Backdrop.ps1 -Game C:\Thornswood-DevBuild\Game

  Why it exists: entry 83 on the To Do List. Both logo meshes were the same
  replacer plate, so the menu drew the backdrop twice, and the texture was a
  single mip built from the old 1536 wide art. Somebody looking at a soft,
  doubled menu can run this and read which half is still wrong.
#>
#Requires -Version 7
[CmdletBinding()]
param(
    [string]$Game = ((& (Join-Path $PSScriptRoot '..\release\Where.ps1') Install) + '\Game')
)

$ErrorActionPreference = 'Stop'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoMenu = Join-Path $Here '..\..\game\menu'

function Md5([string]$p) { (Get-FileHash -LiteralPath $p -Algorithm MD5).Hash.Substring(0, 8).ToLowerInvariant() }
# A Skyrim SE nif's shapes (anything the engine draws: BSTriShape,
# NiTriShape, NiTriStrips and their kin) and its root: how many children the
# root has, the root's scale, and the type and hidden flag (APP_CULLED, bit 0)
# of its first child. Shapes is -1 when it is not a nif this can read.
# Issue #1158: the Anniversary menu reads logo01ae.nif's first child, so an
# empty root crashes the game at the main menu. The plate stays in it,
# hidden and at scale 0.
function Mesh([string]$p) {
    $r = @{ Shapes = -1; Kids = -1; Scale = [single]1; Child = ''; Hidden = $false }
    $b = [IO.File]::ReadAllBytes($p)
    $o = [Array]::IndexOf($b, [byte]10) + 1
    if ($o -le 0 -or $b.Length -lt $o + 21) { return $r }
    if ([BitConverter]::ToUInt32($b, $o) -ne 0x14020007) { return $r }
    $blocks = [BitConverter]::ToUInt32($b, $o + 9)
    $o += 17
    for ($i = 0; $i -lt 3; $i++) { $o += 1 + $b[$o] }
    $ntypes = [BitConverter]::ToUInt16($b, $o); $o += 2
    $types = @()
    for ($i = 0; $i -lt $ntypes; $i++) {
        $n = [BitConverter]::ToUInt32($b, $o); $o += 4
        $types += [Text.Encoding]::ASCII.GetString($b, $o, $n); $o += $n
    }
    $kinds = @(); $at = @()
    for ($i = 0; $i -lt $blocks; $i++) { $kinds += $types[[BitConverter]::ToUInt16($b, $o + 2 * $i)] }
    $sizes = $o + 2 * $blocks; $o = $sizes + 4 * $blocks
    $nstr = [BitConverter]::ToUInt32($b, $o); $o += 8
    for ($i = 0; $i -lt $nstr; $i++) { $o += 4 + [BitConverter]::ToUInt32($b, $o) }
    $o += 4 + 4 * [BitConverter]::ToUInt32($b, $o)
    for ($i = 0; $i -lt $blocks; $i++) { $at += $o; $o += [BitConverter]::ToUInt32($b, $sizes + 4 * $i) }
    $r.Shapes = @($kinds | Where-Object { $_ -match 'TriShape|TriStrips' }).Count
    # NiObjectNET + NiAVObject, stream 100: name, extra data, controller,
    # flags, translation, rotation, scale, collision; then a node's children.
    $av = {
        param($x)
        $x += 4; $x += 4 + 4 * [BitConverter]::ToUInt32($b, $x); $x += 4
        @{ Flags = [BitConverter]::ToUInt32($b, $x); Scale = [BitConverter]::ToSingle($b, $x + 52); End = $x + 60 }
    }
    if ($blocks -gt 0 -and $kinds[0] -match 'Node$') {
        $root = & $av $at[0]
        $r.Scale = $root.Scale
        $r.Kids = [BitConverter]::ToUInt32($b, $root.End)
        if ($r.Kids -gt 0) {
            $c = [BitConverter]::ToInt32($b, $root.End + 4)
            if ($c -ge 0 -and $c -lt $blocks) {
                $r.Child = $kinds[$c]
                $r.Hidden = ((& $av $at[$c]).Flags -band 1) -eq 1
            }
        }
    }
    return $r
}
# The texture's header, and what is wrong with it. Issue #994: the backdrop is
# BC7_UNORM (DXGI 98, behind a DX10 header), 4096 x 4096 with all 13 levels,
# and exactly as long as those levels. DXT1 was the old build that bands in
# the sky; BC7_UNORM_SRGB (99) draws darker than it was built.
function Dds([string]$p) {
    $b = [IO.File]::ReadAllBytes($p)
    if ($b.Length -lt 128 -or [Text.Encoding]::ASCII.GetString($b, 0, 4) -ne 'DDS ') { return @{ Text = 'not a DDS file'; Wrong = @('not a DDS file') } }
    $h = [BitConverter]::ToUInt32($b, 12); $w = [BitConverter]::ToUInt32($b, 16)
    $mips = [BitConverter]::ToUInt32($b, 28)
    $fourcc = [Text.Encoding]::ASCII.GetString($b, 84, 4)
    $flags = [BitConverter]::ToUInt32($b, 8)
    $mipFlag = if ($flags -band 0x20000) { 'mipmap flag set' } else { 'no mipmap flag' }
    $format = $fourcc; $start = 128; $block = 16
    if ($fourcc -eq 'DX10' -and $b.Length -ge 148) {
        $dxgi = [BitConverter]::ToUInt32($b, 128); $start = 148
        $format = switch ($dxgi) { 98 { 'BC7_UNORM' } 99 { 'BC7_UNORM_SRGB' } 71 { 'BC1_UNORM' } default { "DXGI format $dxgi" } }
    }
    if ($format -eq 'DXT1' -or $format -eq 'BC1_UNORM') { $block = 8 }
    $expect = $start
    $s = [Math]::Max($w, $h)
    for ($i = 0; $i -lt $mips; $i++) { $expect += [Math]::Pow([Math]::Ceiling($s / 4), 2) * $block; $s = [Math]::Max(1, [Math]::Floor($s / 2)) }
    $wrong = @()
    if ($w -ne 4096 -or $h -ne 4096) { $wrong += 'NOT 4096 x 4096' }
    if ($mips -eq 1) { $wrong += 'NO MIPS: soft at any size but its own' }
    elseif ($mips -ne 13) { $wrong += "$mips LEVELS, not the full 13" }
    if ($format -eq 'DXT1') { $wrong += 'DXT1: the old build, the sky bands' }
    elseif ($format -eq 'BC7_UNORM_SRGB') { $wrong += 'BC7_UNORM_SRGB: draws darker than built' }
    elseif ($format -ne 'BC7_UNORM') { $wrong += "$($format): not BC7_UNORM" }
    if ($w -eq $h -and $b.Length -ne $expect) { $wrong += ('{0:n0} BYTES, the levels need {1:n0}' -f $b.Length, $expect) }
    return @{
        Text  = ('{0}x{1}, {2} mip level(s), {3}, {4}, {5:n0} bytes' -f $w, $h, $mips, $format, $mipFlag, $b.Length)
        Wrong = $wrong
    }
}

Write-Host ''
Write-Host "Main menu backdrop in $Game" -ForegroundColor Cyan
$files = @(
    @{ Rel = 'Data\meshes\interface\logo\logo.nif';                    Kind = 'mesh' },
    @{ Rel = 'Data\meshes\interface\logo\logo01ae.nif';                Kind = 'mesh' },
    @{ Rel = 'Data\textures\interface\objects\Mainmenuwallpaper.dds';  Kind = 'dds' }
)
$bad = 0
foreach ($f in $files) {
    $badBefore = $bad
    $p = Join-Path $Game $f.Rel
    $leaf = Split-Path $f.Rel -Leaf
    $ours = Join-Path $repoMenu $leaf
    if (-not (Test-Path -LiteralPath $p)) { Write-Host "  $($f.Rel): MISSING" -ForegroundColor Red; $bad++; continue }
    $line = '  ' + $f.Rel + ': md5 ' + (Md5 $p)
    if ($f.Kind -eq 'mesh') {
        $m = Mesh $p
        $s = $m.Shapes
        $line += (', {0} shape(s)' -f $s)
        if ($leaf -ieq 'logo01ae.nif') {
            if ($m.Kids -eq 0) { $line += ' (AN EMPTY ROOT: the Anniversary menu reads its first child and the game crashes at the main menu, #1158)'; $bad++ }
            elseif ($m.Kids -ne 1 -or $m.Child -ne 'BSTriShape') { $line += (' (THE ROOT SHOULD HOLD ONE BSTriShape, it holds {0}, first {1})' -f $m.Kids, $m.Child); $bad++ }
            elseif (-not $m.Hidden -or $m.Scale -ne 0) { $line += ' (A SECOND PLATE: the shape should be hidden and the root at scale 0)'; $bad++ }
            else { $line += ', hidden, root at scale 0 (the menu finds its shape and draws nothing: right)' }
        } elseif ($s -ne 1) { $line += ' (the backdrop plate should be one shape)'; $bad++ }
    } else {
        $d = Dds $p
        $line += ', ' + $d.Text
        if ($d.Wrong.Count) { $line += ' (' + ($d.Wrong -join '; ') + ')'; $bad++ }
    }
    if (Test-Path -LiteralPath $ours) {
        if ((Md5 $p) -eq (Md5 $ours)) { $line += ' = the repo copy' } else { $line += ' <> the repo copy in game\menu'; $bad++ }
    } else {
        $line += ' (nothing to compare with in game\menu)'
    }
    Write-Host $line -ForegroundColor $(if ($bad -gt $badBefore) { 'Yellow' } else { 'Green' })
}
Write-Host ''
if ($bad) { Write-Host "  $bad thing(s) wrong. Go.ps1 puts the repo's copies in; Ship carries them." -ForegroundColor Yellow; exit 1 }
Write-Host '  one plate, a BC7 texture with all its levels, all as the repo has them.' -ForegroundColor Green
exit 0
