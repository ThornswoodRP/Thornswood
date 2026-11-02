<#
  test-watch-disk.ps1

  The watchdog on the VPS watches the disk, and says so once when a line is
  crossed rather than on every five minute run.

  WHY THIS EXISTS. Everything on that box shares one volume: both game
  servers, the site and its uploads, voice, the bot, every log and every
  payload. MOVING-THE-SERVER.md in the ops repo has it at 80 GB with 81 percent free,
  read off the box on 15 September, and all of those only grow. Until entry
  213 on the To Do List nothing watched it. From the entry: "Free space is a
  first-class alert, usually at twenty percent and again at ten, because it
  is the one resource whose exhaustion is total rather than partial."

  HOW. The watcher is a single quoted here-string inside Watch-Services.ps1,
  written out on the VPS as watch.ps1 and only ever run there. CI's parse
  check sees it as one string and never parses what is inside it. So this
  lifts it out through the AST, parses it as the file the box runs, and takes
  the disk functions and the lines that set its thresholds out of it by name.
  It then drives that real code against a scratch folder. It never runs the
  service loop, which would run schtasks on this machine.

  It checks what the entry's doneWhen asks of the box, here: a threshold set
  just above this machine's real free percentage writes the warning exactly
  once across several runs, and putting it back writes one recovery line.

  Read only apart from files under its own temp folder. Never connects to
  anything.
#>
[CmdletBinding()]
param([string]$WatchPath)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# The tests are in tests\, the repository is one folder up.
$Here = Split-Path -Parent $Here
. (Join-Path $PSScriptRoot 'Windows.ps1')
if (-not $WatchPath) { $WatchPath = Join-Path $Here 'scripts\vps\Watch-Services.ps1' }

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Done() {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}

# ---- the watcher, as the box gets it ----------------------------------------
$errs = $null
$outer = [System.Management.Automation.Language.Parser]::ParseFile($WatchPath, [ref]$null, [ref]$errs)
Yes 'Watch-Services.ps1 parses' ($errs.Count -eq 0)

$assign = $outer.Find({ param($a)
    $a -is [System.Management.Automation.Language.AssignmentStatementAst] -and "$($a.Left)" -eq '$watcher' }, $true)
$text = $null
if ($assign) {
    $str = $assign.Right.Find({ param($a) $a -is [System.Management.Automation.Language.StringConstantExpressionAst] }, $true)
    if ($str) { $text = $str.Value }
}
Yes 'the watcher here-string is in Watch-Services.ps1' ($null -ne $text)
if ($null -eq $text) { Done }

$werrs = $null
$inner = [System.Management.Automation.Language.Parser]::ParseInput($text, [ref]$null, [ref]$werrs)
Yes 'the watch.ps1 it writes on the box parses' ($werrs.Count -eq 0)
# Written out as UTF-8 with no byte order mark. Windows PowerShell 5.1, which
# the box ran until #5356, read such a file as ANSI, and the box's scripts are
# still held to plain ASCII.
Yes 'the watch.ps1 it writes is plain ASCII' (-not ($text -match '[^\x00-\x7F]'))

