<#
  test-4257-masters-switched-off.ps1

      pwsh -NoProfile -File .\tests\test-4257-masters-switched-off.ps1

  #4257. Find-MissingMasters counted a master as present whenever its file
  was in Data, switched on or not. Switching a plugin off in Vortex leaves
  its file in Data, so an enabled plugin whose master had just been switched
  off passed with "every dependency present" and then failed at load.

  This runs the script against made-up Data folders and plugin lists:
    1. an enabled plugin whose master is in Data but switched off is
       reported, against that plugin, as switched off, and the run does not
       say every dependency is present;
    2. the masters the game loads with no plugins.txt line count as loaded:
       the five base masters, and what Skyrim.ccc beside Data names;
    3. a switched-on master passes;
    4. a plugin that is itself switched off is not reported for a
       switched-off master, since nothing loads it;
    5. a master that is not in Data at all is still reported;
  and that the script takes the five base masters from LoadOrder.ps1, the
  copy held to the launcher's, rather than a list of its own.

  Writes only under its own scratch folder, which it removes.
#>
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Windows.ps1')
$ps = Get-BoxPowerShell
$Repo = (Resolve-Path (Split-Path -Parent $PSScriptRoot)).Path
$Script = Join-Path (Join-Path (Join-Path $Repo 'scripts') 'mods') 'Find-MissingMasters.ps1'
$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-4257-' + [Guid]::NewGuid().ToString('N').Substring(0, 10))
New-Item -ItemType Directory -Force -Path $T | Out-Null

# A plugin: a TES4 header naming its masters. Nothing of Bethesda's.
$Ascii = [Text.Encoding]::ASCII
function Plugin([string]$path, [string[]]$Masters = @()) {
    $body = New-Object IO.MemoryStream; $w = New-Object IO.BinaryWriter($body)
    $w.Write($Ascii.GetBytes('HEDR')); $w.Write([uint16]12); $w.Write([single]1.7); $w.Write([int32]0); $w.Write([uint32]0x800)
    foreach ($m in $Masters) {
        $z = $Ascii.GetBytes($m + [char]0)
        $w.Write($Ascii.GetBytes('MAST')); $w.Write([uint16]$z.Length); $w.Write($z)
        $w.Write($Ascii.GetBytes('DATA')); $w.Write([uint16]8); $w.Write((New-Object byte[] 8))
    }
    $w.Flush(); $data = $body.ToArray()
    $file = New-Object IO.MemoryStream; $f = New-Object IO.BinaryWriter($file)
    $f.Write($Ascii.GetBytes('TES4')); $f.Write([uint32]$data.Length); $f.Write([uint32]0); $f.Write([uint32]0)
    $f.Write([uint32]0); $f.Write([uint16]44); $f.Write([uint16]0); $f.Write($data); $f.Flush()
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null
    [IO.File]::WriteAllBytes($path, $file.ToArray())
}
function Put([string]$path, [string]$text) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null
    [IO.File]::WriteAllText($path, $text)
}
# A game folder with Data and, when asked, Skyrim.ccc beside it.
function Game([string]$name, [hashtable]$plugins, [string]$list, [string[]]$ccc = $null) {
    $g = Join-Path $T $name
    $d = Join-Path $g 'Data'
    foreach ($p in $plugins.Keys) { Plugin (Join-Path $d $p) $plugins[$p] }
    Put (Join-Path $g 'plugins.txt') $list
    if ($null -ne $ccc) { Put (Join-Path $g 'Skyrim.ccc') (($ccc -join "`r`n") + "`r`n") }
    return $g
}
function Run([string]$g) {
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $o = & $ps -NoProfile -File $Script -Data (Join-Path $g 'Data') -Plugins (Join-Path $g 'plugins.txt') -NoPause 2>&1 | Out-String
    $code = $LASTEXITCODE
    $ErrorActionPreference = $old
    return [pscustomobject]@{ Code = $code; Out = $o }
}
function Show($r) { ($r.Out -split "\r?\n") | Where-Object { $_ } | ForEach-Object { Write-Host "      $_" } }
$allPresent = 'every dependency present'

