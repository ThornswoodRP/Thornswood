<#
  test-prove-secret.ps1

  scripts\vps\Prove-SecretOffCommandLines.ps1 says NOT FOUND for a run that
  sends a secret the Send-Secret way, FOUND for one that sends it the old way,
  and never prints the value or a command line (issue #1212).

      pwsh -NoProfile -File .\tests\test-prove-secret.ps1

  HOW. The same stand-in for the VPS as tests\test-secret-channel.ps1: ssh is
  a fake that runs the command line through cmd.exe on this machine with the
  same standard input, which is what sshd on the VPS does. The watcher is
  started through a fake ssh.cmd (the script starts ssh as a process, so a
  PowerShell function cannot stand in for it); the runs being proved use a
  fake ssh function, as Send-Secret's callers would reach the real one. So the
  watcher reads this machine's real process list while PowerShell 7 runs
  what would run on the box.

  The value is made here at run time from a fresh GUID, with quotes, a dollar,
  a backtick, an ampersand and an accent in it. Nothing prints it.

  Never connects to anything.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent $Here

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

$prove = Join-Path $repo 'scripts\vps\Prove-SecretOffCommandLines.ps1'
$helper = Join-Path $repo 'scripts\vps\Send-Secret.ps1'
Yes 'scripts\vps\Prove-SecretOffCommandLines.ps1 is there' (Test-Path -LiteralPath $prove)
foreach ($f in @($prove, $helper)) {
    $errs = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile($f, [ref]$null, [ref]$errs)
    Yes ((Split-Path -Leaf $f) + ' parses') (@($errs).Count -eq 0)
}
. $helper

. (Join-Path $PSScriptRoot 'Windows.ps1')
if (-not $OnWindows) {
    Write-Host 'SKIP  the rest: it runs as the box does, through cmd.exe, and the watcher reads Windows'' process list and waits on a Global\ named event, which only Windows has'
    Done
}
$boxPs = Get-BoxPowerShell
# Global: the runs' ssh below is called from closures, which find only what
# the global scope holds.
$global:TsCmdExe = Get-WindowsPath 'System32\cmd.exe'

# ---- the fakes -----------------------------------------------------------
$work = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-prove-secret-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work -Force | Out-Null
$calls = Join-Path $work 'watcher-calls.txt'

# The watcher's ssh: keeps its whole command line, then runs the last
# argument (the remote command) with this process's standard input.
$fakeSsh = Join-Path $work 'ssh.cmd'
$cmd = @(
    '@echo off',
    ('echo %*>>"' + $calls + '"'),
    ':next',
    'if "%~2"=="" goto run',
    'shift',
    'goto next',
    ':run',
    '%~1'
) -join "`r`n"
[IO.File]::WriteAllText($fakeSsh, $cmd + "`r`n", (New-Object Text.ASCIIEncoding))
# An ssh that cannot reach the box.
$deadSsh = Join-Path $work 'dead.cmd'
[IO.File]::WriteAllText($deadSsh, "@echo off`r`nexit /b 255`r`n", (New-Object Text.ASCIIEncoding))

# The runs' ssh, as in test-secret-channel.ps1: the command line through
# cmd.exe with the same standard input. Global, because each run is a closure
# (GetNewClosure, so it carries this file's values in with it) and a closure
# finds commands from the global scope.
function global:ssh {
    $a = @($args | ForEach-Object { [string]$_ })
    $in = @($input)
    if ($in.Count) { $in | & $global:TsCmdExe /d /c $a[-1] }
    else { & $global:TsCmdExe /d /c $a[-1] }
}

$tick = [string][char]0x60
$secret = 'tw-' + [Guid]::NewGuid().ToString('N') + ' q''s "d" $x ' + $tick + 'y & | ^ % < > ' + [string][char]0x00E9
$wire = ConvertTo-ThornswoodSecretWire $secret
$wide = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($secret))
$secure = ConvertTo-SecureString $secret -AsPlainText -Force

function Leaks([string]$text) { return $text.Contains($secret) -or $text.Contains($wire) -or $text.Contains($wide) }

