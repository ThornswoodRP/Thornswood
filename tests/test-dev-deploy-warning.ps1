<#
  test-dev-deploy-warning.ps1

  Deploy-DevGamemode.ps1 says who is on the dev server and warns them in the
  game before it stops anything. Entry 351 on the To Do List.

  WHY THIS EXISTS. On 23 September that script stopped the dev server six
  times in an hour under Patrick while he was testing, with no word to anybody.
  Every stop is a reconnect and every reconnect is a respawn: "I randomly
  teleportes as I was typing this and I heard the noise of things equipping",
  and then "I did the teleport thing again, it was while looking in the forge".
  The dev server.log has 'gamemode loaded' at 20:39:00 and his worn things put
  back on at 20:39:47, and the same again at 20:44.

  HOW. The warning is a block of functions between two markers in
  Deploy-DevGamemode.ps1. This takes that block and drives it with the things
  that would reach the VPS replaced by stand-ins:

    Remote          answers from a list, or runs what it would have sent
                    against a temp folder on this machine, in Windows
                    PowerShell, which is what sshd runs on the box
    Request-Restart a script with the real one's parameter block, so the call
                    binds exactly as it would, which only writes down what it
                    was asked and exits with the code it is told to
    the clock       Get-Date and Start-Sleep, so a minute's countdown takes
                    no time at all

  The rest of the deploy is read, not run: where the warning sits against the
  stop is checked on the parsed script.

  AND A SERVER THAT IS NOT RUNNING. A review on 24 September found the read
  trusted online.json with nothing on the port: {"now":1} left by a killed
  process read as one on, the warning went out to nobody, and restart.json
  sat in the data folder until the next boot counted down on its own. The
  read now runs here with a real UDP socket on loopback standing in for the
  server, and with none. The stop block is taken out of the deploy and run
  here too, against a temp folder, with everything in it that stops a task or
  a process replaced by a stand-in.

  Never connects to anything.
#>
[CmdletBinding()]
param()
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$tools = $PSScriptRoot
if (-not $tools) { $tools = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# The tests are in tests\, the repository is one folder up.
$tools = Split-Path -Parent $tools

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}

$deployPath = Join-Path $tools 'scripts\deploy\Deploy-DevGamemode.ps1'
$askPath    = Join-Path $tools 'scripts\vps\Request-Restart.ps1'
$src = Get-Content -LiteralPath $deployPath -Raw

# ---- the block is there to test -------------------------------------------
$open  = '# ==== thornswood dev deploy warning ===='
$close = '# ==== end thornswood dev deploy warning ===='
$a = $src.IndexOf($open)
$b = $src.IndexOf($close)
Yes 'Deploy-DevGamemode.ps1 carries the warning block between its markers' ($a -ge 0 -and $b -gt $a)
if (-not ($a -ge 0 -and $b -gt $a)) {
    Write-Host '  the deploy has no warning to test, so it stops a dev server with people on it unannounced' -ForegroundColor Red
    Done
}
$block = $src.Substring($a, $b - $a)

# ---- the switches ------------------------------------------------------------
$ast = [System.Management.Automation.Language.Parser]::ParseFile($deployPath, [ref]$null, [ref]$null)
$params = @{}
foreach ($p in $ast.ParamBlock.Parameters) { $params[$p.Name.VariablePath.UserPath] = $p }

function DefaultOf($name) {
    if (-not $params.ContainsKey($name) -or -not $params[$name].DefaultValue) { return $null }
    return $params[$name].DefaultValue.SafeGetValue()
}
function SetOf($p) {
    foreach ($at in $p.Attributes) {
        if ($at.TypeName.Name -eq 'ValidateSet') {
            return @($at.PositionalArguments | ForEach-Object { $_.SafeGetValue() })
        }
    }
    return @()
}

