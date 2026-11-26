<#
.SYNOPSIS
  Reads the TES4 header of every plugin in Data and reports any master that is no longer present.

.DESCRIPTION
  Reads the TES4 header of every plugin in Data and reports any master that is
  no longer present. A missing master is an instant crash at load, so this is
  the check to run after pulling plugins out of the load order.

  Only the first 8 KB of each file is read. MAST fields always live in the TES4
  record, which is the first record in the file.

  A MASTER IN DATA IS NOT A LOADED MASTER (#4257). Switching a plugin off in
  Vortex takes its line out of plugins.txt and leaves its file in Data, so
  until 15 Nov an enabled plugin whose master had just been switched off
  passed here with "every dependency present" and failed at load. A master
  counts as loaded only when plugins.txt switches it on or the game loads it
  with no line: the five base masters (LoadOrder.ps1's, which test-load-order
  holds to the launcher's) and the plugins Skyrim.ccc beside Data names. A
  master in Data that is neither is reported against each enabled plugin
  that needs it, as switched off.

  Exit 0 when every plugin plugins.txt enables has its masters in Data. Exit 1
  when an enabled plugin has a missing master, or when Data is missing or
  empty (#4760). A plugins.txt that is missing or cannot be read stops it
  with exit 1 before any verdict, naming the path (#4809). A plugin with a
  missing master that plugins.txt leaves disabled is listed but does not fail
  the run, because nothing loads it.
#>
#Requires -Version 7
param(
    [string]$Data = ((& (Join-Path $PSScriptRoot '..\release\Where.ps1') Install) + '\Game\Data'),
    [string]$Plugins = ((& (Join-Path $PSScriptRoot '..\release\Where.ps1') Install) + '\Profile\Default\plugins.txt'),
    [switch]$NoPause
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'LoadOrder.ps1')   # $script:LoadOrderMasters, the five the game loads with no line

<#
  A CHECK THAT FINDS NOTHING MUST NOT SAY EVERYTHING IS FINE.

  Until 23 September this defaulted to the old build folder's Game\Data, a
  folder from before the rename that has not existed on either machine for
  weeks. Run with no arguments it listed an empty folder, compared nothing
  against nothing, and printed "no missing masters. every plugin's dependencies
  are present." in green. Two errors scrolled past above it and the verdict
  underneath was a lie.

  That is the same fault as the launcher's old scan line and as the entry about
  the tests that cannot run: a measurement of nothing reported as a pass. So the
  folder is checked first and an empty one stops this rather than passing it.
#>
if (-not (Test-Path -LiteralPath $Data)) {
    Write-Host ''
    Write-Output "STOP. There is no Data folder at $Data"
    Write-Host '  Nothing was read, so nothing can be said about any master.' -ForegroundColor Red
    Write-Host '  Pass -Data with the game folder you mean.' -ForegroundColor Yellow
    if (-not $NoPause) { [void](Read-Host 'Enter to exit') }
    exit 1
}

$present = @{}
Get-ChildItem -LiteralPath $Data -File |
    Where-Object { $_.Extension -in '.esp','.esm','.esl' } |
    ForEach-Object { $present[$_.Name.ToLower()] = $true }

$enabled = @{}
$pl = $Plugins
<#
  NO LIST, NO VERDICT (#4809). Without plugins.txt nothing says which plugins
  are switched on, so every one would count as switched off and the verdict
  below would be made up: "nothing will crash" over a plugin that loads.
  Until 16 Nov a plugins.txt that was not there was read as an empty list and
  that verdict was printed. A list that is not there, or cannot be read, stops
  this here, naming where it looked.
#>
if (-not (Test-Path -LiteralPath $pl -PathType Leaf)) {
    Write-Host ''
    Write-Output "STOP. There is no plugins.txt at $pl, so which plugins are switched on is not known, and nothing can be said about what crashes."
    Write-Host '  Pass -Plugins with the plugins.txt of the profile you play.' -ForegroundColor Yellow
    if (-not $NoPause) { [void](Read-Host 'Enter to exit') }
    exit 1
}
try { $plLines = [IO.File]::ReadAllLines($pl) }
catch {
    Write-Host ''
    Write-Output "STOP. The plugins.txt at $pl could not be read ($($_.Exception.Message)), so which plugins are switched on is not known, and nothing can be said about what crashes."
    if (-not $NoPause) { [void](Read-Host 'Enter to exit') }
    exit 1
}
$plLines | Where-Object { $_ -match '^\*' } |
    ForEach-Object { $enabled[$_.TrimStart('*').Trim().ToLower()] = $true }

# What the game loads: what plugins.txt switches on, the five base masters,
# and what Skyrim.ccc in the game folder names.
$loaded = @{}
foreach ($n in $enabled.Keys) { $loaded[$n] = $true }
foreach ($m in $script:LoadOrderMasters) { $loaded[$m.ToLower()] = $true }
$ccc = Join-Path (Split-Path -Parent $Data) 'Skyrim.ccc'
if (Test-Path -LiteralPath $ccc) {
    Get-Content -LiteralPath $ccc | ForEach-Object { "$_".Trim() } | Where-Object { $_ } |
        ForEach-Object { $loaded[$_.ToLower()] = $true }
}

$problems = @()
foreach ($f in (Get-ChildItem -LiteralPath $Data -File |
                Where-Object { $_.Extension -in '.esp','.esm','.esl' } | Sort-Object Name)) {

    $fs = [IO.File]::OpenRead($f.FullName)
    $buf = New-Object byte[] ([Math]::Min(8192, $fs.Length))
    [void]$fs.Read($buf, 0, $buf.Length)
    $fs.Close()

    # scan the header bytes for MAST fields: 'MAST' + uint16 size + zstring
    $masters = @()
    for ($i = 0; $i -lt $buf.Length - 6; $i++) {
        if ($buf[$i] -eq 0x4D -and $buf[$i+1] -eq 0x41 -and $buf[$i+2] -eq 0x53 -and $buf[$i+3] -eq 0x54) {
            $sz = [BitConverter]::ToUInt16($buf, $i + 4)
            if ($sz -gt 0 -and $sz -lt 260 -and ($i + 6 + $sz) -le $buf.Length) {
                $s = [Text.Encoding]::GetEncoding(1252).GetString($buf, $i + 6, $sz).TrimEnd([char]0)
                if ($s -match '\.es[pml]$') { $masters += $s }
            }
        }
    }

    $on = $enabled.ContainsKey($f.Name.ToLower())
    foreach ($m in ($masters | Select-Object -Unique)) {
        $why = $null
        if (-not $present.ContainsKey($m.ToLower())) { $why = 'not in Data' }
        elseif ($on -and -not $loaded.ContainsKey($m.ToLower())) { $why = 'switched off' }
        if ($why) {
            $problems += [pscustomobject]@{
                Plugin  = $f.Name
                Missing = $m
                State   = if ($on) { 'ENABLED' } else { 'disabled' }
                Why     = $why
            }
        }
    }
}

Write-Host ''
if ($present.Count -eq 0) {
    # Belt and braces with the Test-Path above: a folder that exists and holds
    # no plugins is the same nothing, and it must not read as a pass either.
    Write-Output "STOP. $Data has no plugins in it, so nothing was compared."
    if (-not $NoPause) { [void](Read-Host 'Enter to exit') }
    exit 1
}
$crashes = 0
if (-not $problems) {
    # THE COUNT IS THE POINT. The old line said everything was fine whether it
    # had read ninety nine plugins or none, which is how it spent weeks
    # reporting a pass from an empty folder.
    Write-Output ("no missing masters: $($present.Count) plugin(s) in $Data, " +
                  "$($enabled.Count) of them enabled, every dependency present.")
} else {
    $live = @($problems | Where-Object State -eq 'ENABLED')
    $crashes = $live.Count
    $problems | Sort-Object State, Plugin | Format-Table -AutoSize
    if ($live) {
        Write-Output ("{0} ENABLED plugin(s) have a missing master. That crashes at load." -f $live.Count)
        if (@($live | Where-Object Why -eq 'switched off').Count) {
            Write-Host '  A master marked switched off is in Data, but plugins.txt does not switch it on: switch it on in Vortex, or switch off the plugin that needs it.' -ForegroundColor Yellow
        }
    } else {
        Write-Output "all affected plugins are already disabled. nothing will crash."
    }
}

# What it found is the exit code (#4760). Until then a crash at load was
# printed in red and the run still exited 0, so a script or harness that ran
# this read a pass.
if ($crashes) { exit 1 }
exit 0
