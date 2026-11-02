<#
  test-5155-server-holds.ps1

  A server stopped on purpose is held, and the watchdog leaves it alone until
  the hold runs out (#5155).

  WHY THIS EXISTS. On 31 Oct 2026 the box's watchdog started the live server
  again at 4:01 PM, a minute after it was stopped so its merchant ledger could
  be swapped, because nothing told the watchdog the stop was on purpose.
  Patrick's answer (A): whoever stops a server on purpose leaves a hold beside
  it, saying who, why and until when, 30 minutes unless they say and 2 hours
  at most; the watchdog leaves a held server alone until then, tells staff once
  and starts it. tests\test-watch-alerts.ps1 runs the real watcher against a
  fake box with holds in it. This checks the rest:

    1. ServerHold.ps1, the one writer: the file it writes, the limits, the
       lines it says, and the text the scripts send to the box, run in a
       fresh scope against a scratch folder.
    2. The writer and the watcher's own reader (ReadHold, lifted out of the
       watcher here-string in Watch-Services.ps1) agree on where a hold lives
       and what it says, so the two cannot drift apart.
    3. The copy Install-ThornswoodServer.ps1 carries is the file itself.
    4. Every script that stops a watched server on purpose writes a hold
       before its stop and takes it away after, and a stop added anywhere in
       scripts\ without a hold fails here.

  Read only apart from its own scratch folder. Never connects to anything.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = (Resolve-Path (Join-Path $Here '..')).Path

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function P([string[]]$parts) { return (Join-Path $repo ($parts -join [IO.Path]::DirectorySeparatorChar)) }
function Text([string]$path) { return ([IO.File]::ReadAllText($path) -replace "`r`n", "`n") }

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('ts-5155-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

try {
    # ---- 1. the writer -------------------------------------------------------
    $libPath = P 'scripts', 'vps', 'ServerHold.ps1'
    $lib = Text $libPath
    $errs = $null
    $null = [System.Management.Automation.Language.Parser]::ParseInput($lib, [ref]$null, [ref]$errs)
    Yes 'ServerHold.ps1 parses' ($errs.Count -eq 0)
    Yes 'ServerHold.ps1 is plain ASCII, as the box reads it' ($lib -notmatch '[^\x00-\x7F]')
    . $libPath
    Yes 'a hold is 30 minutes unless said, and 2 hours at most' ($ThornswoodHoldUsual -eq 30 -and $ThornswoodHoldMost -eq 120)
    Yes 'it lives in the watchdog''s folder on the box' ($ThornswoodHoldRoot -eq 'C:\Thornswood-Watch')
    $box = Join-Path $tmp 'box'
    New-Item -ItemType Directory -Force -Path $box | Out-Null
    Yes 'a hold''s file is named by the task with only letters, digits and dashes' (
        (Split-Path -Leaf (Get-ThornswoodHoldFile -Target 'Thornswood Dev Server' -Root $box)) -eq 'Thornswood-Dev-Server.json' -and
        (Split-Path -Leaf (Get-ThornswoodHoldFile -Target 'ThornswoodBot' -Root $box)) -eq 'ThornswoodBot.json')
    $before = [DateTimeOffset]::Now.ToUnixTimeSeconds()
    $line = Set-ThornswoodHold -Target 'Thornswood Server' -Why 'swapping the ledger' -By 'a run note' -Root $box
    $after = [DateTimeOffset]::Now.ToUnixTimeSeconds()
    $f = Get-ThornswoodHoldFile -Target 'Thornswood Server' -Root $box
    $j = [IO.File]::ReadAllText($f) | ConvertFrom-Json
    Yes 'Set-ThornswoodHold writes target, by, why, set and until' (
        $j.target -eq 'Thornswood Server' -and $j.by -eq 'a run note' -and $j.why -eq 'swapping the ledger' -and
        [int64]$j.set -ge $before -and [int64]$j.set -le $after -and ([int64]$j.until - [int64]$j.set) -eq 1800)
    Yes '  and says it in one line' ($line -match '^held      Thornswood Server until \d\d:\d\d box time \(30 min\), by a run note: swapping the ledger$')
    Yes '  and leaves no half-written file beside it' (-not (Test-Path -LiteralPath ($f + '.tmp')))
    $null = Set-ThornswoodHold -Target 'Thornswood Server' -Why 'x' -Minutes 500 -Root $box
    $j = [IO.File]::ReadAllText($f) | ConvertFrom-Json
    Yes 'a hold asked for longer than 2 hours is written as 2 hours' (([int64]$j.until - [int64]$j.set) -eq 7200)
    Yes 'with no by, it is the account that ran it' ([string]$j.by -eq [string]$env:USERNAME)
    $list = @(Get-ThornswoodHolds -Root $box)
    Yes 'Get-ThornswoodHolds names each hold, who and why' ($list.Count -eq 1 -and $list[0] -match '^held      Thornswood Server until \d\d:\d\d box time, by .*: x$')
    Yes 'Clear-ThornswoodHold takes it away and says so' ((Clear-ThornswoodHold -Target 'Thornswood Server' -Root $box) -match '^released  Thornswood Server' -and -not (Test-Path -LiteralPath $f))
    Yes '  and with none left, the list says none' ((@(Get-ThornswoodHolds -Root $box))[0] -eq 'holds     none')
    Yes 'with no watchdog folder nothing is written, and that is said' (
        (Set-ThornswoodHold -Target 'Thornswood Server' -Why 'x' -Root (Join-Path $tmp 'nowhere')) -match '^no hold   ' -and
        -not (Test-Path -LiteralPath (Join-Path $tmp 'nowhere')))
    Yes 'an empty root holds nothing and clears nothing' (
        (Set-ThornswoodHold -Target 'Thornswood Server' -Why 'x' -Root '') -match '^no hold   ' -and
        (Clear-ThornswoodHold -Target 'Thornswood Server' -Root '') -match '^no hold   ')
    Yes 'Get-ThornswoodHoldBy names the script and the machine' ((Get-ThornswoodHoldBy -Script 'Deploy-Server.ps1') -match '^Deploy-Server\.ps1 \(.+\)$')

    # The text a script sends, run on its own, as the box runs it.
    $sent = Get-ThornswoodHoldScript -Script "Tom's Deploy.ps1"
    $errs = $null
    $null = [System.Management.Automation.Language.Parser]::ParseInput($sent, [ref]$null, [ref]$errs)
    Yes 'the text sent to the box parses, and is plain ASCII' ($errs.Count -eq 0 -and $sent -notmatch '[^\x00-\x7F]')
    $box2 = Join-Path $tmp 'box2'
    New-Item -ItemType Directory -Force -Path $box2 | Out-Null
    $far = [scriptblock]::Create($sent + "`n" + '$ThornswoodHoldRoot = ''' + $box2 + '''' + "`n" +
        "Set-ThornswoodHold -Target 'Thornswood Voice' -Why 'restarting voice' -By `$HoldBy`n" +
        "(Get-Content -LiteralPath (Get-ThornswoodHoldFile -Target 'Thornswood Voice') -Raw)`n" +
        "Clear-ThornswoodHold -Target 'Thornswood Voice'")
    $said = @(& { & $far })
    $farJson = $null
    try { $farJson = $said[1] | ConvertFrom-Json } catch { }
    Yes 'run on its own, it holds and clears, with $HoldBy naming the script, quotes and all' (
        $said.Count -eq 3 -and $said[0] -match '^held      Thornswood Voice' -and $farJson -and
        $farJson.by -match "^Tom's Deploy\.ps1 \(" -and $said[2] -match '^released  Thornswood Voice')
    Yes '  and without -Script it sends no $HoldBy' ((Get-ThornswoodHoldScript) -notmatch '\$HoldBy =')

    # ---- 2. the writer and the watcher agree ----------------------------------
    $watchPath = P 'scripts', 'vps', 'Watch-Services.ps1'
    $errs = $null
    $outer = [System.Management.Automation.Language.Parser]::ParseFile($watchPath, [ref]$null, [ref]$errs)
    $assign = $outer.Find({ param($a) $a -is [System.Management.Automation.Language.AssignmentStatementAst] -and "$($a.Left)" -eq '$watcher' }, $true)
    $wtext = $assign.Right.Find({ param($a) $a -is [System.Management.Automation.Language.StringConstantExpressionAst] }, $true).Value
    $inner = [System.Management.Automation.Language.Parser]::ParseInput($wtext, [ref]$null, [ref]$errs)
    $fns = @{}
    foreach ($fn in $inner.FindAll({ param($a) $a -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true)) { $fns[$fn.Name] = $fn.Extent.Text }
    $vals = @{}
    foreach ($s in $inner.EndBlock.Statements) {
        if ($s -is [System.Management.Automation.Language.AssignmentStatementAst] -and @('$holdUsual', '$holdMost') -contains "$($s.Left)") { $vals["$($s.Left)"] = $s.Right.Extent.Text }
    }
    Yes 'the watcher has its reader: HoldFile, ReadHold, TellHold' ($fns.ContainsKey('HoldFile') -and $fns.ContainsKey('ReadHold') -and $fns.ContainsKey('TellHold'))
    Yes 'the watcher''s 30 and 120 are ServerHold.ps1''s' ($vals['$holdUsual'] -eq "$ThornswoodHoldUsual" -and $vals['$holdMost'] -eq "$ThornswoodHoldMost")
    $box3 = Join-Path $tmp 'box3'
    New-Item -ItemType Directory -Force -Path $box3 | Out-Null
    $read = [scriptblock]::Create('param($target, $at) $holdDir = Join-Path ''' + $box3 + ''' ''holds''; $holdUsual = 30; $holdMost = 120; $now = $at' + "`n" +
        $fns['HoldFile'] + "`n" + $fns['ReadHold'] + "`n" + 'ReadHold $target')
    foreach ($t in 'Thornswood Server', 'Thornswood Dev Server', 'ThornswoodBot', 'Thornswood Web') {
        $null = Set-ThornswoodHold -Target $t -Why ('why ' + $t) -By ('by ' + $t) -Minutes 45 -Root $box3
        $h = & $read $t (Get-Date)
        Yes ("what ServerHold.ps1 writes for $t the watcher reads: who, why, until, not yet over") (
            $h -and $h.By -eq ('by ' + $t) -and $h.Why -eq ('why ' + $t) -and -not $h.Over -and
            [math]::Abs(($h.Until - (Get-Date).AddMinutes(45)).TotalSeconds) -lt 5)
        $h2 = & $read $t ((Get-Date).AddMinutes(46))
        Yes "  and over once its time is past" ($h2 -and $h2.Over)
    }
    Yes 'the watcher reads nothing for a server nobody holds' ($null -eq (& $read 'Thornswood Voice' (Get-Date)))

    # ---- 3. the copy in the server installer ------------------------------------
    $inst = Text (P 'scripts', 'deploy', 'Install-ThornswoodServer.ps1')
    $m = [regex]::Match($inst, '(?s)# ---- ServerHold\.ps1 \(copy\) ----\n(.*?)# ---- end ServerHold\.ps1 ----')
    $body = $lib.Substring($lib.IndexOf("#>`n") + 3)
    Yes 'the server installer carries an exact copy of ServerHold.ps1 below its header' ($m.Success -and $m.Groups[1].Value -eq $body)
    Yes '  holds in StopServer, before the task is stopped, and takes the hold away in Finish' (
        $inst -match '(?s)function StopServer.*?Set-ThornswoodHold -Target \$TaskName.*?Stop-ScheduledTask -TaskName \$TaskName' -and
        $inst -match '(?s)function Finish.*?Clear-ThornswoodHold -Target \$script:heldTask.*?exit \$code')

    # ---- 4. every stop on purpose holds -----------------------------------------
    # Each line that stops a watched server: its task, the bot's service, or
    # Caddy, by any of the ways a script here stops one.
    $watched = 'Thornswood Server|Thornswood Dev Server|Thornswood Voice|Thornswood Dev Voice|Thornswood Docs|Thornswood Web|Thornswood Bridge|ThornswoodBot|Thornswood Gate|Thornswood Admin'
    $stopRx = 'Stop-ScheduledTask|schtasks[^\n]*/end|Stop-Service|Restart-Service|Stop-ThornswoodBotService|StopIt$|StopOurs$|StopServer \$Root'
    # Where a stop is not a stop on purpose of a running server, and why.
    $notHolds = @{
        'scripts/vps/Watch-Services.ps1'      = 'the watchdog itself: its restarts are what a hold holds back'
        'scripts/vps/vps-freeze.ps1'          = 'turns the watchdog off before it stops anything, for a move longer than any hold may be'
        'scripts/deploy/StopAndMove.ps1'      = 'the stop and wait its callers use, after they have held'
        'scripts/deploy/Install-Runner.ps1'   = 'the build runners, which the watchdog never starts'
        'scripts/dev/Trace-Gate-Box.ps1'      = 'a trace that reads the gate and stops nothing of it'
        'scripts/vps/vps-harden.ps1'          = 'services of Windows, not a server'
        'scripts/vps/vps-openssh.ps1'         = 'sshd, which the watchdog does not watch'
        'scripts/vps/BotService.cs'           = 'the bot''s own service program'
        'scripts/vps/Remote.ps1'              = 'runs what it is given; its help names a Windows service as an example'
        'scripts/deploy/Install-Tunnel.ps1'   = 'stops only cloudflared''s own task, Thornswood Tunnel, which the watchdog does not watch; it refuses that stop while the site is on the tunnel (#5334)'
        'scripts/deploy/Install-DeployAgent.ps1' = 'stops only the deploy agent''s own service, which the watchdog does not watch; it names the site''s task and the bot''s service only to see whether they are set up (the agent holds them itself when it swaps, App.cs)'
    }
    $files = @(Get-ChildItem -LiteralPath (P 'scripts') -Recurse -File -Include '*.ps1' | ForEach-Object { $_.FullName })
    $stoppers = @()
    foreach ($file in $files) {
        $rel = $file.Substring($repo.Length + 1).Replace('\', '/')
        $t = Text $file
        if ($t -notmatch "(?m)($stopRx)") { continue }
        if ($t -notmatch "(?i)$watched|\`$TaskName|\`$Task\b|\`$Service\b|\`$botService|\`$it\.(Task|Svc)") { continue }
        if ($rel -eq 'scripts/vps/ServerHold.ps1' -or $rel -eq 'scripts/vps/Hold-Server.ps1') { continue }
        $stoppers += $rel
        if ($notHolds.ContainsKey($rel)) { continue }
        # Its own Set and Clear, or its stops all run inside Swap.ps1's service
        # swap, which holds under the name the script gives ServiceSwapVars.
        $own = $t -match 'Set-ThornswoodHold' -and $t -match 'Clear-ThornswoodHold'
        $bySwap = $t -match 'ServiceSwapVars \$Root \$stageName \$prevName \$Wait \$hashes @\(\) \$\w+\)' -and $t -match 'Get-ThornswoodHoldScript'
        Yes "$rel stops a server and holds it (Set-ThornswoodHold, then Clear-ThornswoodHold)" (
            ($own -or $bySwap) -and $t -match 'ServerHold\.ps1|Get-ThornswoodHoldScript')
    }
    foreach ($k in $notHolds.Keys) {
        if (-not (Test-Path -LiteralPath (Join-Path $repo $k))) { continue }
        Yes "$k is let off on purpose: $($notHolds[$k])" ($true)
    }
    foreach ($must in 'scripts/deploy/Swap.ps1', 'scripts/deploy/Deploy-Docs.ps1', 'scripts/deploy/Install-Bridge.ps1', 'scripts/deploy/Install-Voice.ps1',
                      'scripts/deploy/Install-Gate.ps1', 'scripts/deploy/Install-AdminService.ps1', 'scripts/deploy/Install-ThornswoodServer.ps1',
                      'scripts/vps/Restart-Server.ps1', 'scripts/ops/Reset-Character.ps1', 'scripts/vps/Bot-Service.ps1') {
        Yes "$must is among the stops this finds" ($stoppers -contains $must)
    }

    # The swaps carry the hold to every deploy that uses them.
    $swap = Text (P 'scripts', 'deploy', 'Swap.ps1')
    Yes 'Swap.ps1 sends the hold in front of both swap blocks' (
        $swap.Contains('$swapBlock = $ThornswoodHoldText + $swapBlock') -and $swap.Contains('$serviceSwapBlock = $ThornswoodHoldText + $serviceSwapBlock'))
    Yes '  and the service swap holds under the name its caller gives ServiceSwapVars' ($swap -match '\(\x27\$HoldTarget = \x27 \+ \(& \$q \$holdTarget\)\)')
    foreach ($c in @(
            @{ F = 'scripts/deploy/Deploy-Docs.ps1'; Rx = 'ServiceSwapVars \$Root \$stageName \$prevName \$Wait \$hashes @\(\) \$Task\)' },
            @{ F = 'scripts/deploy/Install-Voice.ps1'; Rx = 'ServiceSwapVars \$Root \$stageName \$prevName \$Wait \$hashes @\(\) \$TaskName\)' },
            @{ F = 'scripts/deploy/Install-Bot.ps1'; Rx = 'ServiceSwapVars \$Root \$stageName \$prevName \$Wait \$hashes @\(\) \$Service\)' })) {
        Yes "$($c.F) gives its swap the name the watchdog knows it by" ((Text (P $c.F)) -match $c.Rx)
    }
    # Each block that sends Bot-Service.ps1 or Write-BotToken.ps1 sends the hold in front of it.
    $ib = Text (P 'scripts', 'deploy', 'Install-Bot.ps1')
    Yes 'Install-Bot.ps1 sends the hold in front of Bot-Service.ps1 every time' (
        ([regex]::Matches($ib, '\(Get-ThornswoodHoldScript -Script ''Install-Bot\.ps1''\) \+ \$ThornswoodStopAndMoveText \+ \(Get-Content -LiteralPath \$svcLib -Raw\)')).Count -eq
        ([regex]::Matches($ib, 'Get-Content -LiteralPath \$svcLib -Raw')).Count)
    foreach ($w in 'scripts/deploy/Install-Bot.ps1', 'scripts/deploy/Set-DiscordLogin.ps1') {
        $wt = Text (P $w)
        Yes "$w sends the hold in front of Write-BotToken.ps1 every time" (
            ([regex]::Matches($wt, 'Get-ThornswoodHoldScript -Script ''[A-Za-z-]+\.ps1''\) \+ \(Get-Content -LiteralPath \$writer -Raw\)')).Count -eq
            ([regex]::Matches($wt, 'Get-Content -LiteralPath \$writer -Raw')).Count)
    }
    Yes 'Rotate-BotToken.ps1 sends it in front of Write-BotToken.ps1' ((Text (P 'scripts', 'deploy', 'Rotate-BotToken.ps1')) -match '\$writerText = \(Get-ThornswoodHoldScript -Script ''Rotate-BotToken\.ps1''\) \+ \[IO\.File\]::ReadAllText\(\$writer\)')

    # ---- the hand tool -------------------------------------------------------------
    $hs = Text (P 'scripts', 'vps', 'Hold-Server.ps1')
    $errs = $null
    $null = [System.Management.Automation.Language.Parser]::ParseInput($hs, [ref]$null, [ref]$errs)
    Yes 'Hold-Server.ps1 parses and is plain ASCII' ($errs.Count -eq 0 -and $hs -notmatch '[^\x00-\x7F]')
    Yes '  and names each server by the task or service the watchdog checks' (
        $hs -match "game = 'Thornswood Server'" -and $hs -match "dev = 'Thornswood Dev Server'" -and $hs -match "bot = 'ThornswoodBot'" -and $hs -match "caddy = 'Thornswood Web'")
    $wt = Text $watchPath
    foreach ($n in 'Thornswood Server', 'Thornswood Dev Server', 'Thornswood Voice', 'Thornswood Dev Voice', 'Thornswood Docs', 'Thornswood Web', 'Thornswood Bridge', 'ThornswoodBot') {
        Yes "  and $n is one the watchdog checks by that name" ($wt -match ("(Task|Svc) = '" + [regex]::Escape($n) + "'"))
    }
    # ---- from the cloud, through the gate ----------------------------------------
    # Nothing goes to One (Patrick, 31 Oct): the watcher's install and a hold by
    # hand run as gate verbs, Box-Run.ps1 -Line 'Watch-Services -Install' and
    # -Line 'Hold-Server -Service dev -Why ...', from main as it is on GitHub.
    $verbs = (Text (P 'scripts', 'vps', 'gate', 'verbs.json') | ConvertFrom-Json).verbs
    $wv = $verbs.'Watch-Services'; $hv = $verbs.'Hold-Server'
    Yes 'the gate has a Watch-Services verb: the report, or -Install, and nothing else' (
        $wv -and $wv.script -eq 'scripts/vps/Watch-Services.ps1' -and @($wv.fixed) -contains '-NoPause' -and
        @($wv.params.PSObject.Properties.Name) -join ',' -eq 'Install' -and $wv.params.Install -eq 'switch')
    $set = [regex]::Match($hs, "ValidateSet\(([^)]*)\)").Groups[1].Value
    $names = @([regex]::Matches($set, "'([a-z]+)'") | ForEach-Object { $_.Groups[1].Value })
    Yes ('the gate has a Hold-Server verb whose servers are exactly Hold-Server''s (' + ($names -join ', ') + ')') (
        $hv -and $hv.script -eq 'scripts/vps/Hold-Server.ps1' -and @($hv.fixed) -contains '-NoPause' -and $names.Count -eq 10 -and
        $hv.params.Service -eq ('^(' + ($names -join '|') + ')$') -and $hv.params.Why -eq 'text' -and
        $hv.params.Clear -eq 'switch' -and $hv.params.List -eq 'switch' -and $hv.params.Minutes -eq '^[0-9]{1,3}$')
    $wsText = Text $watchPath
    Yes '  and an install through the gate that fails exits 1, so Box-Run says so' ($wsText.Contains("if (`"`$l`" -match '^FAILED') { `$c = 'Red'; `$failed = `$true }") -and $wsText.Contains('if ($failed) { exit 1 }'))
}
catch {
    Yes ('the harness ran to the end: ' + $_.Exception.Message + ' at ' + $_.InvocationInfo.PositionMessage) $false
}
finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -EA SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
