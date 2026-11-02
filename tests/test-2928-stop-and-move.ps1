<#
  test-2928-stop-and-move.ps1

      pwsh -NoProfile -File .\tests\test-2928-stop-and-move.ps1

  Issue #2928. Every swap on the box stopped what was running and then
  renamed its files in a loop with a sleep between tries (Swap.ps1's Shift,
  ten tries 0.5 s apart; Install-ThornswoodServer.ps1's MoveDir, ten 0.7 s
  apart; the bot's service program, ten a second apart), after waiting for a
  port to close, and two seconds more for the game servers. Measured on the
  box on 20 Oct: a folder whose file a just-ended node held was refused 15
  times in 15 when renamed at once, and 0 in 15 once that node had exited.
  Stop-Process returns before the process has exited, and its files stay open
  until it has. Since #2928 scripts\deploy\StopAndMove.ps1 opens each process
  before anything is asked to stop, ends it, waits until it has exited, and
  tries each rename once, saying why when Windows refuses it. This proves:

    1. StopAndMove.ps1 is plain ASCII, parses, and holds no sleep or retry.
    2. Every script that stopped and renamed through a loop now goes through
       it: Swap.ps1 puts it in front of both swap blocks and has no Shift or
       Move of its own; the server installer carries an exact copy and its
       MoveDir and StopServer have no sleep; Bot-Service.ps1 replaces the
       service program once; Install-Bot sends it in front of Bot-Service.ps1
       every time; the site's, voice's and the bridge's StopIt wait on it and
       sleep nowhere; voice's -Restart and -Remove stop through that StopIt
       and start or take away nothing until it has all exited (#2952).
    3. On Windows, run for real ten times: a node holding a file in a folder
       is ended, waited for, and the folder renamed at once, every time.
    4. A rename Windows refuses is tried once, returns false, and says the
       Windows error and the process holding the file (this one); a folder
       another process has as its current directory, which the Restart
       Manager cannot see, is named by the handle list (#3131), and before
       that by Windows's own list of who has the folder open, with its
       parent and start time (#3262); a file another process holds is
       named by Windows's list for each file, which took the Restart
       Manager's place (#3274: its one lock for the whole box was not had in
       time with two builds on it). A folder's refusal says whether the
       folder itself would not open to be renamed (error 32, a handle on it
       without delete sharing) or it opened and the rename was refused
       (error 5, a file under it open) (#3262).
    5. This process, and an id with nothing running, are never opened.

  It also prints, without failing on it, how many of ten folders were refused
  when renamed the moment Stop-Process returned: the old way, measured on
  whatever machine runs this.

  Read only apart from files under its own temp folder, and the node
  processes it starts and ends there.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent $Here

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}
function P([string[]]$parts) { $p = $Repo; foreach ($x in $parts) { $p = Join-Path $p $x }; return $p }
function Text([string]$path) { return [IO.File]::ReadAllText($path).Replace("`r`n", "`n") }
# A function's whole text out of a script, found by the parser.
function FunctionText([string]$code, [string]$name) {
    $e = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseInput($code, [ref]$null, [ref]$e)
    $f = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name }, $true))
    if ($f.Count -ne 1) { return '' }
    return $f[0].Extent.Text
}

# ---- 1. the helper ----------------------------------------------------------
$libPath = P 'scripts', 'deploy', 'StopAndMove.ps1'
Yes 'scripts\deploy\StopAndMove.ps1 is there' (Test-Path -LiteralPath $libPath)
if (-not (Test-Path -LiteralPath $libPath)) { Done }
$lib = Text $libPath
$e = $null
[void][System.Management.Automation.Language.Parser]::ParseInput($lib, [ref]$null, [ref]$e)
Yes 'it parses, and is plain ASCII' (@($e).Count -eq 0 -and $lib -notmatch '[^\x00-\x7F]')
Yes 'it has no sleep, and no loop that tries a rename again' ($lib -notmatch 'Start-Sleep|Thread\]::Sleep' -and $lib -notmatch 'for \(\$i')
foreach ($fn in 'Get-ThornswoodProcessHeld', 'Stop-ThornswoodProcessHeld', 'Get-ThornswoodPathHolders', 'Get-ThornswoodPathOpeners', 'Get-ThornswoodProcessWords', 'Get-ThornswoodFileHolders', 'Get-ThornswoodPathHandles', 'Move-ThornswoodPath') {
    Yes "  and defines $fn" ([bool](FunctionText $lib $fn))
}
Yes 'each process is opened before it is ended, and waited for by its own handle' (
    (FunctionText $lib 'Get-ThornswoodProcessHeld') -match '\$null = \$p\.Handle' -and
    (FunctionText $lib 'Stop-ThornswoodProcessHeld') -match '\$p\.Kill\(\)' -and
    (FunctionText $lib 'Stop-ThornswoodProcessHeld') -match '\$p\.WaitForExit\(\$left\)')
