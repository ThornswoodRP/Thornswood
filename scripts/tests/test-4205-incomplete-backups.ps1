<#
  test-4205-incomplete-backups.ps1

      pwsh -NoProfile -File scripts/tests/test-4205-incomplete-backups.ps1

  Issue #4205. When the nightly backup could not take the game servers'
  folders in time, it still wrote that night's copy under the same name as a
  whole one, and ran retention before it failed, so the copy without the
  world counted as one of the seven dailies (or the four weeklies on a
  Sunday) and pushed the oldest whole copy out. A week of such nights left
  no copy on the box with the world in it.

  The fix marks such a copy when it is made, with <archive>.incomplete
  beside it saying why, and retention never lets it push a whole copy out.
  It takes only a daily place no whole daily needs, and only while it is
  newer than the newest whole copy, so the server still keeps no more than
  seven daily and four weekly copies, as site/data/site/privacy.md says.
  Its mark goes with it.

  This runs the script's own retention section (from its "retention" header
  to the line that says what was kept) over a stand-in backups folder:
    1. seven whole nights, then seven nights without the servers: every
       whole daily and the whole weekly stay, and only the newest copy
       without the servers takes the one daily place left
    2. then one whole night: it is a daily, the seven whole dailies are
       kept, and the incomplete ones older than it go with their marks
    3. ten nights without the servers after one whole daily: the newest six
       take the six daily places left
    4. no run keeps more than seven daily and four weekly copies in all
    5. the script writes the mark when the servers were not taken, before
       retention runs
  Writes only into a scratch folder under TEMP, which it removes.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$script = Join-Path (Join-Path (Join-Path $Repo 'scripts') 'vps') 'vps-nightly-backup.ps1'
$text = [IO.File]::ReadAllText($script) -replace "`r", ''

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

# The retention section, as the script has it.
$head = $text.IndexOf('# ------------------------------------------------------------ retention ----')
$kept = if ($head -ge 0) { $text.IndexOf('Note ("  kept ', $head) } else { -1 }
$end = if ($kept -ge 0) { $text.IndexOf("`n", $kept) } else { -1 }
Yes 'the script has its retention section' ($head -ge 0 -and $end -gt $head)
if ($head -lt 0 -or $end -lt 0) { Write-Host ''; Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail); exit 1 }
$retention = $text.Substring($head, $end - $head)

# A night's archive, by its date, as the script names it; a night without
# the servers gets its mark the way the script writes it.
function Night([string]$out, [datetime]$day, [switch]$Incomplete) {
    $name = 'thornswood-' + $day.ToString('yyyyMMdd') + '-021500.zip.enc'
    [IO.File]::WriteAllText((Join-Path $out $name), 'x')
    if ($Incomplete) { [IO.File]::WriteAllText((Join-Path $out ($name + '.incomplete')), 'made without the game servers: test') }
}
function Run-Retention([string]$out) {
    $Out = $out; $KeepDaily = 7; $KeepWeekly = 4
    function Note($m) { }
    . ([scriptblock]::Create($retention))
}
function Left([string]$out) { @(Get-ChildItem -LiteralPath $out -File | ForEach-Object { $_.Name } | Sort-Object) }
function Day([int]$n) { ([datetime]'2026-11-01').AddDays($n - 1) }   # 1 Nov 2026 is a Sunday

