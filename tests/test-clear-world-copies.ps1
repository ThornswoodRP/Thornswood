<#
  test-clear-world-copies.ps1

      pwsh -NoProfile -File .\tests\test-clear-world-copies.ps1

  Clear-OldWorldCopies.ps1 removes the world copies every server install
  before #446 left in the VPS temp folder, keeps the newest of each kind, and
  never goes anywhere it should not (issue #1074).

  It runs the real script against two scratch temp folders holding
  world-, serverdata-, serverprivate- and serverlogs- folders of several
  stamps, a folder with a link in it, folders with names that only look like
  those, and a file with such a name, and checks:
    - -WhatIf adds them up and removes nothing
    - a real run removes all but the newest of each kind, from both folders
    - it says how much each kind held
    - a folder holding a link is left, and said, and what the link points at
      is untouched
    - nothing not named exactly like the installer named them is touched
    - -IncludeNewest removes the newest too once a backup newer than them is
      there, and keeps them while there is none
    - it refuses a machine that is not the box (scripts\vps\BoxGuard.ps1)
  Touches nothing but its scratch folder.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = (Resolve-Path (Join-Path $Here '..')).Path
$clear = Join-Path $repo 'scripts\vps\Clear-OldWorldCopies.ps1'
. (Join-Path $PSScriptRoot 'Windows.ps1')
$boxPs = Get-BoxPowerShell
. (Join-Path $repo 'scripts\vps\BoxGuard.ps1')

$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" }
}
function Put([string]$p, [string]$t) {
    $null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent $p)
    [IO.File]::WriteAllText($p, $t)
}
function There([string]$p) { return (Test-Path -LiteralPath $p) }