Yes 'a refusal says who has each file under the path open and every handle under it, folders and current directories too (#3131)' (
    (FunctionText $lib 'Get-ThornswoodPathHolders') -match 'Get-ThornswoodFileHolders \$Path' -and
    (FunctionText $lib 'Get-ThornswoodPathHolders') -match 'Get-ThornswoodPathHandles \$Path' -and
    (FunctionText $lib 'Get-ThornswoodPathHandles') -match '\[ThornswoodHandles\]::Under\(' -and
    $lib -match 'NtQuerySystemInformation\(64' -and $lib -match 't\.Join\(20000\)')
# #3262: the Restart Manager took 41 s over the dev server's 12,424 files and
# was asked first, so a holder that had exited by then was named by nothing.
$holders = FunctionText $lib 'Get-ThornswoodPathHolders'
Yes 'a refusal keeps each process''s line under its id and never reads an id back out of a line, which a command line with a line break broke (#3214)' (
    $holders -match '\$who\[\$id\] = \$line' -and $holders -notmatch "-replace '\^pid")
$iOpen = $holders.IndexOf('Get-ThornswoodPathOpeners $Path')
$iHandles = $holders.IndexOf('Get-ThornswoodPathHandles $Path')
$iCim = $holders.IndexOf('Get-CimInstance Win32_Process')
$iRm = $holders.IndexOf('Get-ThornswoodFileHolders $Path')
Yes 'a refusal asks quickest first: who has the path itself open with every running process, then the handles, then command lines, each file under it last (#3262)' (
    $iOpen -ge 0 -and $iOpen -lt $iHandles -and $iHandles -lt $iCim -and $iCim -lt $iRm)
Yes 'the Restart Manager is asked nothing any more: its one lock for the whole box was not had in time with two builds on it (#3274)' (
    $lib -notmatch 'rstrtmgr|RmStartSession' -and (FunctionText $lib 'Get-ThornswoodFileHolders') -match '\[ThornswoodOpeners\]::OfFiles\(')
Yes '  and the first look is Windows''s own list of who has the path open, beside a list of every process, both in one call' (
    (FunctionText $lib 'Get-ThornswoodPathOpeners') -match '\[ThornswoodOpeners\]::Of\(' -and
    (FunctionText $lib 'Get-ThornswoodPathOpeners') -match '\[ThornswoodOpeners\]::Running\(\)' -and
    $lib -match 'NtQueryInformationFile\(h, out io, buf, len, 47\)' -and $lib -match 'NtQuerySystemInformation\(5,')
$move = FunctionText $lib 'Move-ThornswoodPath'
Yes 'a move is tried once and says why when it is refused' (
    ([regex]::Matches($move, '\[IO\.File\]::Move\(')).Count -eq 1 -and ([regex]::Matches($move, '\[IO\.Directory\]::Move\(')).Count -eq 1 -and
    ([regex]::Matches($move, '\[ThornswoodRename\]::Move\(')).Count -eq 1 -and
    ([regex]::Matches($move, '\$script:ThornswoodMoveWhy = \(')).Count -eq 2 -and ([regex]::Matches($move, 'Get-ThornswoodPathHolders \$From')).Count -eq 2)
Yes '  a folder is opened for the rename and renamed through that handle, so a refusal says which half it was (#3262)' (
    $move -match "\`$step -eq 'open'" -and
    $lib -match 'NtSetInformationFile\(h, out io, buf, len, 10\)')
# #3262: compiled after the refusal, the looks saw the folder seconds late.
$top = [regex]::Match($lib, '(?m)^\$ThornswoodTypesWhy = Use-ThornswoodTypes\r?$')
Yes '  and the C# its looks need is compiled when the text is loaded, never after a stop or a refusal (#3262)' (
    $top.Success -and $move -notmatch 'Use-ThornswoodTypes|Add-Type' -and
    ([regex]::Matches($lib, 'Add-Type -TypeDefinition')).Count -eq 1 -and (FunctionText $lib 'Use-ThornswoodTypes') -match 'Add-Type -TypeDefinition \$ThornswoodTypesCs')

