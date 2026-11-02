<#
  test-roll-log.ps1

  Roll-Log.ps1, and every command line that runs it, driven for real in a temp
  folder. Entry 220: "Nothing rotates, so last night's crash is at the end of
  a file that grows forever."

  WHY THE COMMAND LINES ARE RUN AND NOT JUST READ. server.log and voice.log
  are written by cmd's >> from a scheduled task, and on Windows a file
  held that way cannot be renamed or truncated while the service runs. So the
  roll has to happen in front of the service, inside the same cmd line, and a
  quoting mistake in that line is a game server that does not start. Each line
  is lifted out of the installer that registers it, filled in with this
  machine's node and a temp folder, and handed to cmd.exe exactly as Task
  Scheduler hands it: the arguments string, verbatim, with a stand-in for the
  service that writes to stdout and stderr.

  What it proves:
    the roller: under 4 MB left alone, at 4 MB rolled, five kept and the
      oldest the only thing that goes, -Force, empty and missing files, and a
      file cmd still holds left exactly as it is, older ones included
    the game server's task line (Install-ThornswoodServer.ps1): since #2349
      it runs the server under server-log.js rather than this roller, and
      the line, run through cmd.exe, still rolls a full server.log at a start
      and writes both streams to a fresh one
    the voice task line (Install-Voice.ps1): since #2166 voice runs under
      server-log.js too, with --days 90 --stamp; the line still rolls a full
      voice.log at a start, stamps each line, and the environment it sets
      still reaches node
    the dev voice run file (vps-dev-instance.ps1): the same
    the bot: its service rolls bot.log itself (issue #465, BotService.cs,
      tests\test-bot-service.ps1), so Install-Bot sends no roller; the
      read-back of what the bot said still finds this start's lines after a
      roll made the file shorter
    the server installer keeps the logs across the folder it deletes, and
      both voice's installer and the server's send server-log.js

  Nothing here reaches the VPS or any service. Everything it writes is under
  its own temp folder.
#>
[CmdletBinding()]
param([string]$RepoPath)
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# The tests are in tests\, the repository is one folder up.
$Here = Split-Path -Parent $Here
if (-not $RepoPath) { $RepoPath = $Here }

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

$roller = Join-Path $RepoPath 'scripts\vps\Roll-Log.ps1'
. (Join-Path $PSScriptRoot 'Windows.ps1')
$boxPs  = Get-BoxPowerShell
# cmd.exe runs the task lines, as Task Scheduler does, and only Windows has it.
$cmdExe = $null
if ($OnWindows) { $cmdExe = Get-WindowsPath 'System32\cmd.exe' }
$node   = $null
$nc = Get-Command node -ErrorAction SilentlyContinue
if ($nc) { $node = $nc.Source }

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-rolllog-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

function Put([string]$path, [string]$text) { [IO.File]::WriteAllText($path, $text) }
function Get([string]$path) {
    if (Test-Path -LiteralPath $path) { return [IO.File]::ReadAllText($path) }
    return $null
}
function Fill([string]$path, [long]$bytes) {
    [IO.File]::WriteAllBytes($path, [Text.Encoding]::ASCII.GetBytes(('x' * $bytes)))
}
function Size([string]$path) {
    if (Test-Path -LiteralPath $path) { return (Get-Item -LiteralPath $path).Length }
    return -1
}
function Count([string]$text, [string]$what) {
    if ($null -eq $text) { return 0 }
    return ([regex]::Matches($text, [regex]::Escape($what))).Count
}

# The roller the way the task and run.ps1 run it: PowerShell 7, in a process
# of its own.
function Roll([string]$path, [string[]]$more) {
    $ErrorActionPreference = 'Continue'
    if (-not $more) { $more = @() }
    $out = & $boxPs -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $roller -Path $path @more 2>&1
    return [pscustomobject]@{ Code = $LASTEXITCODE; Out = ((@($out) | ForEach-Object { "$_" }) -join "`n") }
}

