<#
  Audit-Mods.ps1

  Measures the build and says which parts carry a plugin and which are pure
  assets, because only the second kind can ever be optional.

      .\scripts\mods\Audit-Mods.ps1

  Reads only. Writes one report, local\mod-audit.json, and prints a summary.

  Why this exists. SkyMP's client compares the server's manifest against the
  plugin list POSITIONALLY, index by index. One plugin missing shifts every
  plugin after it and the person is turned away with a load order error. So a
  mod with a plugin has to be on every machine, full stop, and the only things
  that can be made optional are the ones with no plugin at all: loose textures
  and meshes, sounds, ENB. This finds those and puts a number on them, less
  the loose files the game itself needs whatever a plugin says (its menus,
  behaviors, animations and skeletons), which it counts as required (#4259).
#>
#Requires -Version 7
[CmdletBinding()]
param(
    [string]$Root = (& (Join-Path $PSScriptRoot '..\release\Where.ps1') Install),
    [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
. (Join-Path (Join-Path (Split-Path -Parent $Here) 'dev') 'OwnPlugins.ps1')

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
function MB($n) { '{0,9:n1} MB' -f ($n / 1MB) }

$GameDir = Join-Path $Root 'Game'
$DataDir = Join-Path $GameDir 'Data'
if (-not (Test-Path -LiteralPath $DataDir)) { throw "No build at $DataDir" }

Write-Host ''
Write-Host '  THORNSWOOD  -  what is in this build' -ForegroundColor White
Say '  Reading. A few minutes: it is about thirty thousand files.' 'DarkGray'

# ---------------------------------------------------------- the plugins ---
$plugFile = Join-Path $Root 'Profile\LocalAppData\plugins.txt'
# The plugins the game loads: the five masters, then each '*' line
# (OwnPlugins.ps1). A master owns its archives the way any plugin does.
$enabled = @{}
if (Test-Path -LiteralPath $plugFile) {
    foreach ($p in (Get-LoadOrder $plugFile)) { $enabled[$p.ToLowerInvariant()] = $true }
}
Head ("Plugins: " + $enabled.Count + " enabled")

# ------------------------------------------------------------- archives ---
# A bsa is loaded by the plugin with the same base name. Taking one away while
# leaving the plugin does not desync anybody, it just makes that mod's things
# show up purple or missing, which is why a bsa is listed here but is never a
# safe candidate on its own.
Head 'Archives'
$bsa = @()
foreach ($f in (Get-ChildItem -LiteralPath $DataDir -Filter '*.bsa' -File)) {
    $base = [IO.Path]::GetFileNameWithoutExtension($f.Name) -replace ' - Textures$', ''
    $owner = ''
    foreach ($ext in '.esp', '.esm', '.esl') {
        if ($enabled.ContainsKey(($base + $ext).ToLowerInvariant())) { $owner = $base + $ext; break }
    }
    $bsa += [pscustomobject]@{ file = $f.Name; bytes = $f.Length; plugin = $owner }
}
$bsa = @($bsa | Sort-Object bytes -Descending)
$bsaVanilla = @($bsa | Where-Object { $_.file -like 'Skyrim - *' -or $_.file -eq '_ResourcePack.bsa' })
$bsaMod = @($bsa | Where-Object { $bsaVanilla -notcontains $_ })
Say ("  {0} archives, {1} of them Bethesda's own (never shipped anyway)" -f $bsa.Count, $bsaVanilla.Count)
foreach ($b in ($bsaMod | Select-Object -First 15)) {
    Say ("  {0}  {1}  {2}" -f (MB $b.bytes), $b.file.PadRight(46).Substring(0, 46),
         $(if ($b.plugin) { 'needs ' + $b.plugin } else { 'NO PLUGIN, can be optional' }))
}
if ($bsaMod.Count -gt 15) { Say ("  and " + ($bsaMod.Count - 15) + " smaller") 'DarkGray' }

# --------------------------------------------------------- loose assets ---
# Nothing loose is in the manifest and the server never looks at any of it,
# and the first folder under textures or meshes is almost always named after
# the mod that put it there. But the game itself needs some of it whatever a
# plugin says (#4259): the menus (everything under interface, .swf files and
# their translations), the behaviors and animations (Havok .hkx files, the
# behaviors and animations folders and the two animation data caches) and
# the skeletons. Leave those out and menus and characters break, so they are
# counted as required; only the rest can be optional. Until 12 November the
# whole loose total was called optional.
function Test-RequiredLoose([string]$top, [string]$rel) {
    if ($top -eq 'interface') { return $true }
    if ($top -ne 'meshes') { return $false }
    $parts = $rel.ToLowerInvariant().Split([char[]]'\/')
    $name = $parts[-1]
    if ($name.EndsWith('.hkx') -or $name.StartsWith('skeleton')) { return $true }
    if ($name -in 'animationdatasinglefile.txt', 'animationsetdatasinglefile.txt') { return $true }
    if ($parts.Count -gt 1 -and $parts[0] -in 'animationdata', 'animationsetdata') { return $true }
    return [bool]@($parts[0..($parts.Count - 2)] | Where-Object { $_ -in 'behaviors', 'animations' }).Count
}
# Every file under a folder. One it cannot read stops the audit naming it,
# because a total that leaves it out reads smaller than the build is.
function Get-LooseFiles([string]$dir) {
    try { return @(Get-ChildItem -LiteralPath $dir -Recurse -File -Force) }
    catch {
        Write-Host ''
        Write-Host ('STOP. A folder under ' + $dir + ' cannot be read: ' + $_.Exception.Message) -ForegroundColor Red
        Write-Host 'Nothing was written. Give this account read access to it and run this again.' -ForegroundColor Yellow
        exit 1
    }
}
Head 'Loose assets'
$loose = @()
foreach ($top in 'textures', 'meshes', 'sound', 'music', 'Shaders', 'interface') {
    $dir = Join-Path $DataDir $top
    if (-not (Test-Path -LiteralPath $dir)) { continue }

    $prefix = $dir.TrimEnd([char[]]'\/') + [IO.Path]::DirectorySeparatorChar
    $files = Get-LooseFiles $dir
    $sum = { param($fs, $want) [long](@($fs | Where-Object { (Test-RequiredLoose $top $_.FullName.Substring($prefix.Length)) -eq $want }) | Measure-Object -Property Length -Sum).Sum }
    $req = & $sum $files $true
    $opt = & $sum $files $false
    $loose += [pscustomobject]@{ path = "Data\$top\"; bytes = $req + $opt; required = $req; files = $files.Count; depth = 1 }
    Say ("  {0}  {1:n0} files   Data\{2}\{3}" -f (MB ($req + $opt)), $files.Count, $top, $(if ($req) { '   ' + (MB $req).Trim() + ' of it required' } else { '' })) 'Green'

    # One level in, so a texture pack can be taken out without taking the lot.
    foreach ($sub in (Get-ChildItem -LiteralPath $dir -Directory -Force)) {
        $sp = $sub.FullName.TrimEnd([char[]]'\/') + [IO.Path]::DirectorySeparatorChar
        $sf = @($files | Where-Object { $_.FullName.StartsWith($sp) })
        $sr = & $sum $sf $true
        $so = & $sum $sf $false
        if ($sr + $so -lt 20MB) { continue }
        $loose += [pscustomobject]@{
            path = "Data\$top\$($sub.Name)\"; bytes = $sr + $so; required = $sr; files = $sf.Count; depth = 2 }
        Say ("      {0}  {1:n0} files   Data\{2}\{3}\{4}" -f (MB ($sr + $so)), $sf.Count, $top, $sub.Name, $(if ($sr) { '   ' + (MB $sr).Trim() + ' of it required' } else { '' }))
    }
}

# ------------------------------------------------------- outside Data ----
Head 'Outside Data'
$root = @()
foreach ($e in (Get-ChildItem -LiteralPath $GameDir -Force -EA SilentlyContinue)) {
    if ($e.Name -eq 'Data') { continue }
    if ($e.PSIsContainer) {
        $ef = @(Get-ChildItem -LiteralPath $e.FullName -Recurse -File -Force -EA SilentlyContinue)
        $et = ($ef | Measure-Object -Property Length -Sum).Sum
        if (-not $et) { $et = 0 }
        $root += [pscustomobject]@{ path = $e.Name + '\'; bytes = [long]$et; files = $ef.Count }
    } else {
        $root += [pscustomobject]@{ path = $e.Name; bytes = $e.Length; files = 1 }
    }
}
foreach ($r in (@($root | Sort-Object bytes -Descending) | Select-Object -First 12)) {
    Say ("  {0}  {1:n0} files   {2}" -f (MB $r.bytes), $r.files, $r.path)
}

# ------------------------------------------------------------- the sums ---
$looseTotal = (@($loose | Where-Object { $_.depth -eq 1 }) | Measure-Object -Property bytes -Sum).Sum
if (-not $looseTotal) { $looseTotal = 0 }
$looseRequired = (@($loose | Where-Object { $_.depth -eq 1 }) | Measure-Object -Property required -Sum).Sum
if (-not $looseRequired) { $looseRequired = 0 }
$looseOptional = $looseTotal - $looseRequired
$bsaModTotal = ($bsaMod | Measure-Object -Property bytes -Sum).Sum
if (-not $bsaModTotal) { $bsaModTotal = 0 }
$noPlugin = @($bsaMod | Where-Object { -not $_.plugin })
$noPluginTotal = ($noPlugin | Measure-Object -Property bytes -Sum).Sum
if (-not $noPluginTotal) { $noPluginTotal = 0 }

Head 'What this means'
Say ("  {0}  loose assets with no plugin, which the server never looks at. These can be optional." -f (MB $looseOptional)) 'Green'
Say ("  {0}  loose files the game itself needs: menus, behaviors, animations, skeletons. These have to stay." -f (MB $looseRequired)) 'Yellow'
Say ("  {0}  mod archives that a plugin loads. These have to stay with their plugin." -f (MB $bsaModTotal)) 'Yellow'
if ($noPlugin.Count) {
    Say ("  {0}  archives with no enabled plugin at all. Dead weight, can go." -f (MB $noPluginTotal)) 'Green'
}

$report = [pscustomobject]@{
    at = (Get-Date).ToString('s')
    enabledPlugins = $enabled.Count
    bsa = $bsaMod
    loose = @($loose)
    root = @($root | Sort-Object bytes -Descending)
    looseTotal = [long]$looseTotal
    looseRequiredTotal = [long]$looseRequired
    looseOptionalTotal = [long]$looseOptional
    bsaModTotal = [long]$bsaModTotal
}
# local\ is what this machine keeps and git ignores (tools\ until 29 Sep, #440).
$outDir = Join-Path $Here '..\..\local'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$out = Join-Path $outDir 'mod-audit.json'
[IO.File]::WriteAllText($out, ($report | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding($false)))

Write-Host ''
Say "  Written to local\mod-audit.json. Tell Claude it is done." 'Green'
Write-Host ''
if (-not $NoPause) { [void](Read-Host 'Enter to close') }