# ---- 2. everything goes through it -----------------------------------------
$swap = Text (P 'scripts', 'deploy', 'Swap.ps1')
Yes 'Swap.ps1 puts it in front of the swap and of the service swap' (
    $swap.Contains("`$ThornswoodStopAndMoveText = [IO.File]::ReadAllText((Join-Path `$PSScriptRoot 'StopAndMove.ps1'))") -and
    $swap.Contains('$swapBlock = $ThornswoodStopAndMoveText + $swapBlock') -and
    $swap.Contains('$serviceSwapBlock = $ThornswoodStopAndMoveText + $serviceSwapBlock'))
Yes '  and has no Shift and no rename of its own any more' ($swap -notmatch 'function Shift|\bShift \$|::Move\(')
$a = $swap.IndexOf('# ==== deploy-server remote blocks ====')
$b = $swap.IndexOf('# ==== end deploy-server remote blocks ====')
$stopOurs = ''
if ($a -ge 0 -and $b -gt $a) { $stopOurs = [regex]::Match($swap.Substring($a, $b - $a), '(?ms)^function StopOurs \{.*?^\}$').Value }
Yes 'the game server stop opens what holds its port, stops the task, and waits for it to exit, with no sleep' (
    $stopOurs -and $stopOurs -notmatch 'Start-Sleep' -and
    $stopOurs.IndexOf('Get-ThornswoodProcessHeld') -ge 0 -and
    $stopOurs.IndexOf('Get-ThornswoodProcessHeld') -lt $stopOurs.IndexOf('Stop-ScheduledTask') -and
    $stopOurs.IndexOf('Stop-ScheduledTask') -lt $stopOurs.IndexOf('Stop-ThornswoodProcessHeld'))
Yes '  and a stop that left one running swaps nothing' ($swap.Contains("`$notGone = @(`$ThornswoodStillRunning) + @(`$ThornswoodNotHeld)"))
Yes 'the service swap moves nothing while what StopIt ended is still running' (
    $swap.Contains("if (@(`$ThornswoodStillRunning).Count -or @(`$ThornswoodNotHeld).Count) {"))

$inst = Text (P 'scripts', 'deploy', 'Install-ThornswoodServer.ps1')
$m = [regex]::Match($inst, '(?s)# ---- StopAndMove\.ps1 \(copy\) ----\n(.*?)# ---- end StopAndMove\.ps1 ----')
$body = $lib.Substring($lib.IndexOf("#>`n") + 3)
Yes 'the server installer carries an exact copy of StopAndMove.ps1 below its header' ($m.Success -and $m.Groups[1].Value -eq $body)
$moveDir = FunctionText $inst 'MoveDir'
$stopServer = FunctionText $inst 'StopServer'
Yes '  its folder rename is tried once' ($moveDir -match 'Move-ThornswoodPath \$from \$to' -and $moveDir -notmatch 'Start-Sleep|for \(')
Yes '  and its stop opens the server''s processes before the task stops and waits for them, with no sleep' (
    $stopServer -notmatch 'Start-Sleep' -and
    $stopServer.IndexOf('Get-ThornswoodProcessHeld') -ge 0 -and
    $stopServer.IndexOf('Get-ThornswoodProcessHeld') -lt $stopServer.IndexOf('Stop-ScheduledTask') -and
    $stopServer.IndexOf('Stop-ThornswoodProcessHeld') -gt $stopServer.IndexOf('Stop-ScheduledTask'))

# Windows's own record of who opened the folder (#5211): started before the
# stage, stopped right after the move, read only when the move was refused
# and only once the old server is starting again, and stopped on every way
# out. It only records: it stops, moves and retries nothing.
$finish = FunctionText $inst 'Finish'
$swapAt = $inst.IndexOf("Say 'stopping the server' 'Cyan'`n    StopServer `$Root`n    `$movedAside")
Yes 'the installer records Windows''s open trace from before the stage to just after the move' (
    $inst.IndexOf("Start-ThornswoodOpenTrace ('thornswood-install-' + `$PID)") -gt 0 -and
    $inst.IndexOf("Start-ThornswoodOpenTrace ('thornswood-install-' + `$PID)") -lt $inst.IndexOf('# ---- the stage: nothing running is touched') -and
    $swapAt -gt 0 -and $inst.IndexOf('Stop-ThornswoodOpenTrace $script:openTrace', $swapAt) -gt $inst.IndexOf('$movedAside = MoveDir $Root $aside', $swapAt))