# cmd.exe with an arguments string passed through untouched, which is what a
# scheduled task's action does with its Arguments.
function RunCmd([string]$arguments, [string]$dir, [int]$waitMs = 60000) {
    $psi = New-Object Diagnostics.ProcessStartInfo
    $psi.FileName = $cmdExe
    $psi.Arguments = $arguments
    $psi.WorkingDirectory = $dir
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $p = [Diagnostics.Process]::Start($psi)
    if ($waitMs -gt 0) { [void]$p.WaitForExit($waitMs) }
    return $p
}

# Fills a format string lifted out of an installer, by the names of the
# variables it is given there, so the order they appear in does not matter.
function FillLine([string]$format, [string]$names, [hashtable]$values) {
    $vals = @()
    foreach ($n in ($names -split ',')) {
        $k = $n.Trim().Replace('`', '')
        if (-not $values.ContainsKey($k)) { return $null }
        $vals += $values[$k]
    }
    return ($format -f $vals)
}

function Get-BlockText([string]$text, [string]$start) {
    $at = $text.IndexOf($start)
    if ($at -lt 0) { return $null }
    $b = $text.IndexOf('{', $at)
    if ($b -lt 0) { return $null }
    $depth = 0
    for ($i = $b; $i -lt $text.Length; $i++) {
        $c = $text[$i]
        if ($c -eq '{') { $depth++ }
        elseif ($c -eq '}') { $depth--; if ($depth -eq 0) { return $text.Substring($at, $i - $at + 1) } }
    }
    return $null
}

