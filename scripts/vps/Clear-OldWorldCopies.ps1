<#
  Clear-OldWorldCopies.ps1

  Removes the copies of the world that every server install before #446 left
  in the VPS temp folder, keeping the newest of each kind (issue #1074). Runs
  ON the VPS, as Administrator, through Remote.ps1.

      .\scripts\vps\Remote.ps1 -File .\scripts\vps\Clear-OldWorldCopies.ps1 -Arguments '-WhatIf'
      .\scripts\vps\Remote.ps1 -File .\scripts\vps\Clear-OldWorldCopies.ps1

  WHY. Until 28 September Install-ThornswoodServer.ps1 copied the world, the
  data folder and the roster into %TEMP% on every install, as world-<stamp>,
  serverdata-<stamp> and serverprivate-<stamp>, moved the logs to
  serverlogs-<stamp>, and never deleted any of them. Publish-Server runs it
  over ssh as Administrator, so every live and dev publish since then left a
  whole world in Administrator's temp folder. serverprivate-* holds a copy of
  door.json and its key each time. The installer stopped making them with #446.

  WHAT IT DOES. Looks in Administrator's temp folder and in C:\Windows\Temp
  (in case one ran as SYSTEM), for folders named exactly
  world-, serverdata-, serverprivate- or serverlogs- and a yyyyMMdd-HHmmss
  stamp, directly in those folders and nowhere below. Says how many there are
  and how much each kind holds, keeps the newest of each kind, and removes the
  rest. -IncludeNewest removes the newest ones too, but only once a nightly
  backup newer than each has been made (C:\Thornswood-Backup), so the last copy
  of anything goes only after a backup holds it.

  WHAT IT REFUSES.
    - anywhere that is not the box: a Windows workstation, which a gaming PC
      is, or a machine Windows will not say is a server (BoxGuard.ps1)
    - a folder that is a link or holds one anywhere inside it: it is left as
      it is and said, because removing through a link can reach whatever the
      link points at
    - anything not named as above
  -WhatIf lists and adds up, and removes nothing.

  scripts\tests\test-clear-world-copies.ps1 runs it against scratch folders.
#>
param(
    [switch]$WhatIf,
    [switch]$IncludeNewest,
    # Where to look. Only the tests pass anything else.
    [string[]]$TempDirs = @(),
    [string]$BackupDir = 'C:\Thornswood-Backup',
    # The tests run on a developer's machine, a workstation. Nothing else
    # passes it.
    [switch]$AllowGamingPc
)
$ErrorActionPreference = 'Stop'
function Say([string]$m) { Write-Output $m }

# ---- BoxGuard.ps1 (copy) ----
function Get-ThornswoodBoxRefusal {
    # scripts\vps\BoxGuard.ps1 says why this asks Windows rather than looking
    # for the game, and why it refuses when it cannot tell (#3041).
    try { $type = [int](Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop).ProductType }
    catch { return ('Windows did not say whether this is a server (' + $_.Exception.Message + '), so it is not taken for the box') }
    if ($type -eq 2 -or $type -eq 3) { return '' }
    if ($type -eq 1) { return 'this is a Windows workstation, a gaming PC or a developer''s machine, not the box' }
    return ('Windows gives this machine product type ' + $type + ', which is not a server, so it is not taken for the box')
}
# ---- end BoxGuard.ps1 ----
if (-not $AllowGamingPc) {
    $notBox = Get-ThornswoodBoxRefusal
    if ($notBox) { Say ('REFUSED: ' + $notBox + '. Nothing was removed.'); exit 1 }
}
# Passed as one word with commas when it comes through powershell -File.
$TempDirs = @($TempDirs | ForEach-Object { "$_" -split ',' } | Where-Object { $_ })
if (-not $TempDirs.Count) {
    $TempDirs = @([IO.Path]::GetTempPath(), (Join-Path $env:LOCALAPPDATA 'Temp'), (Join-Path $env:SystemRoot 'Temp'))
}
$seen = @{}
$dirs = @()
foreach ($d in $TempDirs) {
    if (-not $d) { continue }
    $full = [IO.Path]::GetFullPath($d).TrimEnd('\')
    if ($seen.ContainsKey($full.ToLowerInvariant()) -or -not (Test-Path -LiteralPath $full)) { continue }
    $seen[$full.ToLowerInvariant()] = $true
    $dirs += $full
}

$rule = '^(world|serverdata|serverprivate|serverlogs)-(\d{8}-\d{6})$'
function Size([string]$path) {
    $n = 0L
    foreach ($f in @(Get-ChildItem -LiteralPath $path -Recurse -File -Force -ErrorAction SilentlyContinue)) { $n += $f.Length }
    return $n
}
function MB([long]$n) { return ('{0:N1} MB' -f ($n / 1MB)) }
function HasLink([string]$path) {
    if ((Get-Item -LiteralPath $path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { return $true }
    return [bool](@(Get-ChildItem -LiteralPath $path -Recurse -Force -Attributes ReparsePoint -ErrorAction SilentlyContinue).Count)
}

$found = @()
foreach ($d in $dirs) {
    foreach ($f in @(Get-ChildItem -LiteralPath $d -Directory -Force -ErrorAction SilentlyContinue)) {
        if ($f.Name -notmatch $rule) { continue }
        $found += [pscustomobject]@{ Kind = $Matches[1]; Stamp = $Matches[2]; Path = $f.FullName; Bytes = (Size $f.FullName)
                                     At = [datetime]::ParseExact($Matches[2], 'yyyyMMdd-HHmmss', [Globalization.CultureInfo]::InvariantCulture) }
    }
}
Say ('looked in ' + ($dirs -join ', '))
if (-not $found.Count) { Say 'NOTHING TO CLEAR: no world copies are left.'; exit 0 }

$total = 0L
foreach ($g in @($found | Group-Object Kind | Sort-Object Name)) {
    $b = 0L; foreach ($x in $g.Group) { $b += $x.Bytes }
    $total += $b
    Say ('  ' + $g.Name + '-*: ' + $g.Count + ' folder(s), ' + (MB $b))
}
Say ('  all together ' + $found.Count + ' folder(s), ' + (MB $total))

# The newest nightly backup, for -IncludeNewest.
$lastBackup = $null
if (Test-Path -LiteralPath $BackupDir) {
    $z = @(Get-ChildItem -LiteralPath $BackupDir -File -Filter 'thornswood-*.zip' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1)
    if ($z.Count) { $lastBackup = $z[0].LastWriteTime }
}

$go = @()
foreach ($g in @($found | Group-Object Kind)) {
    $sorted = @($g.Group | Sort-Object Stamp -Descending)
    $newest = $sorted[0]
    if ($IncludeNewest -and $lastBackup -and $lastBackup -gt $newest.At) { $go += $sorted }
    else {
        if ($IncludeNewest) { Say ('  kept ' + $newest.Path + ': no backup newer than it yet') }
        else { Say ('  kept ' + $newest.Path + ', the newest ' + $g.Name + ', until a backup has run') }
        $go += @($sorted | Select-Object -Skip 1)
    }
}

$freed = 0L; $left = 0
foreach ($x in @($go | Sort-Object Path)) {
    if (HasLink $x.Path) { Say ('  LEFT ' + $x.Path + ': it is a link or holds one'); $left++; continue }
    if ($WhatIf) { Say ('  would remove ' + $x.Path + ', ' + (MB $x.Bytes)); $freed += $x.Bytes; continue }
    try {
        [IO.Directory]::Delete($x.Path, $true)
        Say ('  removed ' + $x.Path + ', ' + (MB $x.Bytes))
        $freed += $x.Bytes
    } catch { Say ('  COULD NOT REMOVE ' + $x.Path + ': ' + $_.Exception.Message); $left++ }
}
if ($WhatIf) { Say ('WHATIF: would free ' + (MB $freed) + '. Nothing was removed.') }
else { Say ('CLEARED ' + (MB $freed) + '; ' + $left + ' left as they were.') }
if ($left) { exit 1 }