$refused = $inst.Substring($swapAt, $inst.IndexOf("Finish 'INSTALL REFUSED' 1", $swapAt) - $swapAt)
Yes '  reads it only when the move was refused, after the old server is started again' (
    $refused.IndexOf('Read-ThornswoodOpenTrace $script:openTrace $Root') -gt $refused.IndexOf('Start-ScheduledTask -TaskName $TaskName'))
Yes '  and Finish stops it and removes its file on every way out' ($finish.Contains('Remove-ThornswoodOpenTrace $script:openTrace'))
$traceText = $lib.Substring($lib.IndexOf('# ---- who opened a folder itself'))
Yes '  the trace is opens and process starts and ends, and it neither sleeps, retries, stops nor moves anything' (
    $traceText.Contains('"Microsoft-Windows-Kernel-File" 0x80 0x5') -and $traceText.Contains('"Microsoft-Windows-Kernel-Process" 0x10 0x5') -and
    (($traceText -split "`n" | Where-Object { $_ -notmatch '^\s*#' }) -join "`n") -cnotmatch 'Start-Sleep|Stop-Process|\.Kill\(|Move-ThornswoodPath|ThornswoodRename|Move-Item|while \(')

$bot = Text (P 'scripts', 'vps', 'Bot-Service.ps1')
$installBot = FunctionText $bot 'Install-ThornswoodBotService'
Yes 'the bot''s service program is replaced once, after the service has exited, with no sleep' (
    $installBot -and $installBot -notmatch 'Start-Sleep|foreach \(\$i in 1\.\.10\)' -and
    $installBot.IndexOf('Stop-ThornswoodBotService $Name') -ge 0 -and
    $installBot.IndexOf('Stop-ThornswoodBotService $Name') -lt $installBot.IndexOf('Move-Item -LiteralPath $new -Destination $exe'))
$svcStop = FunctionText $bot 'Stop-ThornswoodBotService'
Yes '  its process and the python it ran are opened before Stop-Service, and waited for after' (
    $svcStop.IndexOf('Get-ThornswoodProcessHeld') -ge 0 -and
    $svcStop.IndexOf('Get-ThornswoodProcessHeld') -lt $svcStop.IndexOf('Stop-Service') -and
    $svcStop.IndexOf('Stop-ThornswoodProcessHeld') -gt $svcStop.IndexOf('Stop-Service') -and $svcStop -match 'ParentProcessId=')
Yes '  and so are the strays' ((FunctionText $bot 'Stop-ThornswoodBotStrays') -match 'Stop-ThornswoodProcessHeld \$held' -and (FunctionText $bot 'Stop-ThornswoodBotStrays') -notmatch 'Stop-Process')
$ib = Text (P 'scripts', 'deploy', 'Install-Bot.ps1')
$sends = [regex]::Matches($ib, '\(Get-Content -LiteralPath \$svcLib -Raw\)').Count
Yes 'Install-Bot sends StopAndMove.ps1 in front of Bot-Service.ps1 every time it sends it' (
    $sends -ge 3 -and [regex]::Matches($ib, '\$ThornswoodStopAndMoveText \+ \(Get-Content -LiteralPath \$svcLib -Raw\)').Count -eq $sends)