try {
    # =================================================================== the roller
    Yes 'Roll-Log.ps1 is in tools' (Test-Path -LiteralPath $roller)
    if (-not (Test-Path -LiteralPath $roller)) { throw 'no roller, nothing else can be checked' }

    $d = Join-Path $tmp 'roller'
    New-Item -ItemType Directory -Force -Path $d | Out-Null
    $f = Join-Path $d 'x.log'

    Put $f 'small'
    $r = Roll $f
    Yes 'a small log is left alone' ((Get $f) -eq 'small' -and -not (Test-Path -LiteralPath ($f + '.1')))
    Yes 'and the roller exits 0' ($r.Code -eq 0)

    $r = Roll (Join-Path $d 'never-written.log')
    Yes 'a log that is not there is not an error' ($r.Code -eq 0 -and -not (Test-Path -LiteralPath (Join-Path $d 'never-written.log.1')))

    Put $f ''
    $r = Roll $f @('-Force')
    Yes 'an empty log is not worth a place, even forced' (-not (Test-Path -LiteralPath ($f + '.1')))

    Put $f 'forced'
    $r = Roll $f @('-Force')
    Yes '-Force rolls a small log' ((Get ($f + '.1')) -eq 'forced' -and -not (Test-Path -LiteralPath $f))
    Yes 'and says so' ($r.Out -match 'rolled x\.log')
    Remove-Item -LiteralPath ($f + '.1') -Force

    # The 4 MB the task relies on, since the task passes no size.
    Fill $f (4MB - 1)
    [void](Roll $f)
    Yes 'one byte under 4 MB is left alone' ((Size $f) -eq (4MB - 1) -and -not (Test-Path -LiteralPath ($f + '.1')))
    Fill $f 4MB
    [void](Roll $f)
    Yes 'at 4 MB it rolls to .1' ((Size ($f + '.1')) -eq 4MB -and -not (Test-Path -LiteralPath $f))
    Remove-Item -LiteralPath ($f + '.1') -Force

    # Five kept, the oldest the only thing that goes, nothing overwritten.
    $words = 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE'
    for ($i = 0; $i -lt 5; $i++) { Put ($f + '.' + ($i + 1)) $words[$i] }
    Put $f 'LIVE'
    [void](Roll $f @('-MaxBytes', '2'))
    Yes 'the live log becomes .1' ((Get ($f + '.1')) -eq 'LIVE')
    Yes 'what was .1 becomes .2' ((Get ($f + '.2')) -eq 'ONE')
    Yes 'what was .4 becomes .5' ((Get ($f + '.5')) -eq 'FOUR')
    Yes 'what was .5 is the only thing that goes' (-not (Test-Path -LiteralPath ($f + '.6')) -and
        -not (@(1, 2, 3, 4, 5) | Where-Object { (Get ($f + '.' + $_)) -eq 'FIVE' }))
    Yes 'the live log is out of the way for the service to start a fresh one' (-not (Test-Path -LiteralPath $f))

    # A log cmd is still holding, the whole reason this runs at start.
    if (-not $OnWindows) {
        Write-Host 'SKIP  a log cmd holds open: the holder is cmd.exe, and only Windows keeps a file it writes from being renamed'
    } else {
        $held = Join-Path $d 'held.log'
        Put ($held + '.1') 'OLDER'
        $holder = RunCmd ('/c "ping -n 30 127.0.0.1 >> "' + $held + '""') $d 0
        for ($i = 0; $i -lt 50 -and (Size $held) -le 0; $i++) { Start-Sleep -Milliseconds 100 }
        $r = Roll $held @('-Force')
        Yes 'a log cmd holds open is refused, and the roller says so' ($r.Code -eq 0 -and $r.Out -match 'held')
        Yes 'the held log is still where it was' ((Size $held) -gt 0)
        Yes 'and the older ones were not moved around it' ((Get ($held + '.1')) -eq 'OLDER' -and -not (Test-Path -LiteralPath ($held + '.2')))
        foreach ($c in @(Get-CimInstance Win32_Process -Filter ("ParentProcessId=" + $holder.Id) -ErrorAction SilentlyContinue)) {
            Stop-Process -Id $c.ProcessId -Force -ErrorAction SilentlyContinue
        }
        Stop-Process -Id $holder.Id -Force -ErrorAction SilentlyContinue
        [void]$holder.WaitForExit(10000)
        Start-Sleep -Milliseconds 300
        $r = Roll $held @('-Force')
        Yes 'once the holder is gone it rolls' ((Size ($held + '.1')) -gt 0 -and (Get ($held + '.1')) -ne 'OLDER' -and (Get ($held + '.2')) -eq 'OLDER')
    }

    # ======================================================= the game server task
    # Since #2349 the server runs under server-log.js, which writes server.log
    # itself and rolls it at midnight and at 4 MB; Roll-Log.ps1 is voice's
    # only now. The line is still run through cmd.exe exactly as Task
    # Scheduler runs it, because a quoting mistake there is a server that
    # does not start. tests\test-2349-server-log.js proves the 30 days.
    $inst = Get-Content -LiteralPath (Join-Path $RepoPath 'scripts\deploy\Install-ThornswoodServer.ps1') -Raw
    $m = [regex]::Match($inst, '\$cmd = \(''(/c [^\r\n]*?skymp5-server\.js[^\r\n]*?)'' -f ([^\r\n]+)\)')
    Yes 'the server task line is in Install-ThornswoodServer.ps1' $m.Success
    $writerSrc = Join-Path $RepoPath 'scripts\vps\Server-Log.js'

    if (-not $node) {
        Write-Host 'SKIP  node is not on this machine, so the task lines cannot be run'
    } elseif (-not $OnWindows) {
        Write-Host 'SKIP  the server line: it runs through cmd.exe as Task Scheduler runs it, and only Windows has cmd.exe'
    } elseif ($m.Success) {
        $srv = Join-Path $tmp 'server'
        New-Item -ItemType Directory -Force -Path (Join-Path $srv 'dist_back') | Out-Null
        Put (Join-Path $srv 'dist_back\skymp5-server.js') ("console.log('stand-in server up');`nconsole.error('stand-in server on stderr');`n")
        Copy-Item -LiteralPath $writerSrc -Destination (Join-Path $srv 'server-log.js')
        $log = Join-Path $srv 'server.log'
        $line = FillLine $m.Groups[1].Value $m.Groups[2].Value @{
            '$node.Source' = $node; '$log' = $log; '$writer' = (Join-Path $srv 'server-log.js')
        }
        Yes 'the harness knows every value the installer puts in the server line' ($null -ne $line)
        if ($line) {
            Fill $log (4MB + 100)
            $p = RunCmd $line $srv
            Yes 'the server line runs to the end' $p.HasExited
            $rolled = @(Get-ChildItem -LiteralPath $srv -Filter 'server.log.*' | Where-Object { $_.Name -match '^server\.log\.\d+$' })
            Yes 'a server.log past 4 MB is rolled before the server starts' ($rolled.Count -eq 1 -and $rolled[0].Length -eq (4MB + 100))
            $t = Get $log
            Yes 'the server writes its stdout to a fresh server.log' ((Count $t 'stand-in server up') -eq 1 -and (Size $log) -lt 4096)
            Yes 'and its stderr' ((Count $t 'stand-in server on stderr') -eq 1)

            [void](RunCmd $line $srv)
            Yes 'the next start appends, under 4 MB' ((Count (Get $log) 'stand-in server up') -eq 2 -and
                @(Get-ChildItem -LiteralPath $srv -Filter 'server.log.*' | Where-Object { $_.Name -match '^server\.log\.\d+$' }).Count -eq 1)
        }
    }

    # ============================================================ the voice task
    $vtext = Get-Content -LiteralPath (Join-Path $RepoPath 'scripts\deploy\Install-Voice.ps1') -Raw
    $m = [regex]::Match($vtext, '`\$cmd = \(''(/c "set THORNSWOOD_SITE=[^\r\n]*?)'' -f ([^\r\n]+)\)')
    Yes 'the voice task line is in Install-Voice.ps1' $m.Success
    if (-not $OnWindows) {
        Write-Host 'SKIP  the voice line: it runs through cmd.exe as Task Scheduler runs it, and only Windows has cmd.exe'
    } elseif ($node -and $m.Success) {
        $vr = Join-Path $tmp 'voice'
        New-Item -ItemType Directory -Force -Path $vr | Out-Null
        Put (Join-Path $vr 'voice-server.js') ("console.log('stand-in voice up on ' + process.env.THORNSWOOD_VOICE_PORT + ' auth ' + process.env.THORNSWOOD_VOICE_AUTH);`n")
        # Since #2166 voice runs under server-log.js, as the server does, so
        # voice.log is aged; tests\test-2349-server-log.js proves the days.
        Copy-Item -LiteralPath $writerSrc -Destination (Join-Path $vr 'server-log.js')
        $vlog = Join-Path $vr 'voice.log'
        # What the outer here-string fills in at install time. $turnSet is the
        # relay line, empty with no relay, which is every box today;
        # tests\test-voice-turn-url.ps1 runs this line with one. $mostSet is
        # the voice number (#481), read with one by tests\test-481-voice-most.ps1.
        $fmt = $m.Groups[1].Value.Replace('$Site', 'https://site.invalid').Replace('$Port', '7999').Replace('$Bind', '127.0.0.1').Replace('$ChatRange', 'off').Replace('$mostSet', '').Replace('$turnSet', '')
        $line = FillLine $fmt $m.Groups[2].Value @{
            '$node.Source' = $node; '$log' = $vlog; '$writer' = (Join-Path $vr 'server-log.js')
        }
        Yes 'the harness knows every value the installer puts in the voice line' ($null -ne $line)
        if ($line) {
            Fill $vlog (4MB + 7)
            $p = RunCmd $line $vr
            $vrolled = @(Get-ChildItem -LiteralPath $vr -Filter 'voice.log.*' | Where-Object { $_.Name -match '^voice\.log\.\d+$' })
            Yes 'a voice.log past 4 MB is rolled before voice starts' ($vrolled.Count -eq 1 -and $vrolled[0].Length -eq (4MB + 7))
            Yes 'each line voice writes is stamped, so it can be aged (#2166)' ((Get $vlog) -match '(?m)^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}\] stand-in voice up on 7999 auth on')
            # Auth is on, written into the line since #1303 took -Auth away.
            Yes 'voice is still writing to voice.log afterwards, with its settings' ((Count (Get $vlog) 'stand-in voice up on 7999 auth on') -eq 1)
            Yes 'the command line still names the log, which is how the installer finds its own process' ($line -like ('*' + $vlog + '*'))
        }
    }
    Yes 'Install-Voice sends the log writer up beside the service' ($vtext -match 'Join-Path \$Here ''\.\.\\vps\\Server-Log\.js''' -and $vtext.Contains("`$send['server-log.js']"))
    Yes 'Install-Voice rolls voice.log at install rather than deleting it, keeping 90 days' (
        $vtext -notmatch 'Remove-Item -LiteralPath `\$log\b' -and $vtext -match '& `\$node\.Source `\$writer --log `\$log --days 90 --roll')

    # ============================================================ the dev voice
    $dtext = Get-Content -LiteralPath (Join-Path $RepoPath 'scripts\vps\vps-dev-instance.ps1') -Raw
    $lb = $dtext.IndexOf('$lines = @(')
    $le = if ($lb -ge 0) { $dtext.IndexOf("`n    )", $lb) } else { -1 }
    Yes 'the dev voice run file is in vps-dev-instance.ps1' ($lb -ge 0 -and $le -gt $lb)
    if (-not $OnWindows) {
        Write-Host 'SKIP  the dev voice run file: it is a cmd file, and only Windows has cmd.exe'
    } elseif ($node -and $lb -ge 0 -and $le -gt $lb) {
        $devVoice = Join-Path $tmp 'devvoice'
        $devVoicePort = 7989
        $psExe = $boxPs
        New-Item -ItemType Directory -Force -Path $devVoice | Out-Null
        Put (Join-Path $devVoice 'voice-server.js') ("console.log('stand-in dev voice up on ' + process.env.THORNSWOOD_VOICE_PORT);`n")
        Copy-Item -LiteralPath $writerSrc -Destination (Join-Path $devVoice 'server-log.js')
        $lines = $null
        . ([scriptblock]::Create($dtext.Substring($lb, $le - $lb + 6)))
        $run = Join-Path $devVoice 'run-dev-voice.cmd'
        [IO.File]::WriteAllLines($run, [string[]]$lines, (New-Object Text.ASCIIEncoding))
        $dlog = Join-Path $devVoice 'voice.log'
        Fill $dlog (4MB + 3)
        # The task's own argument, lifted from the script and run the way the
        # task runs it, so a path with an & in it (the temp folder here may be
        # under C:\ThornswoodTemps&Worktrees) is proved to hold (#1042, #1115).
        $ta = [regex]::Match($dtext, '\$taskArg = \((''/c [^'']*'') -f \$run\)')
        Yes 'the dev voice task line is in vps-dev-instance.ps1' $ta.Success
        $taskArg = if ($ta.Success) { ($ta.Groups[1].Value.Trim("'") -f $run) } else { '/c "' + $run + '"' }
        [void](RunCmd $taskArg $devVoice)
        $drolled = @(Get-ChildItem -LiteralPath $devVoice -Filter 'voice.log.*' | Where-Object { $_.Name -match '^voice\.log\.\d+$' })
        Yes 'the dev voice run file rolls voice.log before node' ($drolled.Count -eq 1 -and $drolled[0].Length -eq (4MB + 3))
        Yes 'and dev voice writes to a fresh one' ((Count (Get $dlog) 'stand-in dev voice up on 7989') -eq 1)
    }
    # Every copy, the server's and voice's (program and page since #1083).
    $copies = ([regex]::Matches($dtext, '& robocopy [^\r\n]*')).Count
    Yes 'the dev copies leave the rolled logs of live behind' (
        $copies -ge 2 -and ([regex]::Matches($dtext, '& robocopy [^\r\n]*/XF [^\r\n]*\*\.log\.\*')).Count -eq $copies)

    # ================================================================== the bot
    $btext = Get-Content -LiteralPath (Join-Path $RepoPath 'scripts\deploy\Install-Bot.ps1') -Raw
    # The bot is a Windows service since #465 and its program rolls bot.log
    # by size while it runs, which tests\test-bot-service.ps1 drives. So there
    # is no run.ps1 loop to roll it and no roller to send.
    Yes 'Install-Bot writes no run.ps1 loop and sends no roller for the bot any more' (
        $btext -notmatch '\$run = @''' -and $btext -notmatch '/roll-log\.ps1"')

    # What the bot said on the way up is read from a byte count taken before
    # the start. A roll makes the file shorter than that count, and without
    # allowing for it the installer reads nothing and says the bot has not
    # finished starting.
    $fresh = Get-BlockText $btext 'function Fresh {'
    Yes 'Fresh is in Install-Bot.ps1' ($null -ne $fresh)
    if ($fresh) {
        . ([scriptblock]::Create($fresh.Replace('`$', '$')))
        $log = Join-Path $tmp 'fresh.log'
        # Long, because a log only rolls at 4 MB, so whatever the new start
        # has written is always far shorter than the count taken before it.
        Put $log ((('old line ' + ('x' * 200)) + "`r`n") * 2)
        $before = (Get-Item -LiteralPath $log).Length
        [IO.File]::AppendAllText($log, "[thornswood-bot] watching 1 server`r`n")
        $got = @(Fresh) -join '|'
        Yes 'Fresh reads only what this start wrote' ($got -match 'watching 1 server' -and $got -notmatch 'old line')
        Put $log "[thornswood-bot] fresh after a roll`r`n"
        $got = @(Fresh) -join '|'
        Yes 'and all of a file a roll made shorter' ($got -match 'fresh after a roll')
    }
    Yes 'the code only restart reads a rolled bot.log from the start too' (
        ([regex]::Matches($btext, [regex]::Escape('if (`$fs.Length -lt `$from) { `$from = 0 }'))).Count -eq 2)

    # ===================================================== the server installer
    # Since #2349 the installer sends and copies Server-Log.js for the server,
    # not this roller (tests\test-2349-server-log.js).
    Yes 'Publish-Server sends the log writer beside the installer, not the roller' (
        (Get-Content -LiteralPath (Join-Path $RepoPath 'scripts\release\Publish-Server.ps1') -Raw) -match 'scp (@ssh )?\$serverLog "\$\{target\}:C:/Server-Log\.js"')
    Yes 'the installer no longer copies or runs Roll-Log.ps1 for the server' (
        $inst.IndexOf("Join-Path `$here 'Roll-Log.ps1'") -lt 0 -and $inst -notmatch '& \$roller ')
    Yes 'the installer rolls server.log at install rather than deleting it, and ages thornswood.log with it (#2166)' (
        $inst -notmatch 'Remove-Item -LiteralPath \$log\b' -and $inst -match '& \$node\.Source \$writer --log \$log --also \$gm --roll')

    # The folder every publish deleted held both logs. Since issue #446 the
    # old folder is not deleted: it is renamed aside and Carry moves the logs
    # into the new one. Run the real Carry against two temp roots.
    $carry = Get-BlockText $inst 'function Carry('
    $move  = Get-BlockText $inst 'function MoveDir('
    $say   = Get-BlockText $inst 'function Say('
    Yes 'the installer carries the logs from the old folder to the new one' (
        $null -ne $carry -and $null -ne $move -and $null -ne $say -and $carry.Contains('.log(') -and $carry.Contains('Move-Item'))
    if ($carry -and $move -and $say) {
        $old = Join-Path $tmp 'srvroot.prev-test'
        $Root = Join-Path $tmp 'srvroot'
        New-Item -ItemType Directory -Force -Path (Join-Path $old 'dist_back'), $Root | Out-Null
        Put (Join-Path $old 'server.log') 'LIVE LOG'
        Put (Join-Path $old 'server.log.1') 'OLDER LOG'
        Put (Join-Path $old 'thornswood.log') 'OURS'
        Put (Join-Path $old 'thornswood.log.3') 'OURS OLDER'
        Put (Join-Path $old 'dist_back\skymp5-server.js') 'program'
        Put (Join-Path $Root 'server-settings.json') '{}'
        . ([scriptblock]::Create($say + "`n" + $move + "`n" + $carry))
        Carry $old $Root $false 6>$null
        Yes 'the logs are beside the new server' (
            (Get (Join-Path $Root 'server.log')) -eq 'LIVE LOG' -and
            (Get (Join-Path $Root 'server.log.1')) -eq 'OLDER LOG' -and
            (Get (Join-Path $Root 'thornswood.log')) -eq 'OURS' -and
            (Get (Join-Path $Root 'thornswood.log.3')) -eq 'OURS OLDER')
        Yes 'and no program file went with them' (-not (Test-Path -LiteralPath (Join-Path $Root 'dist_back')))
        Yes 'and the old folder is kept, its program still in it, not deleted' (
            (Get (Join-Path $old 'dist_back\skymp5-server.js')) -eq 'program' -and
            -not (Test-Path -LiteralPath (Join-Path $old 'server.log')))
    }
}
catch {
    $script:fail++
    Write-Host ("FAIL  the harness stopped: {0}" -f $_.Exception.Message)
}
finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