Yes '-Now is a switch, so the old straight-down deploy is one word away' (
    $params.ContainsKey('Now') -and $params['Now'].StaticType -eq [System.Management.Automation.SwitchParameter])
Yes '-Minutes defaults to one minute, as Deploy-Server does' ((DefaultOf 'Minutes') -eq 1)
Yes '-Mode defaults to notice, which puts nobody out' ((DefaultOf 'Mode') -eq 'notice')
Yes '-Mode takes notice and restart and nothing else' (
    $params.ContainsKey('Mode') -and ((@(SetOf $params['Mode']) | Sort-Object) -join ',') -eq 'notice,restart')
Yes '-Why is there for the restart wording' ($params.ContainsKey('Why'))

# ---- and the warning comes before anything stops ------------------------------
$top = @($ast.EndBlock.Statements)
# Since #3196 the warning, the stop and the swap are the body of the one if a
# restart takes, after the reload that needs none of them, so their order is
# read inside it, and nothing before it may stop the server.
$iLoad = -1; $iSwapIf = -1; $iEarlyStop = -1
for ($i = 0; $i -lt $top.Count; $i++) {
    $s = $top[$i]
    if ($iLoad -lt 0 -and $s -is [System.Management.Automation.Language.IfStatementAst] -and
        $s.Clauses[0].Item1.Extent.Text -eq '$LoadOrder') { $iLoad = $i }
    if ($iSwapIf -lt 0 -and $s -is [System.Management.Automation.Language.IfStatementAst] -and
        $s.Clauses[0].Item1.Extent.Text -eq "`$outcome -eq 'swap' -or `$outcome -eq 'recover'") { $iSwapIf = $i }
    if ($iSwapIf -lt 0 -and $iEarlyStop -lt 0 -and $s -isnot [System.Management.Automation.Language.FunctionDefinitionAst] -and
        $s.Extent.Text -match 'Stop-ScheduledTask|\$swapBlock') { $iEarlyStop = $i }
}
Yes 'the warning and the swap are what a restart does, after the reload (#3196)' ($iSwapIf -ge 0)
$inner = @()
if ($iSwapIf -ge 0) { $inner = @($top[$iSwapIf].Clauses[0].Item2.Statements) }
$iWarn = -1; $iStop = -1; $iFirstStopTask = -1
for ($i = 0; $i -lt $inner.Count; $i++) {
    $s = $inner[$i]
    $text = $s.Extent.Text
    if ($s -is [System.Management.Automation.Language.PipelineAst] -and $s.PipelineElements.Count -eq 1 -and
        $s.PipelineElements[0] -is [System.Management.Automation.Language.CommandAst] -and
        $s.PipelineElements[0].GetCommandName() -eq 'Warn-DevRoom') { $iWarn = $i }
    if ($iStop -lt 0 -and $text -match "^Write-Host 'Stopping the dev server\.\.\.'") { $iStop = $i }
    # The stop is Swap.ps1's swap block since issue #446, sent as $swapBlock.
    if ($iFirstStopTask -lt 0 -and $s -isnot [System.Management.Automation.Language.FunctionDefinitionAst] -and
        $text -match 'Stop-ScheduledTask|\$swapBlock') { $iFirstStopTask = $i }
}
Yes 'the deploy calls the warning' ($iWarn -ge 0)
Yes 'after the load order is worked out, so a missing plugin still stops it before anybody is told' (
    $iLoad -ge 0 -and $iSwapIf -gt $iLoad)
Yes 'and nothing before it stops the dev server' ($iEarlyStop -lt 0)
Yes "before 'Stopping the dev server...'" ($iStop -ge 0 -and $iWarn -lt $iStop)
Yes 'and before the first thing that stops the scheduled task' ($iFirstStopTask -gt $iWarn)