foreach ($c in @(
        @{ Name = 'the site'; Path = @('scripts', 'deploy', 'Deploy-Docs.ps1') },
        @{ Name = 'voice'; Path = @('scripts', 'deploy', 'Install-Voice.ps1') },
        @{ Name = 'the bridge'; Path = @('scripts', 'deploy', 'Install-Bridge.ps1') },
        @{ Name = 'the admin service'; Path = @('scripts', 'deploy', 'Install-AdminService.ps1') })) {
    $t = Text (P $c.Path)
    $s = [regex]::Match($t, '(?ms)^function StopIt \{.*?^\}$').Value
    $plain = $s.Replace('`', '')
    Yes ($c.Name + '''s StopIt opens what it stops before the task stops, waits for it to exit, and sleeps nowhere') (
        $s -and $plain -notmatch 'Start-Sleep|Stop-Process' -and
        $plain.IndexOf('Get-ThornswoodProcessHeld') -ge 0 -and
        $plain.IndexOf('Get-ThornswoodProcessHeld') -lt $plain.IndexOf('Stop-ScheduledTask') -and
        $plain.IndexOf('Stop-ThornswoodProcessHeld') -gt $plain.IndexOf('Stop-ScheduledTask'))
}
$voice = Text (P 'scripts', 'deploy', 'Install-Voice.ps1')
Yes 'voice''s install sends its StopIt in front of the swap, which carries StopAndMove.ps1' ($voice.Contains('Remote (@($vars, $voiceTools, $remote, $serviceSwapBlock) -join "`r`n")'))
Yes 'voice''s -TaskOnly run sends StopAndMove.ps1 in front of its StopIt too' ($voice.Contains('Remote (@($vars, $ThornswoodStopAndMoveText, $voiceTools, $remote, $taskOnlyBlock) -join "`r`n")'))
# Issue #2952: -Restart was Stop-ScheduledTask, a second's sleep and
# Start-ScheduledTask, and -Remove took the folder away the same instant.
# Stop-ScheduledTask returns before voice has exited (measured on dev voice,
# 21 Oct: 63 ms, all four processes still running and node on the port).
Yes 'voice''s -Restart and -Remove send StopAndMove.ps1 in front of its StopIt' (
    $voice.Contains('Remote (@($vars, $ThornswoodStopAndMoveText, $voiceTools, $restartBlock) -join "`r`n")') -and
    $voice.Contains('Remote (@($vars, $ThornswoodStopAndMoveText, $voiceTools, $removeBlock) -join "`r`n")'))
foreach ($b in @(@{ Name = '-Restart'; Var = 'restartBlock'; Then = 'StartIt' }, @{ Name = '-Remove'; Var = 'removeBlock'; Then = 'Unregister-ScheduledTask' })) {
    $s = [regex]::Match($voice, '(?ms)^\$' + $b.Var + ' = @"\r?\n(.*?)^"@').Groups[1].Value.Replace('`', '')
    Yes ('voice''s ' + $b.Name + ' stops through StopIt, starts or takes away nothing until StoppedAll says it has all exited, and sleeps nowhere') (
        $s -and $s -notmatch 'Start-Sleep|Stop-ScheduledTask|Stop-Process' -and
        $s.IndexOf('StopIt') -ge 0 -and $s.IndexOf('StopIt') -lt $s.IndexOf('StoppedAll') -and
        $s.IndexOf('StoppedAll') -lt $s.IndexOf($b.Then))
}
Yes 'and neither is the one ssh line it was' ($voice -notmatch 'Start-Sleep -Seconds 1; Start-ScheduledTask' -and $voice -notmatch "Remove-Item -LiteralPath '\$Root' -Recurse -Force -EA SilentlyContinue")

# ---- 3 to 5. run ------------------------------------------------------------
. (Join-Path $PSScriptRoot 'Windows.ps1')
$node = Get-Command node -CommandType Application -EA SilentlyContinue | Select-Object -First 1
if (-not $OnWindows -or -not $node) {
    Write-Host ('SKIP  the runs: they need Windows and node, and this is ' + $(if ($OnWindows) { 'Windows with no node' } else { 'not Windows' }))
    Done
}

. $libPath
$work = Join-Path ([IO.Path]::GetTempPath()) ('ts-2928-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Path $work
$started = @()
try {
    $js = Join-Path $work 'hold.js'
    [IO.File]::WriteAllText($js, "const fs=require('fs');const fd=fs.openSync(process.argv[2],'a');setInterval(()=>fs.writeSync(fd,'line '+Date.now()+' '+Math.random()+'\n'),5);")
    function Holder([string]$dir) {
        $null = New-Item -ItemType Directory -Path $dir
        $log = Join-Path $dir 'server.log'
        $p = Start-Process -FilePath $node.Source -ArgumentList @(('"' + $js + '"'), ('"' + $log + '"')) -PassThru -WindowStyle Hidden
        $script:started += $p
        # Until it has the file open and has written to it.
        $until = (Get-Date).AddSeconds(20)
        while (-not ((Test-Path -LiteralPath $log) -and (Get-Item -LiteralPath $log).Length -gt 0) -and (Get-Date) -lt $until) {
            [Threading.Thread]::Sleep(50)
        }
        return $p
    }

    # 3. ended, waited for, renamed at once.
    $moved = 0
    $said = @()
    for ($n = 0; $n -lt 10; $n++) {
        $d = Join-Path $work ('wait-' + $n)
        $p = Holder $d
        $held = @(Get-ThornswoodProcessHeld @($p.Id))
        $said += @(Stop-ThornswoodProcessHeld $held)
        if ($p.HasExited -and (Move-ThornswoodPath $d ($d + '-moved'))) { $moved++ }
        elseif ($ThornswoodMoveWhy) { $said += $ThornswoodMoveWhy }
    }
    Yes ('a node holding a file, ended and waited for, then its folder renamed at once: ' + $moved + ' of 10' + $(if ($said.Count) { ' (' + ($said -join '; ') + ')' })) ($moved -eq 10)

    # The old way, measured and printed: renamed the moment Stop-Process returns.
    $refused = 0
    for ($n = 0; $n -lt 10; $n++) {
        $d = Join-Path $work ('old-' + $n)
        $p = Holder $d
        Stop-Process -Id $p.Id -Force
        try { [IO.Directory]::Move($d, $d + '-moved') } catch { $refused++ }
        $null = $p.WaitForExit(30000)
    }
    Write-Host ('NOTE  the old way here: ' + $refused + ' of 10 folders refused when renamed the moment Stop-Process returned')

    # 4. a refused rename: tried once, false, and why.
    $d = Join-Path $work 'held-here'
    $null = New-Item -ItemType Directory -Path $d
    $f = Join-Path $d 'open.txt'
    [IO.File]::WriteAllText($f, 'held')
    $h = [IO.File]::Open($f, 'Open', 'Read', 'None')
    try { $ok = Move-ThornswoodPath $d ($d + '-moved') } finally { $h.Close() }
    Yes 'a folder with a file this process holds is refused, once, and left where it is' ((-not $ok) -and (Test-Path -LiteralPath $f))
    Yes ('  saying the Windows error and who holds it: ' + $ThornswoodMoveWhy) ($ThornswoodMoveWhy -match '\(0x8007[0-9A-F]{4}\)' -and $ThornswoodMoveWhy -match ('pid ' + $PID + '\b'))
    Yes '  and that the folder opened and the rename was refused, error 5, as a file under it was open (#3262)' ($ThornswoodMoveWhy -match '^the folder opened, and the rename was refused: .*\(0x80070005\)')
    Yes '  and once it is let go, the same move goes through' (Move-ThornswoodPath $d ($d + '-moved'))

    # 4c. #3274: a file another process holds, named by Windows's list for
    # each file, where the Restart Manager used to be asked.
    $d = Join-Path $work 'node-holds'
    $p = Holder $d
    $ok = Move-ThornswoodPath $d ($d + '-moved')
    Yes 'a folder with a file another process holds is refused, once' ((-not $ok) -and (Test-Path -LiteralPath $d))
    Yes ('  and Windows''s list for each file names that process: ' + $ThornswoodMoveWhy) (
        $ThornswoodMoveWhy -match ('files under it open in: (.*; )?pid ' + $p.Id + ' node\.exe \(1 file\(s\), the first ' + [regex]::Escape((Join-Path $d 'server.log')) + '\)'))
    $held = @(Get-ThornswoodProcessHeld @($p.Id))
    $null = @(Stop-ThornswoodProcessHeld $held)

    # 4b. #3131: a folder another process has as its current directory. The
    # Restart Manager is asked about files and names nothing; the handle list
    # names the process.
    $d = Join-Path $work 'cwd-here'
    $null = New-Item -ItemType Directory -Path $d
    [IO.File]::WriteAllText((Join-Path $d 'a.txt'), 'x')
    # It writes ready.txt once it is running, so its current directory is set;
    # the file is closed again at once and holds nothing.
    $c = Start-Process -FilePath $node.Source -ArgumentList @('-e', '"require(''fs'').writeFileSync(''ready.txt'',''1'');setInterval(()=>{},1000)"') -WorkingDirectory $d -PassThru -WindowStyle Hidden
    $started += $c
    $until = (Get-Date).AddSeconds(20)
    while (-not (Test-Path -LiteralPath (Join-Path $d 'ready.txt')) -and (Get-Date) -lt $until) { [Threading.Thread]::Sleep(50) }
    # A process started in the 2 minutes before whose command line holds a
    # line break, as Publish-Update's -Notes does. On 30 Oct a harness beside
    # this one ran one, and the refusal threw reading its id back out of its
    # line instead of saying who held the folder.
    # Its line break is in the refusal from here on, before or after the
    # node's own line by which id is lower, so a match across the lines below
    # takes (?s): without it, the checks of step 4 failed whenever this id
    # was the lower one (#4961).
    $nl = Start-Process -FilePath $node.Source -ArgumentList @('-e', "`"setInterval(()=>{},1000)`n// a second line`"") -PassThru -WindowStyle Hidden
    $started += $nl
    $ok = Move-ThornswoodPath $d ($d + '-moved')
    Yes 'a folder another process has as its current directory is refused, once' ((-not $ok) -and (Test-Path -LiteralPath $d))
    Yes '  and a process started just before, whose command line holds a line break, is named among them whole (#3214)' (
        $ThornswoodMoveWhy -match ('(?s)started in the 2 minutes before: (.*; )?pid ' + $nl.Id + ' node(\.exe)? \(.*a second line'))
    Stop-Process -Id $nl.Id -Force -EA SilentlyContinue
    Yes '  saying the folder itself would not open to be renamed (#3262)' ($ThornswoodMoveWhy -match '^the folder would not open to be renamed: .*\(0x80070020\)')
    Yes ('  and the handle list names that process, where no file under the folder is open: ' + $ThornswoodMoveWhy) (
        $ThornswoodMoveWhy -match '\(0x8007[0-9A-F]{4}\)' -and $ThornswoodMoveWhy -match 'files under it open in: no process but this one, asking, in 2 file\(s\)' -and
        $ThornswoodMoveWhy -match ('handles: .*pid ' + $c.Id + ' node: ' + [regex]::Escape($d)))
    Yes ('  and Windows''s own list of who has the folder open names it first, with its parent and start time (#3262)') (
        $ThornswoodMoveWhy -match ('^.*?open itself in: (pid \d+ \S+, )*pid ' + $c.Id + ' node\b') -and
        $ThornswoodMoveWhy -match ('(?s)who they are: (.*; )?pid ' + $c.Id + ' node(\.exe)? \(parent ' + $PID + ' [^,]+, started \d{4}-\d\d-\d\d \d{1,2}:\d\d:\d\d\.\d{3} [AP]M\), command line ') -and
        $ThornswoodMoveWhy -match ('(?s)started in the 2 minutes before: (.*; )?pid ' + $c.Id + ' ') -and
        $ThornswoodMoveWhy.IndexOf('open itself in:') -lt $ThornswoodMoveWhy.IndexOf('handles:') -and
        $ThornswoodMoveWhy.IndexOf('handles:') -lt $ThornswoodMoveWhy.IndexOf('files under it open in:'))
    $held = @(Get-ThornswoodProcessHeld @($c.Id))
    $null = @(Stop-ThornswoodProcessHeld $held)
    Yes '  and once it has exited, the same move goes through' (Move-ThornswoodPath $d ($d + '-moved'))

    # 5. never this process, never an id with nothing running.
    $gone = Start-Process -FilePath $node.Source -ArgumentList @('-e', '0') -PassThru -WindowStyle Hidden
    $null = $gone.WaitForExit(30000)
    $none = @(Get-ThornswoodProcessHeld @($PID, $gone.Id, 0, -1))
    Yes 'this process, an id that has exited, 0 and -1 are none of them opened' ($none.Count -eq 0 -and @($ThornswoodNotHeld).Count -eq 0)
    $said = @(Stop-ThornswoodProcessHeld @())
    Yes '  and ending nothing says nothing and leaves nothing running' ($said.Count -eq 0 -and @($ThornswoodStillRunning).Count -eq 0)
}
catch {
    Yes ('the runs finished without an error: ' + $_.Exception.Message + ' at ' + $_.InvocationInfo.PositionMessage) $false
}
finally {
    foreach ($p in $started) { if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force -EA SilentlyContinue; $null = $p.WaitForExit(30000) } }
    Remove-Item -LiteralPath $work -Recurse -Force -EA SilentlyContinue
}
Done
