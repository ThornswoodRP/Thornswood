<#
  Find-MissingMasters.ps1

  Reads the TES4 header of every plugin in Data and reports any master that is
  no longer present. A missing master is an instant crash at load, so this is
  the check to run after pulling plugins out of the load order.

  Only the first 8 KB of each file is read. MAST fields always live in the TES4
  record, which is the first record in the file.

  Exit 0 when every plugin plugins.txt enables has its masters in Data. Exit 1
  when an enabled plugin has a missing master, or when Data or plugins.txt is
  missing or cannot be read (#4760). A plugin with a missing master that
  plugins.txt leaves disabled is listed but does not fail the run, because
  nothing loads it.
#>
#Requires -Version 7
param(
    [string]$Data = ((& (Join-Path $PSScriptRoot '..\release\Where.ps1') Install) + '\Game\Data'),
    [string]$Plugins = ((& (Join-Path $PSScriptRoot '..\release\Where.ps1') Install) + '\Profile\Default\plugins.txt'),
    [switch]$NoPause
)

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
    Write-Host "STOP. There is no Data folder at $Data" -ForegroundColor Red
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
# Whether plugins.txt was read whole. Without it every plugin counts as
# disabled, so the verdict below means nothing and the run cannot pass.
$pluginsRead = $false
if (Test-Path $pl) {
    Get-Content $pl -ErrorVariable plError | Where-Object { $_ -match '^\*' } |
        ForEach-Object { $enabled[$_.TrimStart('*').Trim().ToLower()] = $true }
    $pluginsRead = -not $plError
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

    foreach ($m in ($masters | Select-Object -Unique)) {
        if (-not $present.ContainsKey($m.ToLower())) {
            $problems += [pscustomobject]@{
                Plugin  = $f.Name
                Missing = $m
                State   = if ($enabled.ContainsKey($f.Name.ToLower())) { 'ENABLED' } else { 'disabled' }
            }
        }
    }
}

Write-Host ''
if ($present.Count -eq 0) {
    # Belt and braces with the Test-Path above: a folder that exists and holds
    # no plugins is the same nothing, and it must not read as a pass either.
    Write-Host "STOP. $Data has no plugins in it, so nothing was compared." -ForegroundColor Red
    if (-not $NoPause) { [void](Read-Host 'Enter to exit') }
    exit 1
}
$crashes = 0
if (-not $problems) {
    # THE COUNT IS THE POINT. The old line said everything was fine whether it
    # had read ninety nine plugins or none, which is how it spent weeks
    # reporting a pass from an empty folder.
    Write-Host ("no missing masters: $($present.Count) plugin(s) in $Data, " +
                "$($enabled.Count) of them enabled, every dependency present.") -ForegroundColor Green
} else {
    $live = @($problems | Where-Object State -eq 'ENABLED')
    $crashes = $live.Count
    $problems | Sort-Object State, Plugin | Format-Table -AutoSize
    if ($live) {
        Write-Host ("{0} ENABLED plugin(s) have a missing master. That crashes at load." -f $live.Count) -ForegroundColor Red
    } else {
        Write-Host "all affected plugins are already disabled. nothing will crash." -ForegroundColor Yellow
    }
}

# What it found is the exit code (#4760). Until then a crash at load was
# printed in red and the run still exited 0, so a script or harness that ran
# this read a pass.
if ($crashes -or -not $pluginsRead) { exit 1 }
exit 0
