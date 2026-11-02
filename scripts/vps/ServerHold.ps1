<#
  ServerHold.ps1

  A hold: a server stopped on purpose says so, and the watchdog leaves it
  stopped until the hold ends (#5155).

  WHY. The watchdog on the box (Watch-Services.ps1, the Thornswood Watch task,
  every five minutes) starts any server that is not answering. It had no way
  to know a stop was on purpose. On 31 Oct 2026 the live server was stopped at
  about 4:00 PM so its merchant ledger could be swapped before a new gamemode
  went on, and at 4:01:24 PM the watchdog started the old gamemode again,
  which read the new ledger and failed on it; the dev server the same at
  3:01:24 PM. Patrick's answer the same day (A): whoever stops a server on
  purpose leaves a hold beside it, saying who, why and until when, 30 minutes
  unless they say otherwise and 2 hours at most. The watchdog leaves a held
  server alone until the hold ends, then tells staff once and starts it. A
  crash, with no hold, is restarted straight away as before.

  WHERE. One file per server in C:\Thornswood-Watch\holds, named by the
  server's task or service name with everything but letters and digits made a
  dash: 'Thornswood Server' is Thornswood-Server.json, 'ThornswoodBot' is
  ThornswoodBot.json. It holds target, by, why, set and until, the two times
  in unix seconds. The watchdog reads it (ReadHold in Watch-Services.ps1) and
  takes 2 hours from when the file was written as the most it will wait,
  whatever until says, so a hold can never keep a server down longer than
  that. tests\test-5155-server-holds.ps1 writes holds with these functions and
  reads them with the watcher's own code, so the two cannot drift apart.

  WHO USES IT. Its text goes in front of what runs on the box, the way
  StopAndMove.ps1's does: Swap.ps1 puts it in front of both swap blocks
  (Deploy-Server, Deploy-DevGamemode, Deploy-Docs, Install-Voice,
  Install-Bot), and Restart-Server, Reset-Character, Deploy-Docs,
  Install-Bridge, Install-Voice, Install-Gate, Install-AdminService,
  Bot-Service (through Install-Bot), Setup-Domain, Wipe-Saves and Go send it
  with their own stops. Install-ThornswoodServer.ps1 runs on the box and
  carries a copy between marker lines; the test fails when the copy differs.
  vps-freeze.ps1 holds nothing: it turns the watchdog off for a move longer
  than any hold may be. A stop by hand in a run note uses Hold-Server.ps1,
  which sends it the same way.

  Each script writes its hold just before it stops the server and removes it
  once it has started it again (and, where the script waits for it, once it
  answers or the wait is over), or has given up and left it to the
  watchdog. A script that dies in between leaves the hold, and the watchdog
  starts the server when it runs out and says so in #staff-updates.

  Keep it ASCII. It runs on the box, in PowerShell 7.
#>

# The folder the watchdog lives in on the box. Holds go in holds\ under it.
$ThornswoodHoldRoot = 'C:\Thornswood-Watch'
# Minutes: what a hold is when nobody says, and the most it can be.
$ThornswoodHoldUsual = 30
$ThornswoodHoldMost = 120

# Where the hold for a task or service lives.
function Get-ThornswoodHoldFile {
    param([Parameter(Mandatory = $true)][string]$Target, [string]$Root = $ThornswoodHoldRoot)
    $name = ($Target -replace '[^A-Za-z0-9]+', '-').Trim('-')
    return (Join-Path (Join-Path $Root 'holds') ($name + '.json'))
}

# Writes the hold and says it in one line. $Target is the task or service
# name the watchdog knows it by ('Thornswood Server', 'ThornswoodBot'), $Why
# what the stop is for, $By who is stopping it, $Minutes how long, which is
# put between 1 and the most. With no watchdog folder there is no watchdog to
# hold back, and it says so and writes nothing.
function Set-ThornswoodHold {
    param(
        [Parameter(Mandatory = $true)][string]$Target,
        [Parameter(Mandatory = $true)][string]$Why,
        [string]$By = '',
        [int]$Minutes = $ThornswoodHoldUsual,
        [string]$Root = $ThornswoodHoldRoot
    )
    if (-not $Root -or -not (Test-Path -LiteralPath $Root -PathType Container)) {
        return ('no hold   ' + $Target + ': there is no ' + $Root + ', so no watchdog runs here to hold back')
    }
    if ($Minutes -lt 1) { $Minutes = 1 }
    if ($Minutes -gt $ThornswoodHoldMost) { $Minutes = $ThornswoodHoldMost }
    if (-not $By) { $By = '' + $env:USERNAME }
    $file = Get-ThornswoodHoldFile -Target $Target -Root $Root
    $dir = Split-Path -Parent $file
    $now = Get-Date
    $until = $now.AddMinutes($Minutes)
    try {
        if (-not (Test-Path -LiteralPath $dir)) { $null = New-Item -ItemType Directory -Path $dir -Force -ErrorAction Stop }
        $row = ConvertTo-Json @{
            target = $Target; by = $By; why = $Why
            set = ([DateTimeOffset]$now).ToUnixTimeSeconds(); until = ([DateTimeOffset]$until).ToUnixTimeSeconds()
        } -Compress
        # Written beside it and moved over it, so the watchdog never reads half a file.
        $tmp = $file + '.tmp'
        [IO.File]::WriteAllText($tmp, $row, (New-Object Text.UTF8Encoding($false)))
        Move-Item -LiteralPath $tmp -Destination $file -Force -ErrorAction Stop
    } catch {
        return ('NO HOLD   ' + $Target + ': ' + $file + ' could not be written (' + $_.Exception.Message + '), so the watchdog may start it again within five minutes')
    }
    return ('held      ' + $Target + ' until ' + $until.ToString('HH:mm', [Globalization.CultureInfo]::InvariantCulture) + ' box time (' + $Minutes + ' min), by ' + $By + ': ' + $Why)
}

# Takes the hold away and says so in one line. From then on the watchdog
# treats the server as it treats any other: not answering is started again.
function Clear-ThornswoodHold {
    param([Parameter(Mandatory = $true)][string]$Target, [string]$Root = $ThornswoodHoldRoot)
    if (-not $Root) { return ('no hold   ' + $Target + ' to take away') }
    $file = Get-ThornswoodHoldFile -Target $Target -Root $Root
    if (-not (Test-Path -LiteralPath $file)) { return ('no hold   ' + $Target + ' to take away') }
    try { Remove-Item -LiteralPath $file -Force -ErrorAction Stop }
    catch { return ('HOLD LEFT ' + $Target + ': ' + $file + ' could not be removed (' + $_.Exception.Message + '), so the watchdog leaves it alone until the hold runs out') }
    return ('released  ' + $Target + ', the watchdog watches it again')
}

# The holds there are, one line each, for a person or a script to read.
function Get-ThornswoodHolds {
    param([string]$Root = $ThornswoodHoldRoot)
    $dir = Join-Path $Root 'holds'
    $files = @(Get-ChildItem -LiteralPath $dir -Filter '*.json' -File -EA SilentlyContinue)
    if (-not $files.Count) { return 'holds     none' }
    foreach ($f in $files) {
        $j = $null
        try { $j = [IO.File]::ReadAllText($f.FullName) | ConvertFrom-Json }
        catch {
            # A file that does not read is a hold all the same: said on the next line.
            $j = $null
        }
        if (-not $j) { 'held      ' + $f.BaseName + ': the file does not read, so it holds for ' + $ThornswoodHoldUsual + ' min from ' + $f.LastWriteTime.ToString('HH:mm'); continue }
        $until = [DateTimeOffset]::FromUnixTimeSeconds([int64]$j.until).LocalDateTime
        $most = $f.LastWriteTime.AddMinutes($ThornswoodHoldMost)
        if ($until -gt $most) { $until = $most }
        'held      ' + $j.target + ' until ' + $until.ToString('HH:mm') + ' box time, by ' + $j.by + ': ' + $j.why
    }
}

# The text a script sends in front of what runs on the box: these functions
# and the three values, so the box needs nothing of its own. With -Script, a
# $HoldBy line too, naming that script and where it was started
# (Get-ThornswoodHoldBy), for the holds it writes.
function Get-ThornswoodHoldScript {
    param([string]$Script = '')
    $parts = @(
        ('$ThornswoodHoldRoot = ''' + $ThornswoodHoldRoot + ''''),
        ('$ThornswoodHoldUsual = ' + $ThornswoodHoldUsual),
        ('$ThornswoodHoldMost = ' + $ThornswoodHoldMost)
    )
    if ($Script) { $parts += ('$HoldBy = ''' + (Get-ThornswoodHoldBy -Script $Script).Replace("'", "''") + '''') }
    foreach ($n in 'Get-ThornswoodHoldFile', 'Set-ThornswoodHold', 'Clear-ThornswoodHold', 'Get-ThornswoodHolds') {
        $parts += ('function ' + $n + ' {' + (Get-Item ('function:' + $n)).ScriptBlock.ToString() + '}')
    }
    return (($parts -join "`r`n") + "`r`n")
}

# Who is stopping it, for the hold's by: the script and the machine it was
# started on, so staff reading the watchdog's message know who to ask.
function Get-ThornswoodHoldBy {
    param([Parameter(Mandatory = $true)][string]$Script)
    $who = '' + $env:USERNAME
    $where = '' + $env:COMPUTERNAME
    if (-not $where) { $where = '' + [Environment]::MachineName }
    if ($who) { return ($Script + ' (' + $who + ' on ' + $where + ')') }
    return ($Script + ' (on ' + $where + ')')
}
