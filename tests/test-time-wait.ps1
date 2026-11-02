<#
  test-time-wait.ps1

      pwsh -NoProfile -File .\tests\test-time-wait.ps1

  scripts\vps\Set-TimeWait.ps1 sends scripts\vps\vps-time-wait.ps1 to the box,
  which sets TcpTimedWaitDelay to 30 seconds and, with -Restart, restarts the
  box only while nobody is on the live or the dev server.

  WHY. Issue #2946, Patrick's A on q-2946-time-wait (21 Oct 2026): the box
  held each cloud connection it closed in TIME_WAIT for 120 s, the cloud's NAT
  gave the same address and port to a new connection sooner than that, and
  Windows dropped the new SYN about half the time. Windows reads the value
  only when it starts, so the fix is a restart, and a restart stops both
  servers: what matters most here is that it refuses while anybody is on, or
  while it cannot tell.

  HOW. NEVER CONNECTS. Two halves, the shape of tests\test-ssh-scope.ps1.

  The box half runs vps-time-wait.ps1 here with -Layer: stand-ins for every
  function in it that touches Windows (the registry value, the UDP ports, the
  restart), with the two server folders in a scratch folder that holds a real
  server-settings.json and online.json. It checks: -Check and a dry run
  change nothing; a real run sets 30 and reads it back; a second run says
  ALREADY; a read back that does not match stops it; -Restart restarts only
  when both rooms are empty, and refuses when somebody is on, when a count
  cannot be read, when the settings do not read and when the ports cannot be
  listed; a server that is not running counts as nobody on, whatever its
  online.json says; it has nothing of its own to remove, since it is never
  written on the box (#3035). And that every command in it that changes or
  reads Windows sits inside a layer function.

  The machine half runs Set-TimeWait.ps1 with ssh, scp and ssh-keygen as
  stand-ins. ssh, given the script Send-Script.ps1 sends on its standard
  input, checks it carries the whole of vps-time-wait.ps1 and runs that file
  against the stand-in layer with the switches the script gave it. It
  checks: no pinned key, or no key login, means a refusal before anything is
  sent; nothing is ever copied to the box (#3035); -Check and -WhatIf run the
  box read only; a real
  -Restart waits for a later start time and then reads 30 back; a box that
  never comes back, or comes back without 30, exits 1; a box that refuses
  exits 1 without waiting.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent $Here
$Box = Join-Path $repo 'scripts\vps\vps-time-wait.ps1'
$Driver = Join-Path $repo 'scripts\vps\Set-TimeWait.ps1'

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-timewait-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
$utf8 = New-Object Text.UTF8Encoding($false)

$layerText = @'
function Get-ThornswoodBoxRefusal { return '' }
function Get-TimeWaitValue { return $global:Fake.value }
function Set-TimeWaitValue([int]$Value) {
    $global:Fake.log.Add('Set-TimeWaitValue ' + $Value)
    if ($global:Fake.sticks) { $global:Fake.value = $Value }
}
function Test-PortOpen([int]$Port) {
    if ($global:Fake.portsFail) { throw 'the CIM provider is not answering' }
    return [bool]$global:Fake.open[[string]$Port]
}
function Invoke-BoxRestart { $global:Fake.log.Add('Invoke-BoxRestart') }
$ServerRoots = @($global:Fake.roots)
'@
$Layer = Join-Path $tmp 'layer.ps1'
[IO.File]::WriteAllText($Layer, $layerText, $utf8)

function New-Room([string]$name, [int]$port, $online) {
    $root = Join-Path $tmp ($name + '-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path (Join-Path $root 'data') -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $root 'server-settings.json'), ('{"port":' + $port + ',"dataDir":"data"}'), $utf8)
    if ($null -ne $online) { [IO.File]::WriteAllText((Join-Path (Join-Path $root 'data') 'online.json'), $online, $utf8) }
    return $root
}
function New-Fake {
    $global:Fake = @{
        value = $null
        sticks = $true
        open = @{ '7777' = $true; '7787' = $true }
        portsFail = $false
        roots = @((New-Room 'live' 7777 '{"now":0,"max":12}'), (New-Room 'dev' 7787 '{"now":0}'))
        log = New-Object System.Collections.Generic.List[string]
    }
}
function Set-Online([int]$i, [string]$json) { [IO.File]::WriteAllText((Join-Path (Join-Path $global:Fake.roots[$i] 'data') 'online.json'), $json, $utf8) }

function Invoke-BoxHere([hashtable]$a) {
    $b = @{ Layer = $Layer }
    foreach ($k in $a.Keys) { $b[$k] = $a[$k] }
    $global:LASTEXITCODE = 0
    $out = @(& $Box @b 2>&1 | ForEach-Object { [string]$_ })
    return [pscustomobject]@{ Code = $LASTEXITCODE; Lines = $out }
}
function Has($lines, [string]$rx) { return (@($lines | Where-Object { $_ -match $rx }).Count -gt 0) }
function Restarted { return ($global:Fake.log -contains 'Invoke-BoxRestart') }

try {
    # =================================================================== the box ===
    $boxText = [IO.File]::ReadAllText($Box)
    $errs = $null; $tokens = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseInput($boxText, [ref]$tokens, [ref]$errs)
    Yes 'vps-time-wait.ps1 parses' (-not $errs -or $errs.Count -eq 0)
    Yes '  and is plain ASCII' (-not ($boxText.ToCharArray() | Where-Object { [int]$_ -gt 127 }))
    $driverText = [IO.File]::ReadAllText($Driver)
    Yes 'Set-TimeWait.ps1 is plain ASCII too' (-not ($driverText.ToCharArray() | Where-Object { [int]$_ -gt 127 }))
    Yes '  and sets 30 seconds, the lowest Windows takes' ($boxText -match '\$Seconds = 30\r?\n')

    $layerNames = @('Get-ThornswoodBoxRefusal', 'Get-TimeWaitValue', 'Set-TimeWaitValue', 'Test-PortOpen', 'Invoke-BoxRestart')
    $defined = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true) | ForEach-Object { $_.Name })
    Yes 'every layer function the stand-in replaces is defined in it' (@($layerNames | Where-Object { $defined -notcontains $_ }).Count -eq 0)
    $fakeAst = [System.Management.Automation.Language.Parser]::ParseInput($layerText, [ref]$null, [ref]$null)
    $fakeNames = @($fakeAst.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true) | ForEach-Object { $_.Name })
    Yes '  and the stand-in replaces every one of them' (@($layerNames | Where-Object { $fakeNames -notcontains $_ }).Count -eq 0)
    $touchers = 'Get-ItemProperty', 'New-ItemProperty', 'Set-ItemProperty', 'Remove-ItemProperty', 'Get-NetUDPEndpoint', 'Get-NetTCPConnection', 'Restart-Computer', 'Stop-Computer', 'Get-CimInstance'
    $loose = @()
    foreach ($c in $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true)) {
        $name = $c.GetCommandName()
        if (-not $name -or $touchers -notcontains $name) { continue }
        $p = $c.Parent
        while ($p -and -not ($p -is [System.Management.Automation.Language.FunctionDefinitionAst])) { $p = $p.Parent }
        if (-not $p -or $layerNames -notcontains $p.Name) { $loose += ('{0} at line {1}' -f $name, $c.Extent.StartLineNumber) }
    }
    Yes ('every command in it that touches Windows is inside a layer function' + $(if ($loose.Count) { ': ' + ($loose -join ', ') } else { '' })) ($loose.Count -eq 0)

    # ---- reading and setting the value --------------------------------------------
    New-Fake
    $r = Invoke-BoxHere @{ Check = $true }
    Yes '-Check with no value: exit 0, says the default of 120 applies, changes nothing' ($r.Code -eq 0 -and (Has $r.Lines '^NOW TcpTimedWaitDelay is not set, so Windows holds TIME_WAIT for its default of 120 seconds$') -and $global:Fake.log.Count -eq 0 -and $r.Lines.Count -eq 1)
    Yes '  and has nothing of its own to delete, since it is never written on the box (#3035)' ($boxText -notmatch 'PSCommandPath|KeepSelf')

    New-Fake
    $r = Invoke-BoxHere @{ DryRun = $true }
    Yes 'dry run: exit 0, WOULD set 30, changes nothing' ($r.Code -eq 0 -and (Has $r.Lines '^WOULD set TcpTimedWaitDelay to 30 seconds$') -and $global:Fake.log.Count -eq 0 -and $null -eq $global:Fake.value)

    New-Fake
    $r = Invoke-BoxHere @{}
    Yes 'real run: sets 30, reads it back, says CHANGED' ($r.Code -eq 0 -and $global:Fake.value -eq 30 -and (Has $r.Lines '^CHANGED TcpTimedWaitDelay is 30 seconds$') -and ($global:Fake.log -join ',') -eq 'Set-TimeWaitValue 30')
    Yes '  says a restart is still needed, and does not restart' ((Has $r.Lines '^NOTE Windows reads it only when it starts') -and -not (Restarted))
    $r = Invoke-BoxHere @{}
    Yes 'second run: ALREADY, nothing set' ($r.Code -eq 0 -and (Has $r.Lines '^NOW TcpTimedWaitDelay is 30 seconds$') -and (Has $r.Lines '^ALREADY TcpTimedWaitDelay is 30 seconds$') -and $global:Fake.log.Count -eq 1)

    New-Fake
    $global:Fake.value = 120
    $r = Invoke-BoxHere @{}
    Yes 'a value already set to something else is set to 30' ($r.Code -eq 0 -and (Has $r.Lines '^NOW TcpTimedWaitDelay is 120 seconds$') -and $global:Fake.value -eq 30)

    New-Fake
    $global:Fake.sticks = $false
    $r = Invoke-BoxHere @{ Restart = $true }
    Yes 'a read back that does not match: STOP, exit 1, no restart' ($r.Code -eq 1 -and (Has $r.Lines "^STOP TcpTimedWaitDelay reads back as '', not 30\. Nothing restarted\.$") -and -not (Restarted))

    # ---- the restart, only with both rooms empty ------------------------------------
    New-Fake
    $r = Invoke-BoxHere @{ Restart = $true; DryRun = $true }
    Yes '-Restart -DryRun: reads both rooms, WOULD restart, changes nothing' ($r.Code -eq 0 -and @($r.Lines | Where-Object { $_ -match '^ROOM .*: running, 0 on$' }).Count -eq 2 -and
        $r.Lines[-1] -eq 'WOULD restart the box' -and $global:Fake.log.Count -eq 0)

    New-Fake
    $r = Invoke-BoxHere @{ Restart = $true }
    Yes '-Restart with nobody on: sets 30, then restarts, and says RESTARTING last' ($r.Code -eq 0 -and ($global:Fake.log -join ',') -eq 'Set-TimeWaitValue 30,Invoke-BoxRestart' -and $r.Lines[-1] -match '^RESTARTING the box')

    New-Fake
    $global:Fake.value = 30
    $r = Invoke-BoxHere @{ Restart = $true }
    Yes '-Restart with the value already 30 still restarts, so Windows reads it' ($r.Code -eq 0 -and ($global:Fake.log -join ',') -eq 'Invoke-BoxRestart')

    New-Fake
    Set-Online 0 '{"now":2,"max":12}'
    $r = Invoke-BoxHere @{ Restart = $true }
    Yes 'somebody on the live server: STOP naming it, exit 1, no restart' ($r.Code -eq 1 -and (Has $r.Lines ('^STOP ' + [regex]::Escape($global:Fake.roots[0]) + ' has 2 on, so the box was not restarted')) -and -not (Restarted))
    Yes '  the value is still set, for the next restart' ($global:Fake.value -eq 30)

    New-Fake
    Set-Online 1 '{"now":1}'
    $r = Invoke-BoxHere @{ Restart = $true; DryRun = $true }
    Yes 'somebody on the dev server, in a dry run: STOP as well' ($r.Code -eq 1 -and (Has $r.Lines 'has 1 on, so the box was not restarted') -and -not (Restarted))

    New-Fake
    Set-Online 0 '{"now":3}'
    $global:Fake.open['7777'] = $false
    $r = Invoke-BoxHere @{ Restart = $true }
    Yes 'a server that is not running is nobody on, whatever its online.json still says' ($r.Code -eq 0 -and (Has $r.Lines '^ROOM .*: not running, 0 on$') -and (Restarted))

    New-Fake
    Remove-Item -LiteralPath (Join-Path (Join-Path $global:Fake.roots[0] 'data') 'online.json')
    $r = Invoke-BoxHere @{ Restart = $true }
    Yes 'a running server with no online.json yet counts nobody on' ($r.Code -eq 0 -and (Restarted))

    foreach ($bad in '{"max":12}', 'not json', '') {
        New-Fake
        Set-Online 0 $bad
        $r = Invoke-BoxHere @{ Restart = $true }
        Yes ("an online.json of '" + $bad + "': STOP, cannot say who is on, no restart") ($r.Code -eq 1 -and (Has $r.Lines 'cannot say who is on \(its online\.json does not read') -and -not (Restarted))
    }

    New-Fake
    [IO.File]::WriteAllText((Join-Path $global:Fake.roots[1] 'server-settings.json'), '{ broken', $utf8)
    $r = Invoke-BoxHere @{ Restart = $true }
    Yes 'a server-settings.json that does not read: STOP, no restart' ($r.Code -eq 1 -and (Has $r.Lines 'cannot say who is on \(its server-settings\.json does not read') -and -not (Restarted))

    New-Fake
    $global:Fake.portsFail = $true
    $r = Invoke-BoxHere @{ Restart = $true }
    Yes 'the UDP ports cannot be listed: STOP, no restart' ($r.Code -eq 1 -and (Has $r.Lines 'cannot say who is on \(its game port could not be listed') -and -not (Restarted))

    New-Fake
    $global:Fake.roots = @($global:Fake.roots[0], (Join-Path $tmp 'no-such-server'))
    $r = Invoke-BoxHere @{ Restart = $true }
    Yes 'a server folder that is not there counts nobody on' ($r.Code -eq 0 -and (Has $r.Lines '^ROOM .*no-such-server: not running, 0 on$') -and (Restarted))

    # ============================================================= the machine ===
    $vpsJson = Get-Content -LiteralPath (Join-Path $repo 'scripts\vps\vps.json') -Raw | ConvertFrom-Json
    $pin = [string]@($vpsJson.hostKeys)[0]
    $kh = Join-Path $tmp 'known_hosts'
    [IO.File]::WriteAllText($kh, "stand-in`n", $utf8)
    $far = Join-Path $tmp 'far'
    New-Item -ItemType Directory -Path $far -Force | Out-Null

    . (Join-Path $repo 'scripts\vps\Send-Script.ps1')
    $global:H = @{}
    function global:ssh-keygen {
        $a = @($args | ForEach-Object { [string]$_ })
        if ($a -contains '-F') { '# Host 127.0.0.1 found: line 1'; ('127.0.0.1 ED25519 ' + $global:H.HostFp); $global:LASTEXITCODE = 0; return }
        $global:LASTEXITCODE = 1
    }
    function global:scp {
        $WhatIfPreference = $false
        $a = @($args | ForEach-Object { [string]$_ })
        $global:H.Calls.Add('scp ' + ($a -join ' '))
        $leaf = ($a[-1] -split '/')[-1]
        Copy-Item -LiteralPath $a[-2] -Destination (Join-Path $global:H.Far $leaf) -Force
        $global:H.Sent = Join-Path $global:H.Far $leaf
        $global:LASTEXITCODE = 0
    }
    function global:ssh {
        $WhatIfPreference = $false
        $a = @($args | ForEach-Object { [string]$_ })
        $in = @($input | ForEach-Object { [string]$_ })
        $last = $a[-1]
        # The script as the box would run it: inline, or Send-Script.ps1's
        # runner on the line, which takes the copy scp put in the far folder
        # off it and runs that (#3059).
        $s = ''
        if ($last -match 'EncodedCommand (\S+)') {
            $s = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($Matches[1]))
            $rp = & $global:H.RunnerPath $s
            if ($rp) { $rf = Join-Path $global:H.Far ($rp -split '\\')[-1]; $s = [IO.File]::ReadAllText($rf); Remove-Item -LiteralPath $rf -Force }
        }
        # vps-time-wait.ps1 whole, as a block with its switches after it: the
        # file under test runs here with them, against the stand-in layer.
        $at = $s.IndexOf($global:H.BoxText)
        if ($at -ge 0) {
            $given = $s.Substring($at + $global:H.BoxText.Length).Trim().TrimStart('}').Trim()
            $global:H.Calls.Add(('ssh ' + (($a | Select-Object -SkipLast 1) -join ' ') + ' BOX ' + $given).TrimEnd())
            $sw = @{ Layer = $global:H.Layer }
            foreach ($w in @($given -split ' ' | Where-Object { $_ })) {
                if ($w -notmatch '^-(Check|Restart|DryRun)$') { $global:H.Calls.Add('ssh UNREAD ' + $given); $global:LASTEXITCODE = 1; return }
                $sw[$w.TrimStart('-')] = $true
            }
            $out = @(& $global:H.Box @sw 2>&1 | ForEach-Object { [string]$_ })
            $code = $LASTEXITCODE
            $out
            # A restart cuts the session: ssh says so and exits 255.
            if (Restarted) { $global:H.Polls = 0; $global:H.Restarts++; 'Connection to 127.0.0.1 closed by remote host.'; $code = 255 }
            $global:LASTEXITCODE = $code; return
        }
        $global:H.Calls.Add('ssh ' + ($a -join ' '))
        if ($s) {
            if ($s -match 'LastBootUpTime') {
                if (-not $global:H.KeyWorks) { 'Administrator@127.0.0.1: Permission denied (publickey).'; $global:LASTEXITCODE = 255; return }
                if ($global:H.Restarts -gt 0) {
                    $global:H.Polls++
                    # Down for two polls, as a restarting box is, then up with a
                    # later start time, unless this box never comes back.
                    if ($global:H.Polls -le 2 -or $global:H.NeverBack) { 'ssh: connect to host 127.0.0.1 port 22: Connection refused'; $global:LASTEXITCODE = 255; return }
                    if ($global:H.ForgetsValue) { $global:Fake.value = $null }
                    $global:Fake.log.Clear()
                    'BOOT 2026-10-21T05:10:00Z'; $global:LASTEXITCODE = 0; return
                }
                'BOOT 2026-10-14T09:00:00Z'; $global:LASTEXITCODE = 0; return
            }
            if ($s -match "Get-ScheduledTask") { $global:H.Health = $true; 'task      Thornswood Server: Running'; 'port      7777: UDP open'; $global:LASTEXITCODE = 0; return }
            $global:LASTEXITCODE = 0; return
        }
        $global:LASTEXITCODE = 1
    }

    function Invoke-Driver([hashtable]$extra) {
        $a = @{ Vps = '127.0.0.1'; User = 'Administrator'; KnownHosts = $kh; PollSeconds = 0; BackMinutes = 1; NoPause = $true }
        foreach ($k in $extra.Keys) { $a[$k] = $extra[$k] }
        $global:LASTEXITCODE = 0
        $out = @(& $Driver @a 6>&1 2>&1 | ForEach-Object { [string]$_ })
        return [pscustomobject]@{ Code = $LASTEXITCODE; Lines = $out; Text = ($out -join "`n") }
    }
    function Fresh {
        New-Fake
        $global:H = @{ KeyWorks = $true; HostFp = $pin; Calls = (New-Object System.Collections.Generic.List[string]); Far = $far; Layer = $Layer; Sent = '';
                       Restarts = 0; Polls = 0; NeverBack = $false; ForgetsValue = $false; Health = $false
                       Box = $Box; BoxText = [IO.File]::ReadAllText($Box); RunnerPath = ${function:Get-ThornswoodRemoteRunnerPath} }
    }
    function BoxRuns { return @($global:H.Calls | Where-Object { $_ -match ' BOX( |$)' }) }

    Fresh
    $global:H.HostFp = 'SHA256:' + ('A' * 43)
    $r = Invoke-Driver @{ Restart = $true }
    Yes 'known_hosts without the pinned key: refused, exit 1, before any ssh' ($r.Code -eq 1 -and $r.Text -match 'does not hold the key' -and $global:H.Calls.Count -eq 0)

    Fresh
    $global:H.KeyWorks = $false
    $r = Invoke-Driver @{ Restart = $true }
    Yes 'no key login: refused, exit 1, nothing sent' ($r.Code -eq 1 -and $r.Text -match 'does not answer a key login' -and (BoxRuns).Count -eq 0 -and $global:Fake.log.Count -eq 0)

    Fresh
    $r = Invoke-Driver @{ Check = $true }
    Yes '-Check: exit 0, the box ran with -Check only, nothing changed' ($r.Code -eq 0 -and $r.Text -match 'NOW TcpTimedWaitDelay is not set' -and
        @(BoxRuns | Where-Object { $_ -match ' BOX -Check$' }).Count -eq 1 -and $global:Fake.log.Count -eq 0)
    Yes '  vps-time-wait.ps1 went whole by scp to a copy its run took off the box, so nothing of it is left there (#3035, #3059)' (
        $global:H.Sent -match 'thornswood-remote-[0-9a-f]{32}\.ps1$' -and @(Get-ChildItem -LiteralPath $global:H.Far -File).Count -eq 0 -and
        @($global:H.Calls | Where-Object { $_ -like 'scp *' }).Count -ge 1 -and @($global:H.Calls | Where-Object { $_ -match '-File |UNREAD' }).Count -eq 0)

    Fresh
    $r = Invoke-Driver @{ Check = $true; Restart = $true }
    Yes '-Check with -Restart: refused before anything is sent' ($r.Code -eq 1 -and $global:H.Calls.Count -eq 0)

    Fresh
    $r = Invoke-Driver @{ Restart = $true; WhatIf = $true }
    Yes '-Restart -WhatIf: exit 0, the box asked with -Restart -DryRun, nothing changed, no restart' ($r.Code -eq 0 -and
        @(BoxRuns | Where-Object { $_ -match ' BOX -Restart -DryRun$' }).Count -eq 1 -and $global:Fake.log.Count -eq 0 -and $r.Text -match 'WOULD restart the box' -and $r.Text -match 'Nothing was changed')

    Fresh
    $r = Invoke-Driver @{}
    Yes 'without -Restart: exit 0, the value set, no restart, no wait' ($r.Code -eq 0 -and $global:Fake.value -eq 30 -and -not (Restarted) -and $global:H.Restarts -eq 0 -and $r.Text -match 'NOTE Windows reads it only when it starts')

    Fresh
    $r = Invoke-Driver @{ Restart = $true }
    Yes '-Restart: exit 0, the box restarted once' ($r.Code -eq 0 -and $global:H.Restarts -eq 1)
    Yes '  it waited through the box being down for a later start time' ($global:H.Polls -eq 3 -and $r.Text -match 'the box started again at 2026-10-21T05:10:00Z')
    Yes '  and then read 30 back, and what started with it' ($r.Text -match '(?s)started again.*NOW TcpTimedWaitDelay is 30 seconds' -and $global:H.Health -and $r.Text -match 'task      Thornswood Server: Running')
    Yes '  every ssh and scp checked the host key' (@($global:H.Calls | Where-Object { $_ -notmatch 'StrictHostKeyChecking=yes' }).Count -eq 0)

    Fresh
    Set-Online 0 '{"now":4}'
    $r = Invoke-Driver @{ Restart = $true }
    Yes 'somebody on: exit 1, the box was not restarted, and it did not wait' ($r.Code -eq 1 -and $r.Text -match 'has 4 on' -and $r.Text -match 'It was not restarted' -and $global:H.Restarts -eq 0 -and $global:H.Polls -eq 0)

    Fresh
    $global:H.NeverBack = $true
    $r = Invoke-Driver @{ Restart = $true; BackMinutes = 0 }
    Yes 'a box that does not come back in time: exit 1, says to read it with -Check' ($r.Code -eq 1 -and $r.Text -match 'has not answered with a later start time in 0 minutes' -and $r.Text -match '-Check in a few minutes')

    Fresh
    $global:H.ForgetsValue = $true
    $r = Invoke-Driver @{ Restart = $true }
    Yes 'a box that comes back without 30: exit 1, says so' ($r.Code -eq 1 -and $r.Text -match 'does not read TcpTimedWaitDelay as 30 seconds' -and -not $global:H.Health)
}
finally {
    foreach ($f in 'ssh', 'scp', 'ssh-keygen') { Remove-Item -Path ("function:global:" + $f) -ErrorAction SilentlyContinue }
    Remove-Variable -Name Fake, H -Scope Global -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