$box = Join-Path ([IO.Path]::GetTempPath()) ('ts-clear-worlds-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$t1 = Join-Path $box 'admin-temp'; $t2 = Join-Path $box 'windows-temp'; $backups = Join-Path $box 'backup'
try {
    foreach ($s in '20260920-100000', '20260924-100000', '20260927-100000') {
        Put (Join-Path $t1 "world-$s\w.txt") ('x' * 1000)
        Put (Join-Path $t1 "serverdata-$s\d.txt") ('x' * 100)
        Put (Join-Path $t1 "serverprivate-$s\door.json") '{ "key": "old copy" }'
        Put (Join-Path $t1 "serverlogs-$s\server.log") 'log'
    }
    Put (Join-Path $t2 'world-20260915-090000\w.txt') 'as SYSTEM, older'
    Put (Join-Path $t2 'world-20260928-090000\w.txt') 'as SYSTEM, the newest world'
    # Only looks like one, and a file with the name: never touched.
    foreach ($n in 'world-notastamp', 'world-20260920-100000-extra', 'myworld-20260920-100000', 'World-Backup') { Put (Join-Path $t1 "$n\keep.txt") 'not ours' }
    Put (Join-Path $t1 'world-20260921-100000') 'a file, not a folder'
    Put (Join-Path $t1 'deeper\world-20260921-100000\w.txt') 'below the temp folder, not in it'
    # A copy holding a link to something that must survive: an NTFS junction
    # on Windows, as on the box, and a symbolic link elsewhere.
    $target = Join-Path $box 'precious'
    Put (Join-Path $target 'keep.txt') 'must survive'
    $linked = Join-Path $t1 'serverdata-20260921-100000'
    $null = New-Item -ItemType Directory -Force -Path $linked
    if ($OnWindows) { $null = & (Get-WindowsPath 'System32\cmd.exe') /c ('mklink /J "' + (Join-Path $linked 'link') + '" "' + $target + '"') }
    else { $null = New-Item -ItemType SymbolicLink -Path (Join-Path $linked 'link') -Target $target }
    $haveLink = There (Join-Path $linked 'link\keep.txt')

    function Run([string[]]$more) {
        $a = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $clear, '-TempDirs', ($t1 + ',' + $t2), '-BackupDir', $backups, '-AllowGamingPc') + $more
        $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        try { $o = @(& $boxPs @a 2>&1 | ForEach-Object { "$_" }) } finally { $ErrorActionPreference = $eap }
        $script:code = $LASTEXITCODE
        return ($o -join "`n")
    }
    $o = Run @('-WhatIf')
    Yes 'with -WhatIf it adds up each kind' ($o -match 'world-\*: 5 folder\(s\)' -and $o -match 'serverprivate-\*: 3 folder\(s\)' -and $o -match 'all together')
    Yes '  and says what it would remove' ($o -match ('would remove ' + [regex]::Escape((Join-Path $t1 'world-20260920-100000'))) -and $o -match 'WHATIF: would free')
    Yes '  and removes nothing' ((There (Join-Path $t1 'world-20260920-100000')) -and (There (Join-Path $t2 'world-20260915-090000')) -and (There (Join-Path $t1 'serverprivate-20260920-100000')))

    $o = Run @()
    Yes 'a real run removes the older copies of every kind, in both temp folders' (
        -not (There (Join-Path $t1 'world-20260920-100000')) -and -not (There (Join-Path $t1 'world-20260924-100000')) -and -not (There (Join-Path $t1 'world-20260927-100000')) -and
        -not (There (Join-Path $t2 'world-20260915-090000')) -and -not (There (Join-Path $t1 'serverdata-20260920-100000')) -and
        -not (There (Join-Path $t1 'serverprivate-20260920-100000')) -and -not (There (Join-Path $t1 'serverprivate-20260924-100000')) -and
        -not (There (Join-Path $t1 'serverlogs-20260924-100000')))
    Yes '  and keeps the newest of each kind until a backup has run' (
        (There (Join-Path $t2 'world-20260928-090000')) -and (There (Join-Path $t1 'serverdata-20260927-100000')) -and
        (There (Join-Path $t1 'serverprivate-20260927-100000')) -and (There (Join-Path $t1 'serverlogs-20260927-100000')) -and
        $o -match 'kept .*world-20260928-090000, the newest world')
    if ($haveLink) {
        Yes 'a copy holding a link is left, and said' ((There $linked) -and $o -match ('LEFT ' + [regex]::Escape($linked) + ': it is a link or holds one') -and $script:code -ne 0)
        Yes '  and what the link points at is untouched' ((There (Join-Path $target 'keep.txt')))
    } else { Write-Host 'SKIP  the link case: no link could be made here' }
    Yes 'nothing that only looks like a copy is touched' (
        (There (Join-Path $t1 'world-notastamp\keep.txt')) -and (There (Join-Path $t1 'world-20260920-100000-extra\keep.txt')) -and
        (There (Join-Path $t1 'myworld-20260920-100000\keep.txt')) -and (There (Join-Path $t1 'World-Backup\keep.txt')) -and
        (There (Join-Path $t1 'world-20260921-100000')) -and (There (Join-Path $t1 'deeper\world-20260921-100000\w.txt')))

    # -IncludeNewest: kept while no backup is newer, removed once one is.
    if ($haveLink) { [IO.Directory]::Delete((Join-Path $linked 'link')); Remove-Item -LiteralPath $linked -Recurse -Force }
    $o = Run @('-IncludeNewest')
    Yes '-IncludeNewest with no backup yet keeps the newest, and says why' ((There (Join-Path $t2 'world-20260928-090000')) -and $o -match 'no backup newer than it yet')
    Put (Join-Path $backups 'thornswood-20260929-030000.zip') 'a backup'
    (Get-Item -LiteralPath (Join-Path $backups 'thornswood-20260929-030000.zip')).LastWriteTime = [datetime]'2026-09-29 03:00'
    $o = Run @('-IncludeNewest')
    Yes '-IncludeNewest once a newer backup is there removes the newest too' (
        -not (There (Join-Path $t2 'world-20260928-090000')) -and -not (There (Join-Path $t1 'serverprivate-20260927-100000')) -and $script:code -eq 0)
    $o = Run @()
    Yes 'and then there is nothing left to clear' ($o -match 'NOTHING TO CLEAR' -and $script:code -eq 0)

    # Off the box (a developer's workstation) it is refused without
    # -AllowGamingPc, in the rule's words (#3041).
    $notBox = Get-ThornswoodBoxRefusal
    if ($notBox) {
        $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        # Lines joined as they were said, since the rule's words can run to two
        # lines (off Windows, the error that says why Windows was not asked).
        try { $o = (@(& $boxPs -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $clear -TempDirs $t1 2>&1 | ForEach-Object { "$_" }) -join "`n") } finally { $ErrorActionPreference = $eap }
        Yes 'off the box it refuses, says why, and removes nothing' ($o.Contains('REFUSED: ' + $notBox) -and $LASTEXITCODE -ne 0)
    } else { Write-Host 'SKIP  the refusal off the box: this is the box, a server (tests\test-3041-box-guard.ps1 runs it with a workstation stood in)' }
} finally {
    $j = Join-Path $box 'admin-temp\serverdata-20260921-100000\link'
    if (Test-Path -LiteralPath $j) { [IO.Directory]::Delete($j) }
    Remove-Item -LiteralPath $box -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