# Proves one run; hands back what it printed, its exit code and how long it took.
function Prove([scriptblock]$run, [string[]]$sshCommand = @($fakeSsh), $value = $secure, [int]$max = 120) {
    $global:LASTEXITCODE = 99
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $out = @(& $prove -Run $run -Secret $value -VpsHost 'box.invalid' -VpsUser 'tester' -MaxSeconds $max -SshCommand $sshCommand *>&1 | ForEach-Object { "$_" })
    return [pscustomobject]@{ Out = ($out -join "`n"); Code = $LASTEXITCODE; Seconds = $sw.Elapsed.TotalSeconds }
}

try {
    # ---- 1. the Send-Secret way: the value on standard input
    $r = Prove {
        . $helper
        $global:ranOut = Invoke-ThornswoodSecretRemote -Target 'tester@box.invalid' -SshArgs @('-o', 'BatchMode=yes') -Secret $secret -Script @'
Start-Sleep -Seconds 2
'GOT ' + ([string]$ThornswoodSecret).Length
'@
    }.GetNewClosure()
    Yes 'Send-Secret way: the run ran and its far side got a value' (@($global:ranOut | Where-Object { "$_" -like 'GOT *' -and "$_" -ne 'GOT 0' }).Count -eq 1)
    Yes 'Send-Secret way: says NOT FOUND' ($r.Out -match '(?m)^NOT FOUND ')
    Yes 'Send-Secret way: exit code 0' ($r.Code -eq 0)
    Yes 'Send-Secret way: it read some command lines' ($r.Out -match '\((\d+) process command lines read\)' -and [int]$Matches[1] -gt 0)
    Yes 'Send-Secret way: prints neither the value nor its base64' (-not (Leaks $r.Out))
    Yes 'Send-Secret way: prints no command line' ($r.Out -notmatch 'EncodedCommand|pwsh -|powershell -|cmd\.exe')
    # The watcher no longer reads standard input after the value, so only its
    # stop event ends it before the 120 second limit (#2912).
    Yes 'Send-Secret way: the stop event ends the watch when the run is over, not at the limit' ($r.Seconds -lt 60 -and $r.Out -notmatch 'did not reach')

    # ---- 2. control, the old way: the value base64'd into the command line.
    # It must say FOUND, or the watcher is known to see nothing.
    $r = Prove {
        $e = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes("`$s = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('$wire'))`r`nStart-Sleep -Seconds 2"))
        $global:oldOut = @(& ssh 'tester@box.invalid' "pwsh -NoProfile -EncodedCommand $e")
    }.GetNewClosure()
    Yes 'control, the old way: says FOUND' ($r.Out -match '(?m)^FOUND\s+\d+ processes')
    Yes 'control, the old way: exit code 1' ($r.Code -eq 1)
    Yes 'control, the old way: still prints neither the value nor its base64' (-not (Leaks $r.Out))
    Yes 'control, the old way: still prints no command line' ($r.Out -notmatch 'EncodedCommand|pwsh -|powershell -|cmd\.exe')

    # ---- 3. the watcher's and the stop's command lines hold their scripts and
    # nothing else, and each stop names its own watcher's event
    $sent = [IO.File]::ReadAllText($calls)
    $decoded = New-Object Text.StringBuilder
    $watchers = @(); $stops = @()
    foreach ($m in [regex]::Matches($sent, '-EncodedCommand ([A-Za-z0-9+/=]+)')) {
        $d = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($m.Groups[1].Value))
        [void]$decoded.AppendLine($d)
        $n = [regex]::Match($d, 'Global\\Thornswood-ProofStop-[0-9a-f]{32}').Value
        if ($d.Contains('WATCHER READY')) { $watchers += $n } elseif ($d.Contains('STOP SET')) { $stops += $n }
    }
    Yes 'the watcher and its stop went up twice each, with host key checking on' (([regex]::Matches($sent, 'StrictHostKeyChecking=yes tester@box\.invalid')).Count -eq 4 -and $watchers.Count -eq 2 -and $stops.Count -eq 2)
    Yes 'each stop sets its own watcher''s event, a new one each run' ($watchers.Count -eq 2 -and $watchers[0] -and $watchers[1] -and $watchers[0] -eq $stops[0] -and $watchers[1] -eq $stops[1] -and $watchers[0] -ne $watchers[1])
    Yes 'the watcher''s and the stop''s command lines hold neither the value nor its base64, decoded or not' (-not (Leaks $sent) -and -not (Leaks $decoded.ToString()))

    # ---- 4. no value, nothing started
    $before = [IO.File]::ReadAllText($calls)
    $refused = $null
    try { Prove { throw 'must not run' } -value (New-Object Security.SecureString) | Out-Null } catch { $refused = $_ }
    Yes 'an empty value is refused before anything starts' ($null -ne $refused -and [IO.File]::ReadAllText($calls) -eq $before)

    # ---- 4b. a watcher that reads no command lines proves nothing (#1263):
    # NOT FOUND over none is not a NOT FOUND.
    $blind = Join-Path $work 'blind.cmd'
    [IO.File]::WriteAllText($blind, "@echo off`r`necho WATCHER READY`r`nmore >nul`r`necho WATCHER NOT FOUND`r`necho WATCHER READ 0`r`n", (New-Object Text.ASCIIEncoding))
    $r = Prove { 'ran' } -sshCommand @($blind)
    Yes 'a watcher that read nothing: no NOT FOUND, exit code 2' ($r.Out -notmatch '(?m)^NOT FOUND' -and $r.Out -match 'read no command lines' -and $r.Code -eq 2)

    # ---- 5. a watcher that never starts: the run is not run, exit code 2
    $global:wasRun = $false
    $r = Prove { $global:wasRun = $true } -sshCommand @($deadSsh)
    Yes 'no watcher: the run is not run' (-not $global:wasRun)
    Yes 'no watcher: says nothing is proved, exit code 2' ($r.Out -match 'did not start' -and $r.Code -eq 2)

    # ---- 5b. the same, without the race (#2959). Whether the dead ssh above
    # ends before the value is written or after is up to the machine; here it
    # has ended for certain, so the write meets a pipe already closed. That is
    # the watcher not starting, not an error that stops the script; anything
    # else still throws.
    $ast = [Management.Automation.Language.Parser]::ParseFile($prove, [ref]$null, [ref]$null)
    $fn = $ast.Find({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Send-ThornswoodProofValue' }, $true)
    . ([scriptblock]::Create($fn.Extent.Text))
    function Start-Ssh([bool]$redirect) {
        $psi = New-Object Diagnostics.ProcessStartInfo
        $psi.FileName = $deadSsh
        $psi.UseShellExecute = $false
        $psi.RedirectStandardInput = $redirect
        $psi.CreateNoWindow = $true
        $p = [Diagnostics.Process]::Start($psi)
        $p.WaitForExit()
        return $p
    }
    $sent = $null; $threw = ''
    try { $sent = Send-ThornswoodProofValue (Start-Ssh $true) $wire } catch { $threw = $_.Exception.Message }
    Yes 'an ssh that has already ended: the value is not sent, and nothing throws' ($sent -eq $false -and -not $threw)
    $threw = ''
    try { $null = Send-ThornswoodProofValue (Start-Ssh $false) $wire } catch { $threw = $_.Exception.Message }
    Yes '  but any other failure to write still throws' ([bool]$threw)

    # ---- 6. the watcher ends with standard input still open (#451, #2912).
    # The fake ssh above passes the end of standard input on; the VPS's
    # OpenSSH passes on nothing written after the session starts, and the
    # watcher never answered until its limit. Here it runs straight in
    # PowerShell 7 with its standard input left open, as on the box: its
    # stop event must end it, set by the same script the second ssh session
    # runs, and so must its time limit with nothing set at all.
    $ast = [Management.Automation.Language.Parser]::ParseFile($prove, [ref]$null, [ref]$null)
    foreach ($name in 'Get-ThornswoodSecretWatcher', 'Get-ThornswoodSecretWatcherStop') {
        $fn = $ast.Find({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name }.GetNewClosure(), $true)
        . ([scriptblock]::Create($fn.Extent.Text))
    }
    function Run-Ps([string]$script, [bool]$keepOpen) {
        $psi = New-Object Diagnostics.ProcessStartInfo
        $psi.FileName = $boxPs
        $psi.Arguments = '-NoProfile -EncodedCommand ' + [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script))
        $psi.UseShellExecute = $false
        $psi.RedirectStandardInput = $true
        $psi.RedirectStandardOutput = $true
        $psi.CreateNoWindow = $true
        $p = [Diagnostics.Process]::Start($psi)
        if (-not $keepOpen) { $p.StandardInput.Close() }
        return $p
    }
    function Watch-Open([int]$seconds, [bool]$stopIt, [string]$name = ('Global\Thornswood-ProofStop-' + [Guid]::NewGuid().ToString('N'))) {
        $p = Run-Ps (Get-ThornswoodSecretWatcher $seconds $name) $true
        $o = $p.StandardOutput.ReadToEndAsync()
        $p.StandardInput.WriteLine($wire)
        $p.StandardInput.Flush()
        $set = ''
        if ($stopIt) {
            Start-Sleep -Seconds 2
            $s = Run-Ps (Get-ThornswoodSecretWatcherStop $name) $false
            $set = $s.StandardOutput.ReadToEnd()
            $s.WaitForExit()
        }
        $sw = [Diagnostics.Stopwatch]::StartNew()
        $ended = $p.WaitForExit(($seconds + 20) * 1000)
        if (-not $ended) { $p.Kill(); [void]$p.WaitForExit(5000) }
        return [pscustomobject]@{ Ended = $ended; Seconds = $sw.Elapsed.TotalSeconds; Out = $o.Result; Set = $set; Code = $p.ExitCode }
    }
    $w = Watch-Open 120 $true
    Yes 'standard input open: the stop script finds the event and sets it' ($w.Set -match '(?m)^STOP SET')
    Yes 'standard input open: the stop event ends the watcher well before its limit' ($w.Ended -and $w.Seconds -lt 30)
    Yes 'standard input open: after the stop it answers NOT FOUND over some command lines' ($w.Out -match 'WATCHER NOT FOUND' -and $w.Out -match 'WATCHER READ [1-9]')
    $w = Watch-Open 3 $false
    Yes 'standard input open, no stop: the time limit ends the watcher, and its PowerShell with it' $w.Ended
    Yes 'standard input open, no stop: it still answers' ($w.Out -match 'WATCHER NOT FOUND' -and $w.Out -match 'WATCHER READ [1-9]')
    $late = Run-Ps (Get-ThornswoodSecretWatcherStop ('Global\Thornswood-ProofStop-' + [Guid]::NewGuid().ToString('N'))) $false
    $lateSaid = $late.StandardOutput.ReadToEnd()
    $late.WaitForExit()
    Yes 'a stop after the watcher has ended says STOP GONE' ($lateSaid -match '(?m)^STOP GONE')

    # ---- 7. a stop name somebody made first: the watcher refuses it before it
    # says it is watching, so it cannot be stopped early from outside.
    $taken = 'Global\Thornswood-ProofStop-' + [Guid]::NewGuid().ToString('N')
    $squat = [Threading.EventWaitHandle]::new($false, [Threading.EventResetMode]::ManualReset, $taken)
    try { $w = Watch-Open 30 $false $taken }
    finally { $squat.Dispose() }
    Yes 'a stop name already taken: the watcher says so and never says it is watching' ($w.Ended -and $w.Seconds -lt 20 -and $w.Out -match 'WATCHER STOP TAKEN' -and $w.Out -notmatch 'WATCHER READY' -and $w.Code -eq 2)

    # ---- 8. a stop session that cannot reach the box: the watcher still
    # answers at its limit, and this side says the stop did not reach it.
    $once = Join-Path $work 'once.cmd'
    $mark = Join-Path $work 'once-used.txt'
    [IO.File]::WriteAllText($once, ("@echo off`r`nif exist `"" + $mark + "`" exit /b 255`r`n>`"" + $mark + "`" echo used`r`n" + ($cmd -replace '(?m)^@echo off\r?\n', '') + "`r`n"), (New-Object Text.ASCIIEncoding))
    $r = Prove { 'ran' } -sshCommand @($once) -max 5
    Yes 'the stop cannot reach the box: says so, and still answers NOT FOUND at the limit' ($r.Out -match 'stop did not reach' -and $r.Out -match '(?m)^NOT FOUND ' -and $r.Code -eq 0)
}
finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

Done