try {
    # 1. Base.esm is in Data and switched off; Needs.esp, switched on, needs it.
    $g = Game 'switched-off' @{ 'Skyrim.esm' = @(); 'Base.esm' = @('Skyrim.esm'); 'Needs.esp' = @('Skyrim.esm', 'Base.esm') } "*Needs.esp`n"
    $r = Run $g
    Yes 'an enabled plugin whose master is switched off is reported against that plugin, as switched off' ($r.Out -match 'Needs\.esp\s+Base\.esm\s+ENABLED\s+switched off')
    Yes '  and the run does not say every dependency is present' ($r.Out -notmatch $allPresent -and $r.Out -match '1 ENABLED plugin\(s\) have a missing master')
    if ($r.Out -match $allPresent) { Show $r }

    # 2. The base masters and Skyrim.ccc's plugins load with no line.
    $g = Game 'loaded-first' @{ 'Skyrim.esm' = @(); 'Update.esm' = @('Skyrim.esm'); 'ccFixtureFish.esm' = @('Skyrim.esm'); 'Needs.esp' = @('Skyrim.esm', 'Update.esm', 'ccFixtureFish.esm') } "*Needs.esp`n" @('ccFixtureFish.esm')
    $r = Run $g
    Yes 'the base masters and what Skyrim.ccc names count as loaded with no plugins.txt line' ($r.Out -match $allPresent)
    if ($r.Out -notmatch $allPresent) { Show $r }
    $g = Game 'ccc-not-there' @{ 'Skyrim.esm' = @(); 'ccFixtureFish.esm' = @('Skyrim.esm'); 'Needs.esp' = @('Skyrim.esm', 'ccFixtureFish.esm') } "*Needs.esp`n"
    $r = Run $g
    Yes '  and a Creation Club plugin no Skyrim.ccc names, and no line switches on, does not' ($r.Out -match 'Needs\.esp\s+ccFixtureFish\.esm\s+ENABLED\s+switched off')

    # 3. A switched-on master.
    $g = Game 'switched-on' @{ 'Skyrim.esm' = @(); 'Base.esm' = @('Skyrim.esm'); 'Needs.esp' = @('Skyrim.esm', 'Base.esm') } "*Base.esm`n*Needs.esp`n"
    $r = Run $g
    Yes 'a switched-on master passes' ($r.Out -match $allPresent -and $r.Out -match '2 of them enabled')
    if ($r.Out -notmatch $allPresent) { Show $r }

    # 4. Both the plugin and its master switched off: nothing loads it.
    $g = Game 'both-off' @{ 'Skyrim.esm' = @(); 'Base.esm' = @('Skyrim.esm'); 'Needs.esp' = @('Skyrim.esm', 'Base.esm') } "Needs.esp`n"
    $r = Run $g
    Yes 'a switched-off plugin is not reported for a switched-off master' ($r.Out -match $allPresent)
    if ($r.Out -notmatch $allPresent) { Show $r }

    # 5. A master that is not in Data at all.
    $g = Game 'not-in-data' @{ 'Skyrim.esm' = @(); 'Needs.esp' = @('Skyrim.esm', 'Gone.esm') } "*Needs.esp`n"
    $r = Run $g
    Yes 'a master not in Data is still reported, as not in Data' ($r.Out -match 'Needs\.esp\s+Gone\.esm\s+ENABLED\s+not in Data' -and $r.Out -match '1 ENABLED plugin\(s\) have a missing master')
    if ($r.Out -notmatch 'Gone\.esm') { Show $r }

    # The five come from LoadOrder.ps1, held to the launcher's by
    # test-load-order, and not from a list of the script's own.
    $text = [IO.File]::ReadAllText($Script)
    Yes 'it takes the base masters from LoadOrder.ps1 and names none of them itself' ($text -match '\$script:LoadOrderMasters' -and $text -match "LoadOrder\.ps1'" -and $text -notmatch 'Dragonborn\.esm')
}
finally {
    if (Test-Path -LiteralPath $T) { Remove-Item -LiteralPath $T -Recurse -Force }
}
Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