$work = Join-Path ([IO.Path]::GetTempPath()) ('ts-4205-' + [Guid]::NewGuid().ToString('N'))
try {
    # ---- 1. a week whole, then a week without the servers ----------------------
    $out = Join-Path $work 'one'
    $null = New-Item -ItemType Directory -Force -Path $out
    foreach ($n in 1..7) { Night $out (Day $n) }
    foreach ($n in 8..14) { Night $out (Day $n) -Incomplete }
    Run-Retention $out
    $left = Left $out
    $whole = @(foreach ($n in 1..7) { 'thornswood-' + (Day $n).ToString('yyyyMMdd') + '-021500.zip.enc' })
    $lost = @($whole | Where-Object { $left -notcontains $_ })
    Yes ('1. after seven nights without the servers every whole copy stays' + $(if ($lost.Count) { ' (dropped: ' + ($lost -join ', ') + ')' } else { '' })) ($lost.Count -eq 0)
    $partial = @(foreach ($n in 8..14) { 'thornswood-' + (Day $n).ToString('yyyyMMdd') + '-021500.zip.enc' })
    $keptPartial = @($partial | Where-Object { $left -contains $_ })
    Yes ('   and only the newest without the servers takes the one daily place left, with its mark (' + ($keptPartial -join ', ') + ')') (
        $keptPartial.Count -eq 1 -and $keptPartial[0] -eq $partial[6] -and $left -contains ($partial[6] + '.incomplete'))
    Yes '   and the marks of the ones dropped went with them' (@($left | Where-Object { $_ -like '*.incomplete' }).Count -eq 1)
    Yes ('4. no more than seven daily and four weekly copies are kept (' + @($left | Where-Object { $_ -notlike '*.incomplete' }).Count + ')') (
        @($left | Where-Object { $_ -notlike '*.incomplete' }).Count -le 11)

    # ---- 2. then a whole night -------------------------------------------------
    Night $out (Day 16)
    Run-Retention $out
    $left = Left $out
    Yes '2. a whole night after them is kept' ($left -contains ('thornswood-' + (Day 16).ToString('yyyyMMdd') + '-021500.zip.enc'))
    Yes '   the incomplete copies older than it go, marks and all' (
        @($left | Where-Object { $_ -like '*.incomplete' -or $partial -contains $_ }).Count -eq 0)
    $dailies = @($left | Where-Object { $_ -match '^thornswood-(\d{8})-\d{6}\.zip\.enc$' -and ([datetime]::ParseExact($Matches[1], 'yyyyMMdd', $null)).DayOfWeek -ne 'Sunday' })
    Yes ('   the seven whole dailies are kept, 2 to 7 Nov and the new one (' + $dailies.Count + ')') (
        $dailies.Count -eq 7 -and $left -contains $whole[1] -and $left -contains $whole[6])
    Yes '   and the whole weekly stays' ($left -contains $whole[0])

    # ---- 3. ten nights without the servers -------------------------------------
    $out = Join-Path $work 'three'
    $null = New-Item -ItemType Directory -Force -Path $out
    Night $out (Day 2)
    foreach ($n in 3..12) { Night $out (Day $n) -Incomplete }
    Run-Retention $out
    $left = Left $out
    $kept = @($left | Where-Object { Test-Path -LiteralPath (Join-Path $out ($_ + '.incomplete')) })
    $newest = @(foreach ($n in 7..12) { 'thornswood-' + (Day $n).ToString('yyyyMMdd') + '-021500.zip.enc' })
    Yes ('3. of ten nights without the servers the newest six take the six daily places left (' + $kept.Count + ')') (
        $kept.Count -eq 6 -and @($newest | Where-Object { $kept -notcontains $_ }).Count -eq 0)
    Yes '   and the whole one before them stays' ($left -contains ('thornswood-' + (Day 2).ToString('yyyyMMdd') + '-021500.zip.enc'))
    Yes ('4. no more than seven daily and four weekly copies are kept here either (' + @($left | Where-Object { $_ -notlike '*.incomplete' }).Count + ')') (
        @($left | Where-Object { $_ -notlike '*.incomplete' }).Count -le 11)
}
finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

# ---- 5. the mark is written when the copy is made --------------------------
$mark = [regex]::Match($text, "if \(\`$serversNotTaken\) \{[^\n]*'\.incomplete'")
Yes '5. the script writes the mark when the servers were not taken' ($mark.Success)
Yes '   before retention runs' ($mark.Success -and $mark.Index -lt $head)

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