# ---- the call to Request-Restart binds ----------------------------------------
$askAst = [System.Management.Automation.Language.Parser]::ParseFile($askPath, [ref]$null, [ref]$null)
$askParams = @{}
foreach ($p in $askAst.ParamBlock.Parameters) { $askParams[$p.Name.VariablePath.UserPath] = $p }
$blockAst = [System.Management.Automation.Language.Parser]::ParseInput($block, [ref]$null, [ref]$null)
$askCalls = @($blockAst.FindAll({
    param($n)
    $n -is [System.Management.Automation.Language.CommandAst] -and
    $n.CommandElements[0] -is [System.Management.Automation.Language.VariableExpressionAst] -and
    $n.CommandElements[0].VariablePath.UserPath -eq 'ask'
}, $true))
Yes 'the warning calls Request-Restart exactly once' ($askCalls.Count -eq 1)
if ($askCalls.Count -eq 1) {
    $named = @($askCalls[0].CommandElements |
               Where-Object { $_ -is [System.Management.Automation.Language.CommandParameterAst] } |
               ForEach-Object { $_.ParameterName })
    $unknown = @($named | Where-Object { -not $askParams.ContainsKey($_) })
    Yes ('every switch it passes is one Request-Restart.ps1 has' +
         $(if ($unknown.Count) { ': not ' + ($unknown -join ', ') } else { '' })) ($unknown.Count -eq 0)
    Yes 'it passes -RestartFollows, the promise Request-Restart wants before a restart puts anybody out' (
        $named -contains 'RestartFollows')
    Yes 'it names the data folder rather than letting it default to the live one' ($named -contains 'Data')
}
$askModes = @()
if ($askParams.ContainsKey('Mode')) { $askModes = @(SetOf $askParams['Mode']) }
Yes 'Request-Restart.ps1 takes both modes the deploy offers' ($askModes -contains 'notice' -and $askModes -contains 'restart')

# ---- stand-ins -------------------------------------------------------------------
$work = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-devwarn-' + [Guid]::NewGuid().ToString('N'))
# The deploy runs from scripts\deploy and finds Request-Restart.ps1 in
# scripts\vps beside it, since phase 8 of issue #440.
$askDir = Join-Path $work 'scripts\deploy'
$vpsDir = Join-Path $work 'scripts\vps'
$noAskDir = Join-Path $work 'empty\deploy'
New-Item -ItemType Directory -Path $askDir, $vpsDir, $noAskDir -Force | Out-Null
$askLog = Join-Path $vpsDir 'asked.txt'

$stub = $askAst.ParamBlock.Extent.Text + "`r`n" + @'
$rec = [ordered]@{
    Minutes = $Minutes; Mode = $Mode; Why = $Why; Data = $Data; Vps = $Vps; User = $User
    RestartFollows = [bool]$RestartFollows; ThenRestart = [bool]$ThenRestart; Cancel = [bool]$Cancel
}
Add-Content -LiteralPath (Join-Path $PSScriptRoot 'asked.txt') -Value ($rec | ConvertTo-Json -Compress)
exit [int]$env:THORNSWOOD_TEST_ASK_EXIT
'@
[IO.File]::WriteAllText((Join-Path $vpsDir 'Request-Restart.ps1'), $stub, (New-Object Text.UTF8Encoding($false)))

# What the functions read from the deploy's own scope. The address is one that
# cannot resolve, so that even a stand-in that failed to take would reach nothing.
$Root    = 'C:/Thornswood-Server-Dev'
$rootWin = 'C:\Thornswood-Server-Dev'
$Vps     = 'thornswood-test.invalid'
$User    = 'nobody'
$Here    = $askDir
$Minutes = 1
$Mode    = 'notice'
$Why     = 'a gamemode update'
$Now     = $false

# Each canned answer is one read of the box, its lines joined with a bar. The
# last one repeats for every read after it, the way a room that does not change
# keeps answering the same.
$script:canned = @()
$script:local = $false
$script:reads = 0
$script:sent = @()
function Remote($text) {
    $script:reads++
    $script:sent += , $text
    if ($script:local) { return RunHere $text }
    $i = [Math]::Min($script:reads, $script:canned.Count) - 1
    return @($script:canned[$i] -split '\|')
}

