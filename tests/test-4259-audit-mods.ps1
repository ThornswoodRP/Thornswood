<#
  test-4259-audit-mods.ps1

      pwsh -NoProfile -File .\tests\test-4259-audit-mods.ps1

  Audit-Mods.ps1 (#4259) run on a scratch build. It called every loose file
  under Data optional, because it asked only whether a plugin carries it,
  and so counted the game's menus (interface) and its behavior, animation
  and skeleton files as things a machine can leave out. This holds:
    1. menus, .hkx behaviors and animations and skeletons are counted as
       required, in the report and in the summary, and textures, sounds and
       plain meshes as optional;
    2. the summary no longer says the whole loose total can be optional;
    3. a folder it cannot read stops it, naming the folder, instead of being
       counted as nothing.
  Everything it writes is under its own temp folder, which it removes.
#>
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'Windows.ps1')
$ps = Get-BoxPowerShell
$script = Join-Path $repo 'scripts\mods\Audit-Mods.ps1'
$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-4259-' + [Guid]::NewGuid().ToString('N').Substring(0, 10))
function Put([string]$rel, [int]$size) {
    $p = Join-Path $T $rel
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $p) | Out-Null
    [IO.File]::WriteAllBytes($p, (New-Object byte[] $size))
}
function Run([string]$root) {
    # A copy of the script and what it dot-sources, in a scratch repository
    # layout, so its report (local\mod-audit.json beside the scripts folder)
    # is written in the scratch folder and never in this checkout.
    $o = & $ps -NoProfile -File $script:copy -Root $root -NoPause 2>&1 | Out-String
    return [pscustomobject]@{ Code = $LASTEXITCODE; Out = $o }
}
try {
    foreach ($rel in 'scripts\mods\Audit-Mods.ps1', 'scripts\dev\OwnPlugins.ps1', 'scripts\release\Where.ps1') {
        $to = Join-Path $T ('repo\' + $rel)
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $to) | Out-Null
        Copy-Item -LiteralPath (Join-Path $repo $rel) -Destination $to
    }
    $script:copy = Join-Path $T 'repo\scripts\mods\Audit-Mods.ps1'
    $out = Join-Path $T 'repo\local\mod-audit.json'
    $d = 'build\Game\Data\'
    Put ($d + 'textures\armor\a.dds') 1000
    Put ($d + 'sound\fx\b.wav') 300
    Put ($d + 'meshes\armor\c.nif') 200
    Put ($d + 'interface\inventorymenu.swf') 50
    Put ($d + 'interface\translations\mod_english.txt') 5
    Put ($d + 'meshes\actors\character\behaviors\0_master.hkx') 40
    Put ($d + 'meshes\actors\character\animations\mod\walk.hkx') 30
    Put ($d + 'meshes\actors\character\character assets\skeleton.nif') 20
    Put ($d + 'meshes\actors\character\character assets female\skeleton_female.nif') 10
    Put ($d + 'meshes\animationdatasinglefile.txt') 4
    Put ($d + 'Skyrim.esm') 1
    $r = Run (Join-Path $T 'build')
    Yes 'Audit-Mods runs on a scratch build and writes its report' ($r.Code -eq 0 -and (Test-Path -LiteralPath $out))
    if ($r.Code -ne 0) { Write-Host $r.Out }
    $rep = if (Test-Path -LiteralPath $out) { Get-Content -Raw -LiteralPath $out | ConvertFrom-Json } else { $null }
    $has = { param($n) $null -ne $rep -and $null -ne $rep.PSObject.Properties[$n] }
    Yes 'the report counts the loose files the game itself needs as required: menus, behaviors, animations, skeletons (159 bytes)' ((& $has 'looseRequiredTotal') -and $rep.looseRequiredTotal -eq 159)
    Yes 'and only textures, sounds and plain meshes as optional (1,500 bytes)' ((& $has 'looseOptionalTotal') -and $rep.looseOptionalTotal -eq 1500)
    Yes 'the loose total is still every loose file (1,659 bytes)' ((& $has 'looseTotal') -and $rep.looseTotal -eq 1659)
    Yes 'the summary says how much loose has to stay' ($r.Out -match 'loose files the game itself needs')
    Yes 'the summary no longer calls the whole loose total optional' ($r.Out -notmatch 'ALL of this can be optional')

    if (-not $OnWindows) {
        $script:locked = Join-Path $T 'build\Game\Data\textures\locked'
        New-Item -ItemType Directory -Force -Path $script:locked | Out-Null
        Put 'build\Game\Data\textures\locked\x.dds' 10
        if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out }
        & chmod 000 $script:locked
        $r = Run (Join-Path $T 'build')
        & chmod 755 $script:locked
        Yes 'a folder it cannot read stops it, naming the folder, and no report is written' ($r.Code -ne 0 -and $r.Out -match [regex]::Escape('locked') -and -not (Test-Path -LiteralPath $out))
    }
    else { Write-Host 'SKIP  an unreadable folder: made with chmod, off Windows only' }
}
finally {
    # The unreadable folder is made readable again before anything is removed.
    if ((Get-Variable -Name locked -Scope Script -ErrorAction Ignore) -and (Test-Path -LiteralPath $script:locked)) { & chmod 755 $script:locked }
    if (Test-Path -LiteralPath $T) { Remove-Item -LiteralPath $T -Recurse -Force }
}
Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