$fns = @{}
foreach ($f in $inner.FindAll({ param($a) $a -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true)) {
    $fns[$f.Name] = $f
}
$missing = @()
foreach ($n in @('Note', 'DiskNow', 'DiskLevel', 'DiskCheck')) {
    Yes "$n is in the watcher" ($fns.ContainsKey($n))
    if (-not $fns.ContainsKey($n)) { $missing += $n }
}

$top = @($inner.EndBlock.Statements)
$sets = @{}
foreach ($s in $top) {
    if ($s -is [System.Management.Automation.Language.AssignmentStatementAst]) { $sets["$($s.Left)"] = $s }
}
foreach ($v in @('$diskState', '$diskLow', '$diskCritical')) {
    Yes "the watcher sets $v" ($sets.ContainsKey($v))
    if (-not $sets.ContainsKey($v)) { $missing += $v }
}
if ($missing.Count) { Done }

# The two lines the entry names, twenty and ten, and the state file beside
# restarts.txt in the watcher's own folder.
$low0  = & ([scriptblock]::Create($sets['$diskLow'].Right.Extent.Text))
$crit0 = & ([scriptblock]::Create($sets['$diskCritical'].Right.Extent.Text))
Yes 'DISK LOW is under twenty percent' ($low0 -eq 20)
Yes 'DISK CRITICAL is under ten percent' ($crit0 -eq 10)
Yes 'the state file is disk.txt in the watcher''s folder, beside restarts.txt' (
    $sets['$diskState'].Extent.Text -match "Join-Path \`$root 'disk\.txt'")

# Where it runs: after the service loop, so a restart that takes a minute is
# not held up behind it, and before the trim, so its lines are trimmed too.
function IndexOf([scriptblock]$pred) {
    for ($i = 0; $i -lt $top.Count; $i++) { if (& $pred $top[$i]) { return $i } }
    return -1
}
$loopAt = IndexOf { param($s) $s -is [System.Management.Automation.Language.ForEachStatementAst] -and "$($s.Condition)" -eq '$checks' }
$trimAt = IndexOf { param($s) $s -is [System.Management.Automation.Language.ForEachStatementAst] -and "$($s.Condition)" -match '\$log' }
$callAt = IndexOf { param($s)
    (-not ($s -is [System.Management.Automation.Language.FunctionDefinitionAst])) -and
    $null -ne $s.Find({ param($a) $a -is [System.Management.Automation.Language.CommandAst] -and $a.GetCommandName() -eq 'DiskCheck' }, $true) }
Yes 'the watcher calls DiskCheck on every run' ($callAt -ge 0)
Yes 'after the service loop' ($loopAt -ge 0 -and $callAt -gt $loopAt)
Yes 'and before the trim' ($trimAt -ge 0 -and $callAt -lt $trimAt)

# From the entry's traps: "Do not replace the three-strikes rule with a
# disk-triggered restart; restarting a service does not free a disk."
$diskCode = $fns['DiskNow'].Extent.Text + $fns['DiskLevel'].Extent.Text + $fns['DiskCheck'].Extent.Text
Yes 'nothing in the disk check restarts anything' ($diskCode -notmatch 'schtasks|ScheduledTask|Restart-|Stop-Process|Start-Process')
Yes 'the three-strikes rule is still there' ($text -match '\$already -ge 3')

# The report run with no switches shows the disk too, read from the same drive.
$rest = $outer.Extent.Text.Remove($assign.Extent.StartOffset, $assign.Extent.EndOffset - $assign.Extent.StartOffset)
Yes 'the report reads the drive' ($rest -match 'Get-PSDrive')
Yes 'the report prints a disk line' ($rest -match "'disk      '")
Yes 'the report shows the watcher''s own verdict from disk.txt' ($rest -match 'disk\.txt')
Yes 'the report shows a LOW or CRITICAL disk in red' ($rest -match [regex]::Escape('LOW$|CRITICAL$'))

# ---- the real functions, against a scratch folder ---------------------------
foreach ($n in @('Note', 'DiskNow', 'DiskLevel', 'DiskCheck')) {
    . ([scriptblock]::Create($fns[$n].Extent.Text))
}

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-watchdisk-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
# The watcher names the volume by its folder's first two characters, the drive
# on the box (C:). Every scratch box here is under $tmp, so that is the name it
# must print: C: or D: on Windows, and off Windows the same two characters.
$drive = [regex]::Escape($tmp.Substring(0, 2))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

# A fresh box: its own folder, its own watch.log, no disk.txt, and the
# thresholds exactly as the watcher sets them.
function Box([string]$name) {
    $script:root = Join-Path $tmp $name
    New-Item -ItemType Directory -Force -Path $script:root | Out-Null
    $script:log = Join-Path $script:root 'watch.log'
    $script:diskState = & ([scriptblock]::Create($sets['$diskState'].Right.Extent.Text))
    $script:diskLow = $low0
    $script:diskCritical = $crit0
}
function Lines([string]$rx) {
    if (-not (Test-Path -LiteralPath $script:log)) { return 0 }
    return @(Get-Content -LiteralPath $script:log | Where-Object { $_ -match $rx }).Count
}
function AllLines() {
    if (-not (Test-Path -LiteralPath $script:log)) { return 0 }
    return @(Get-Content -LiteralPath $script:log).Count
}
function State() {
    if (-not (Test-Path -LiteralPath $script:diskState)) { return '' }
    return ('' + (Get-Content -LiteralPath $script:diskState -TotalCount 1)).Trim()
}

$size = 80.0 * 1GB
function Run([double]$pct) { return (DiskCheck ($size * $pct / 100.0) $size) }

try {
    # -- one disk filling up and being cleared, five minutes a step ----------
    Box 'walk'
    $walk = @(
        # free %, state after, LOW, CRITICAL, up, back: counts in watch.log so far
        @(50,   'ok',       0, 0, 0, 0, 'a first run on a healthy disk says nothing'),
        @(50,   'ok',       0, 0, 0, 0, 'nor does the next one'),
        @(19.5, 'low',      1, 0, 0, 0, 'under twenty is DISK LOW'),
        @(19.5, 'low',      1, 0, 0, 0, 'and five minutes later it is not said again'),
        @(19.9, 'low',      1, 0, 0, 0, 'nor as it drifts'),
        @(20.5, 'low',      1, 0, 0, 0, 'half a point over twenty is not back yet, so it cannot flap'),
        @(9.5,  'critical', 1, 1, 0, 0, 'under ten is DISK CRITICAL'),
        @(9.5,  'critical', 1, 1, 0, 0, 'said once'),
        @(10.5, 'critical', 1, 1, 0, 0, 'half a point over ten is still critical'),
        @(12,   'low',      1, 1, 1, 0, 'clear of ten by a point, it says it is up and still low'),
        @(25,   'ok',       1, 1, 1, 1, 'clear of twenty, it says the disk is back'),
        @(25,   'ok',       1, 1, 1, 1, 'once'),
        @(19,   'low',      2, 1, 1, 1, 'a new crossing is a new DISK LOW')
    )
    $said = 0
    foreach ($w in $walk) {
        $out = Run $w[0]
        $ok = (State) -eq $w[1] -and
              (Lines 'DISK LOW:') -eq $w[2] -and
              (Lines 'DISK CRITICAL:') -eq $w[3] -and
              (Lines 'disk up to ') -eq $w[4] -and
              (Lines 'disk back to ') -eq $w[5]
        Yes ("{0}% free: {1}" -f $w[0], $w[6]) $ok
        if (-not $ok) {
            Write-Host ("      disk.txt '{0}', watch.log:" -f (State))
            if (Test-Path -LiteralPath $script:log) { Get-Content -LiteralPath $script:log | ForEach-Object { Write-Host "        $_" } }
        }
        if ($w[0] -eq 19.5 -and $said -eq 0) {
            $said = 1
            Yes 'a run prints the free percentage' ("$out" -match ('^disk\s+19\.5% free on ' + $drive + ', 15\.6 GB of 80 GB \(low\)$'))
        }
    }
    Yes 'nothing else was written to watch.log' ((AllLines) -eq 5)
    $lowLine = @(Get-Content -LiteralPath $script:log | Where-Object { $_ -match 'DISK LOW:' })[0]
    $critLine = @(Get-Content -LiteralPath $script:log | Where-Object { $_ -match 'DISK CRITICAL:' })[0]
    Yes 'DISK LOW is a watch.log line like every other, stamped by Note' ("$lowLine" -match ('^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}  DISK LOW: 19\.5% free on ' + $drive + ', 15\.6 GB of 80 GB\.'))
    Yes 'DISK LOW says it is the whole box and that nothing was restarted' ("$lowLine" -match 'whole box' -and "$lowLine" -match 'Nothing was restarted')
    Yes 'DISK CRITICAL says what to clear and that nothing was restarted' ("$critLine" -match 'Clear old logs' -and "$critLine" -match 'Nothing was restarted')

    # -- a whole day of five minute runs on a low disk ------------------------
    Box 'day'
    for ($i = 0; $i -lt 288; $i++) { $null = Run 15 }
    Yes 'a day of runs at 15% free writes DISK LOW once, not 288 times' ((Lines 'DISK LOW:') -eq 1 -and (AllLines) -eq 1)

    # -- first runs, with no disk.txt yet -------------------------------------
    Box 'first-low'
    $null = Run 15
    Yes 'installed on a disk already under twenty, the first run says so' ((Lines 'DISK LOW:') -eq 1 -and (State) -eq 'low')
    Box 'first-critical'
    $null = Run 5
    Yes 'installed under ten, the first run says DISK CRITICAL and not DISK LOW too' (
        (Lines 'DISK CRITICAL:') -eq 1 -and (Lines 'DISK LOW:') -eq 0 -and (State) -eq 'critical')
    Box 'garbage'
    Set-Content -LiteralPath $script:diskState -Value 'nonsense' -Encoding ASCII
    $null = Run 50
    Yes 'a disk.txt it does not recognise counts as no disk.txt, and says nothing on a healthy disk' (
        (AllLines) -eq 0 -and (State) -eq 'ok')

    # -- the watcher's own lines, from the thresholds to the call, as it runs
    Box 'as-run'
    $firstAt = IndexOf { param($s) $s -is [System.Management.Automation.Language.AssignmentStatementAst] -and "$($s.Left)" -eq '$diskState' }
    $body = @()
    for ($i = $firstAt; $i -le $callAt; $i++) {
        if (-not ($top[$i] -is [System.Management.Automation.Language.FunctionDefinitionAst])) { $body += $top[$i].Extent.Text }
    }
    $printed = @(. ([scriptblock]::Create($body -join "`n")))
    $m = [regex]::Match("$($printed[-1])", '^disk\s+[\d.]+% free on ' + $drive + ', [\d.]+ GB of [\d.]+ GB \((ok|low|critical)\)$')
    Yes 'run as the box runs it, the watcher prints the free percentage' ($printed.Count -eq 1 -and $m.Success)
    if ($m.Success) {
        $level = $m.Groups[1].Value
        Write-Host ("      printed: {0}" -f $printed[-1])
        Yes 'and remembers what it found in disk.txt' ((State) -eq $level)
        Yes ('and on a first run writes a line only when the disk is under a line (' + $level + ')') (
            (AllLines) -eq $(if ($level -eq 'ok') { 0 } else { 1 }))
    }

    # -- this machine's own drive, the way the entry says to try it on the box
    Box 'real'
    $real = DiskNow
    Yes 'DiskNow reads the drive the watcher''s folder is on' ($null -ne $real -and $real.Size -gt 0 -and $real.Free -ge 0)
    if ($null -ne $real) {
        $di = New-Object IO.DriveInfo ($script:root.Substring(0, 1))
        Yes 'the size it reads is the size Windows reports, within a percent' (
            [math]::Abs($real.Size - $di.TotalSize) -le 0.01 * $di.TotalSize)
        # Get-PSDrive's Free is the space a writer may still use. On Windows
        # that is all the free space; Linux keeps blocks back for root (and a
        # container may allow less), and there Free is the available figure.
        $sysFree = if ($OnWindows) { $di.TotalFreeSpace } else { $di.AvailableFreeSpace }
        Yes 'the free space it reads is what the system reports, within a percent of the drive' (
            [math]::Abs($real.Free - $sysFree) -le 0.01 * $di.TotalSize)

        $pct = 100.0 * $real.Free / $real.Size
        Write-Host ("      this machine: {0:N1}% free on {1}" -f $pct, $script:root.Substring(0, 2))

        # A box that has been running and found the disk fine.
        Set-Content -LiteralPath $script:diskState -Value 'ok' -Encoding ASCII
        # "a threshold temporarily set just above the current free percentage"
        $script:diskLow = [math]::Ceiling($pct) + 1
        $script:diskCritical = 0
        $outs = @()
        for ($i = 0; $i -lt 3; $i++) { $s = DiskNow; $outs += (DiskCheck $s.Free $s.Size) }
        Yes ("with DISK LOW set just above it, at {0}%, three runs write it exactly once" -f $script:diskLow) (
            (Lines 'DISK LOW:') -eq 1 -and (AllLines) -eq 1)
        Yes 'and each run prints the free percentage it read' (
            @($outs | Where-Object { "$_" -match ('^disk\s+[\d.]+% free on ' + $drive + ', [\d.]+ GB of [\d.]+ GB \(low\)$') }).Count -eq 3)

        # "and putting them back"
        $script:diskLow = [math]::Floor($pct) - 1
        for ($i = 0; $i -lt 3; $i++) { $s = DiskNow; $null = DiskCheck $s.Free $s.Size }
        Yes 'put back under it, three more runs write one line saying the disk is back' (
            (Lines 'disk back to ') -eq 1 -and (AllLines) -eq 2 -and (State) -eq 'ok')
    }
}
finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -EA SilentlyContinue
}

Done