. (Join-Path $PSScriptRoot 'Windows.ps1')
# The read asks the box what is on the game port with Get-NetUDPEndpoint, a
# Windows cmdlet. Off Windows the far side gets one of the same name that
# lists the same thing, the UDP listeners, from .NET, so what it answers is
# still this machine's own ports.
$udpStandIn = ''
# The far side runs in PowerShell 7, as on the box since #5356.
$boxPs = Get-BoxPowerShell
if (-not $OnWindows) {
    Write-Host 'NOTE  Get-NetUDPEndpoint, which only Windows has, is a stand-in here that lists the UDP listeners through .NET'
    $udpStandIn = @'
function Get-NetUDPEndpoint {
  foreach ($e in [Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveUdpListeners()) {
    [pscustomobject]@{ LocalAddress = [string]$e.Address; LocalPort = $e.Port }
  }
}

'@
}
function RunHere($text) {
    # The same hop the real Remote makes, base64 of UTF-16 into -EncodedCommand,
    # without the ssh in front of it. Continue, so an error the far end prints
    # comes back as a line, the way ssh hands it back, rather than stopping here.
    $ErrorActionPreference = 'Continue'
    $text = $udpStandIn + $text
    $e = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($text))
    return @(& $boxPs -NoProfile -NonInteractive -EncodedCommand $e 2>&1 | ForEach-Object { [string]$_ })
}

$script:clock = [datetime]'2026-09-24T20:00:00'
$script:slept = 0
function Get-Date { return $script:clock }
function Start-Sleep { param([int]$Seconds) $script:slept += $Seconds; $script:clock = $script:clock.AddSeconds($Seconds) }

Invoke-Expression $block

$script:out = New-Object System.Collections.Generic.List[string]
$script:threw = ''
function Drive([string[]]$answers, [int]$askExit = 0) {
    $script:canned = $answers
    $script:reads = 0
    $script:sent = @()
    $script:slept = 0
    $script:threw = ''
    $script:out.Clear()
    $env:THORNSWOOD_TEST_ASK_EXIT = [string]$askExit
    if (Test-Path -LiteralPath $askLog) { Remove-Item -LiteralPath $askLog -Force }
    try {
        Warn-DevRoom 6>&1 | ForEach-Object { $script:out.Add([string]$_) }
    } catch {
        $script:threw = $_.Exception.Message
    }
}
function Asked {
    if (-not (Test-Path -LiteralPath $askLog)) { return @() }
    return @(Get-Content -LiteralPath $askLog | Where-Object { $_ } | ForEach-Object { $_ | ConvertFrom-Json })
}
function Said([string]$pattern) {
    foreach ($l in $script:out) { if ($l -match $pattern) { return $true } }
    return $false
}

$dev    = 'PORT 7787|UP yes'
$down   = 'PORT 7787|UP no'
$devDat = 'DATA C:/Thornswood-Server-Dev/data'
$udp    = $null

try {
    # ---- the read, run the way the box would run it -------------------------------
    $box = Join-Path $work 'box'
    $boxData = Join-Path $box 'data'
    New-Item -ItemType Directory -Path $boxData -Force | Out-Null
    $settings = Join-Path $box 'server-settings.json'
    $online = Join-Path $boxData 'online.json'
    $rootWin = $box
    $script:local = $true
    $wantData = [IO.Path]::Combine($box, 'data').Replace('\', '/')

    # The server, as far as the read can tell: something on the game port. A
    # UDP socket on loopback, so no firewall is asked about it. A second one
    # is opened and closed for a port with nothing on it.
    $loop = New-Object System.Net.IPEndPoint([System.Net.IPAddress]::Loopback, 0)
    $udp = New-Object System.Net.Sockets.UdpClient($loop)
    $upPort = $udp.Client.LocalEndPoint.Port
    $gone = New-Object System.Net.Sockets.UdpClient($loop)
    $downPort = $gone.Client.LocalEndPoint.Port
    $gone.Close()

    [IO.File]::WriteAllText($settings, ('{"port":' + $upPort + ',"name":"Thornswood Dev","dataDir":"data"}'))
    [IO.File]::WriteAllText($online, '{"now":3,"at":1790000000000,"restarting":false}')
    $script:reads = 0
    $r = Get-DevRoom
    Yes "the box's own settings give the port (got $($r.Port))" ($r.Port -eq $upPort)
    Yes "and the data folder the gamemode writes online.json to (got $($r.Data))" ($r.Data -eq $wantData)
    Yes "and online.json gives the head count (got $($r.Online))" ($r.Online -eq 3)
    Yes 'and it sees the server on its port' ($r['Up'] -eq $true)
    Yes 'a gamemode older than the names file gives no names, and the count stands alone' (
        @($r.Names).Count -eq 0 -and $r.Online -eq 3)

    # Issue #520: who, not just how many. The names live in the private
    # folder, never beside online.json, which is served to anybody who asks.
    $boxPriv = Join-Path $box 'private'
    New-Item -ItemType Directory -Path $boxPriv -Force | Out-Null
    $namesFile = Join-Path $boxPriv 'online-names.json'
    [IO.File]::WriteAllText($namesFile, '{"at":1790000000000,"names":["Ahlam","Brynjolf","Camilla"]}')
    $r = Get-DevRoom
    Yes "the private online-names.json gives who is on (got $(@($r.Names) -join ', '))" (
        (@($r.Names) -join ',') -eq 'Ahlam,Brynjolf,Camilla')
    Yes 'and the names do not stand in for the count' ($r.Online -eq 3)
    [IO.File]::WriteAllText($namesFile, '{"at":17')
    $r = Get-DevRoom
    Yes 'a half written names file is no names, and the count still reads' (
        @($r.Names).Count -eq 0 -and $r.Online -eq 3)
    Yes '  and is said in a note, which it was not in a try with an empty catch (#2711)' (@($r.Notes | Where-Object { $_ -match 'online-names\.json does not read' }).Count -eq 1)
    Remove-Item -LiteralPath $namesFile -Force
    $r = Get-DevRoom
    Yes '  while no names file at all is no note' (@($r.Notes).Count -eq 0 -and $r.Online -eq 3)
    [IO.File]::WriteAllText($namesFile, '{"at":1790000000000,"names":["Ahlam","Brynjolf","Camilla"]}')

    Remove-Item -LiteralPath $online -Force
    $r = Get-DevRoom
    Yes 'no online.json is a server that never ran there, so nobody' ($r.Online -eq 0)

    [IO.File]::WriteAllText($online, '{"now":3,"at')
    $r = Get-DevRoom
    Yes 'a half written online.json is unknown, not nobody' ($r.Online -eq -1)

    # Windows PowerShell reads an empty file as no object at all rather than an
    # error, and the first cut of this read turned that into nobody on. The
    # gamemode writes the file whole since #2740, but an empty one still means
    # nothing is known.
    [IO.File]::WriteAllText($online, '')
    $r = Get-DevRoom
    Yes 'an empty one is unknown too, not nobody' ($r.Online -eq -1)

    [IO.File]::WriteAllText($online, '{"at":1790000000000}')
    $r = Get-DevRoom
    Yes 'and so is one with no count in it' ($r.Online -eq -1)

    $elsewhere = Join-Path $work 'elsewhere'
    New-Item -ItemType Directory -Path $elsewhere -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $elsewhere 'online.json'), '{"now":5}')
    $json = (@{ port = $upPort; dataDir = $elsewhere } | ConvertTo-Json -Compress)
    [IO.File]::WriteAllText($settings, $json)
    $r = Get-DevRoom
    Yes 'a dataDir written as a full path is read where it points' (
        $r.Data -eq $elsewhere.Replace('\', '/') -and $r.Online -eq 5)

    # What the review measured: a count left behind by a process that is gone.
    [IO.File]::WriteAllText($settings, ('{"port":' + $downPort + ',"dataDir":"data"}'))
    [IO.File]::WriteAllText($online, '{"now":1,"at":1790000000000,"restarting":false}')
    $r = Get-DevRoom
    Yes "nothing on the port is read as nothing there (port $downPort)" ($r['Up'] -eq $false)
    Yes 'so a count left in online.json by a server that is gone is nobody on' ($r.Online -eq 0)
    Yes 'and the count it left is kept to say so' ($r['Stale'] -eq 1)
    Yes 'and the names it left are dropped with it' (@($r.Names).Count -eq 0)

    # And the stop, run here. The things that would stop a task or a process
    # are functions in front of the cmdlets, which PowerShell prefers, so
    # nothing on this machine is touched whatever is on that port.
    #
    # Since issue #446 the stop is StopOurs in Swap.ps1's swap block, the one
    # Deploy-Server sends to live, and the deploy sends that block rather than
    # a stop of its own. So the stop run here is that one, against the dev box.
    $lib = Get-Content -LiteralPath (Join-Path (Split-Path -Parent $deployPath) 'Swap.ps1') -Raw
    $la = $lib.IndexOf('# ==== deploy-server remote blocks ====')
    $lb = $lib.IndexOf('# ==== end deploy-server remote blocks ====')
    $swapBlock = ''
    if ($la -ge 0 -and $lb -gt $la) { $checkBlock = $null; Invoke-Expression $lib.Substring($la, $lb - $la) }
    $stopMatch = [regex]::Match($swapBlock, '(?ms)^function StopOurs \{.*?^\}\r?$')
    Yes 'the deploy sends Swap.ps1''s swap block, which carries the stop' (
        $src -match '\. \(Join-Path \$Here ''Swap\.ps1''\)' -and $src -match '\+ \$swapBlock\)')
    Yes 'the deploy has one stop block to run' ($stopMatch.Success)
    if ($stopMatch.Success) {
        $stopText = "`$Task = 'thornswood-test-no-such-task'`r`n`$Root = '" + $box.Replace("'", "''") + "'`r`n`$port = " + $upPort + "`r`n" +
                    $stopMatch.Value + "`r`nStopOurs`r`n'stopped'`r`n"
        $standIns = @'
function Stop-ScheduledTask { }
function Stop-Process { 'stand-in asked to stop ' + ($args -join ' ') }
function Get-NetUDPEndpoint { }
function Get-NetTCPConnection { }
function Get-ThornswoodProcessHeld { }
function Stop-ThornswoodProcessHeld { }
$ThornswoodNotHeld = @()
function Start-Sleep { }
function Held { $false }

'@
        $request = Join-Path $boxData 'restart.json'
        [IO.File]::WriteAllText($request, '{"seconds":60,"mode":"notice","why":"a gamemode update"}')
        $said = @(RunHere ($standIns + $stopText))
        Yes 'the stop removes a restart.json the old process never read' (-not (Test-Path -LiteralPath $request))
        Yes 'and says it did' (@($said | Where-Object { $_ -match 'removed a restart.json' }).Count -eq 1)
        Yes 'and leaves the rest of the data folder alone' (Test-Path -LiteralPath $online)
        Yes 'and still gets to the end' ($said -contains 'stopped')
        Yes 'with nothing on this machine stopped' (@($said | Where-Object { $_ -match 'stand-in asked' }).Count -eq 0)

        $said = @(RunHere ($standIns + $stopText))
        Yes 'with no restart.json there it says nothing about one' (
            @($said | Where-Object { $_ -match 'restart.json' }).Count -eq 0 -and $said -contains 'stopped')
    }

    Remove-Item -LiteralPath $settings -Force
    $r = Get-DevRoom
    Yes 'no settings on the box reads as no port, which the warning treats as unknown' ($r.Port -eq 0)

    $script:local = $false
    $rootWin = 'C:\Thornswood-Server-Dev'
    Yes 'what goes to the box stays well inside a command line' (
        ('powershell -NoProfile -EncodedCommand ' +
         [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script:sent[-1]))).Length -le 6000)

    # ---- nobody on ------------------------------------------------------------------
    Drive "$dev|$devDat|ONLINE 0"
    Yes 'nobody on: no warning is asked for' (@(Asked).Count -eq 0)
    Yes 'and there is no wait' ($script:slept -eq 0)
    Yes 'and it says so' (Said 'nobody is on the dev server')
    Yes 'and carries on to the stop' ($script:threw -eq '')

    # ---- a server that is not running ------------------------------------------------
    # What the review measured: online.json still saying one, nothing on the port.
    # Before this the deploy asked for a warning nobody could hear, waited the
    # full 80 seconds saying '1 still on', and left restart.json behind.
    Drive "$down|$devDat|ONLINE 1"
    Yes 'not running: no warning is asked for, whatever online.json says' (@(Asked).Count -eq 0)
    Yes 'and there is no wait' ($script:slept -eq 0)
    Yes 'and it says the server is not running' (Said 'not running')
    Yes 'and what online.json still says' (Said 'still says 1')
    Yes 'and carries on to the stop' ($script:threw -eq '')

    Drive "$down|$devDat|ONLINE unreadable"
    Yes 'not running with an unreadable count is still nobody, with no second look' (
        $script:threw -eq '' -and $script:reads -eq 1 -and @(Asked).Count -eq 0)

    Drive "PORT 7787|$devDat|ONLINE 2"
    Yes 'a box that could not list its ports keeps the count, and warns' (
        $script:threw -eq '' -and @(Asked).Count -eq 1)

    Drive "$dev|$devDat|ONLINE 2", "$down|$devDat|ONLINE 2"
    Yes "a server that goes down during the wait ends the wait (waited $($script:slept))" (
        $script:threw -eq '' -and $script:slept -eq 15)

    # ---- three on, the default notice -----------------------------------------------
    Drive "$dev|$devDat|ONLINE 3"
    $asked = @(Asked)
    Yes 'three on: it says how many before anything stops' (Said '^\s*3 on the dev server')

    Drive "$dev|$devDat|ONLINE 2|NAME Ahlam|NAME Brynjolf"
    Yes 'and with the names file there, it says who' (Said '^\s*2 \(Ahlam, Brynjolf\) on the dev server')
    Drive "$dev|$devDat|ONLINE 3"
    Yes 'Request-Restart is asked once' ($asked.Count -eq 1)
    if ($asked.Count -eq 1) {
        $q = $asked[0]
        Yes 'for a notice' ($q.Mode -eq 'notice')
        Yes 'of one minute' ([double]$q.Minutes -eq 1)
        Yes 'into the dev data folder the box named, where the dev gamemode looks for restart.json' (
            $q.Data -eq 'C:/Thornswood-Server-Dev/data')
        Yes 'with -RestartFollows, because this deploy is the restart' ($q.RestartFollows -eq $true)
        Yes 'and never -ThenRestart, which would bounce it a second time' ($q.ThenRestart -eq $false)
        Yes 'on the same box and account as the rest of the deploy' ($q.Vps -eq $Vps -and $q.User -eq $User)
        Yes 'with the reason' ($q.Why -eq 'a gamemode update')
    }
    Yes "it waits the minute and Deploy-Server's twenty seconds (waited $($script:slept))" ($script:slept -eq 80)
    Yes 'and then goes on to the stop' ($script:threw -eq '' -and (Said 'countdown has run out'))

    $Minutes = 3
    Drive "$dev|$devDat|ONLINE 2"
    $asked = @(Asked)
    Yes "-Minutes 3 waits three minutes and twenty seconds (waited $($script:slept))" ($script:slept -eq 200)
    Yes 'and asks for three' ($asked.Count -eq 1 -and [double]$asked[0].Minutes -eq 3)
    $Minutes = 1

    # ---- restart, and the room empties -----------------------------------------------
    $Mode = 'restart'
    Drive "$dev|$devDat|ONLINE 2", "$dev|$devDat|ONLINE 1", "$dev|$devDat|ONLINE 0"
    $asked = @(Asked)
    Yes '-Mode restart asks for a restart' ($asked.Count -eq 1 -and $asked[0].Mode -eq 'restart')
    Yes 'and still promises the restart follows' ($asked.Count -eq 1 -and $asked[0].RestartFollows -eq $true)
    Yes "it stops waiting the moment the room is empty (waited $($script:slept))" ($script:slept -eq 30)
    Yes 'and says who was still on while it waited' (Said '1 still on')
    $Mode = 'notice'

    # ---- the warning does not go out ---------------------------------------------------
    Drive "$dev|$devDat|ONLINE 3" 1
    Yes 'a warning that failed stops the deploy' ($script:threw -match 'did not go out')
    Yes 'before any wait, so the dev server is left as it was' ($script:slept -eq 0)
    Yes 'and says so in words' (Said 'THE WARNING DID NOT GO OUT')

    $Here = $noAskDir
    Drive "$dev|$devDat|ONLINE 3"
    Yes 'no Request-Restart.ps1 beside it stops the deploy rather than dropping them unwarned' (
        $script:threw -match 'did not go out')
    $Here = $askDir

    # ---- cannot tell who is on ------------------------------------------------------------
    Drive "$dev|$devDat|ONLINE unreadable"
    Yes 'an unreadable count is looked at once (#2740: the gamemode writes it whole, so no second look)' ($script:reads -eq 1)
    Yes 'and then stops the deploy rather than guessing nobody' ($script:threw -match 'could not read who is on')
    Yes 'without warning anybody' (@(Asked).Count -eq 0)

    Drive "$dev|$devDat|ONLINE unreadable", "$dev|$devDat|ONLINE 2"
    Yes 'a count that would read a moment later is not asked for: the two-second second look is gone' (
        $script:reads -eq 1 -and $script:threw -match 'could not read who is on' -and @(Asked).Count -eq 0)

    Drive 'ssh: Could not resolve hostname'
    Yes 'a box that does not answer at all stops the deploy' ($script:threw -match 'could not read who is on')
    Yes 'and shows what came back' (Said 'Could not resolve hostname')

    # ---- the live server --------------------------------------------------------------------
    Drive 'PORT 7777|DATA C:/Thornswood-Server/data|ONLINE 9'
    Yes 'a root on 7777 is refused before the live room is told anything' (
        $script:threw -match '7777' -and @(Asked).Count -eq 0)

    # ---- -Now, which is how it used to behave -------------------------------------------------
    $Now = $true
    Drive "$dev|$devDat|ONLINE 2"
    Yes '-Now warns nobody' (@(Asked).Count -eq 0)
    Yes 'and waits for nobody' ($script:slept -eq 0)
    Yes 'but still says who it is about to drop' (Said '-Now: 2 on the dev server')
    Yes 'and goes on to the stop' ($script:threw -eq '')

    Drive 'ssh: Could not resolve hostname'
    Yes '-Now goes on even when it cannot tell who is on' ($script:threw -eq '' -and $script:slept -eq 0)
    $Now = $false
}
finally {
    if ($udp) { $udp.Close() }
    Remove-Item Env:\THORNSWOOD_TEST_ASK_EXIT -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

Done
