<#
  test-remote-big-script.ps1

  A 10 KB script is sent whole and runs to its last line, from every helper
  that sends one to the VPS.

  WHY THIS EXISTS. On the VPS a long command line arrives cut short, and the
  far end complains about a brace in a script nobody can see. Base64 of
  UTF-16 is about 2.7 times the script, so it takes only a few KB.
  Deploy-Docs.ps1 hit it on 17 September and Deploy-DevGamemode.ps1 on 20
  September, and sixteen scripts were given a guard that night that sends a
  long script as a file instead. Entry 197 on the To Do List asks for "the
  remote helper survives a 10 KB script". Since 21 Oct 2026 (issues #3027
  and #3059) a long script goes up by scp to a copy of its own name, and the
  short runner on the command line takes the copy off the box before it runs
  it, so a run that starts leaves nothing there.

  test-remote-length.ps1 reads the scripts and measures their blocks. This
  one sends. Each Remote function is lifted out of its script by text and
  called with a 10 KB script, and Remote.ps1, the helper that takes any
  script at all, is run whole with one.

  THE STAND-INS ARE A SMALL SSHD ON THIS MACHINE, NOT THE VPS. scp puts the
  copy in a scratch folder that stands for C:/Windows/Temp, and ssh hands the
  command to this machine's cmd.exe in that folder, with the runner's paths
  pointed at it. The runner's line is then run again under a PowerShell 7
  outer shell. Windows sshd uses
  cmd.exe unless it is set to another shell, and a PowerShell is the usual
  other one; the VPS's sshd started a command as powershell.exe -c on
  21 Oct 2026 (#3059), and the line it hands on starts pwsh since #5356.
  Off Windows there is no cmd.exe, so only the PowerShell 7 outer shell runs
  the line there. So what is proved is the helpers' mechanics: no command
  line is longer than cmd.exe takes, the script goes up whole in one copy and
  runs to its last line, what it printed comes back, the runner leaves
  nothing in the far temp folder, and the exit code is the script's. What the
  VPS itself does is not proved here.

  What the two shells showed on this machine on 24 September, when a long
  script still went as a file: the path bare ran under both, and the path in
  single quotes failed under cmd.exe ("The given path's format is not
  supported"). Since #3035 no script copies a file of its own up to run it
  with -File (Harden-VPS.ps1 and the like did); every script is still read
  below for that shape, so none goes back to the quoted form.

  It runs only what this harness sent, in the exact shapes the helpers send:
  its own two scripts inline, or the runner taking a copy that holds one of
  them. Anything else is written down and not run, and fails the check that
  expected it to.

  NEVER CONNECTS. It checks that ssh and scp resolve to the stand-ins before
  anything is sent, and stops if they do not. Every host it names ends in
  .invalid, which no resolver answers, so even a stand-in that failed to take
  would reach nothing.
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
. (Join-Path $PSScriptRoot 'Windows.ps1')

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Done {
    Remove-Item -Path function:global:ssh, function:global:scp, function:global:Invoke-TsFarEnd -ErrorAction SilentlyContinue
    if ($global:TsFar -and $global:TsFar.Disk -and (Test-Path -LiteralPath $global:TsFar.Disk)) {
        Remove-Item -LiteralPath $global:TsFar.Disk -Recurse -Force -ErrorAction SilentlyContinue
    }
    Remove-Variable -Name TsRemoteCalls, TsFar -Scope Global -ErrorAction SilentlyContinue
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}
# The far end runs what was sent in cmd.exe, as the box's sshd does, and
# again in PowerShell 7. Off Windows there is no cmd.exe, so what is sent is
# checked, and the line is run under PowerShell 7 alone (#2957).
function Runs([string]$what, [bool]$cond) { if ($OnWindows) { Yes $what $cond } }
if (-not $OnWindows) { Write-Host 'SKIP  the runs through cmd.exe at the far end: the box''s sshd hands a line to cmd.exe, which only Windows has, so off Windows only what is sent is checked and the line is run under PowerShell 7' }

# What cmd.exe will carry. Where the VPS cuts a line has not been measured;
# the helpers send anything over 6,000 characters by scp, for the runner.
$Limit = 8191

# What the helpers read to know where to send. None of it resolves.
$ssh = @('-o', 'BatchMode=yes', '-o', 'ConnectTimeout=1')
$User = 'nobody'
$Vps = 'thornswood-test.invalid'
$VpsUser = $User
$VpsHost = $Vps
$target = "$User@$Vps"

# ---- the scripts --------------------------------------------------------------
#
# The long one ends by exiting 7, so the code a helper hands back can be told
# from a 0 that says nothing.
$lines = New-Object System.Collections.Generic.List[string]
$n = 0
while (($lines -join "`r`n").Length -lt 10240) {
    $n++
    $lines.Add(("Write-Output 'line {0:d4} of a script too long for one command line'" -f $n))
}
$lastLine = ("line {0:d4} of a script too long for one command line" -f $n)
$big = ($lines -join "`r`n") + "`r`nexit 7"
$short = "Write-Output 'short and sent inline'"

# ---- the far end ----------------------------------------------------------------
$disk = Join-Path ([IO.Path]::GetTempPath()) ('ts-far-' + [Guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $disk -Force)
$global:TsFar = @{
    Temp    = 'C:/Windows/Temp/'
    Disk    = $disk
    Target  = $target
    Scripts = @($big, $short)
}
$global:TsRemoteCalls = New-Object System.Collections.ArrayList
# Knows the runner Send-Script.ps1 puts on the command line for a long
# script, and the copy it takes (#3059). What scp copied, by name, so a line
# run again under the other shell finds its copy as the first run did.
. (Join-Path $RepoPath 'scripts\vps\Send-Script.ps1')
$global:TsFar.RunnerPath = ${function:Get-ThornswoodRemoteRunnerPath}
$global:TsFar.Copied = @{}

# The far paths go bare, so what stands in for C:/Windows/Temp on the line has
# to be as bare as it is: a space or an & in it would fail a line for a reason
# the real path cannot have. The temp folder here may hold either (every temp
# file on the shipping machine went under C:\ThornswoodTemps&Worktrees until
# #2900, and
# cmd.exe ends a command at a bare &, issues #1042 and #1115). So the line
# names the stand-in folder as ./, and the shell runs in it: the folder's own
# path is never on a command line.
$global:TsFar.DiskFwd = './'

function global:Invoke-TsFarEnd([string]$command, [string]$shell, [string[]]$stdin = @()) {
    $far = $global:TsFar
    $said = New-Object System.Collections.ArrayList

    # Only what this harness sent, in the exact shapes the helpers send, so
    # nothing can be chained on for either shell to run: one of its own
    # scripts inline, or Send-Script.ps1's runner taking a copy that holds
    # one of them.
    $ok = $false
    $line = ''
    # -ExecutionPolicy Bypass as well: the runner's line always has it, and a
    # caller's -Bypass puts it on an inline one.
    $m = [regex]::Match($command, '^pwsh -NoProfile (-ExecutionPolicy Bypass )?-EncodedCommand ([A-Za-z0-9+/=]+)$')
    if ($m.Success) {
        $text = ''
        try { $text = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($m.Groups[2].Value)) } catch { }
        foreach ($s in $far.Scripts) { if ($text.EndsWith($s)) { $ok = $true; $line = $command } }
        $rp = & $far.RunnerPath $text
        $leaf = ($rp -split '\\')[-1]
        if ($rp -and $far.Copied.ContainsKey($leaf)) {
            # Contains, as for the file it once went as: Remote.ps1 -File
            # sends a file's text, which may end with a line break.
            foreach ($s in $far.Scripts) { if ($far.Copied[$leaf].Contains($s)) { $ok = $true } }
            # The runner as sent, its copy and the folder it clears pointed
            # at the stand-in folder. The path goes inside the encoded
            # command, so no shell sees it.
            $copy = Join-Path $far.Disk $leaf
            if (-not (Test-Path -LiteralPath $copy)) { [IO.File]::WriteAllText($copy, $far.Copied[$leaf], (New-Object Text.UTF8Encoding($false))) }
            $here = $text.Replace($rp, $copy).Replace("'C:\Windows\Temp'", ("'" + $far.Disk.Replace("'", "''") + "'"))
            $line = 'pwsh -NoProfile -ExecutionPolicy Bypass -EncodedCommand ' + [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($here))
        }
    }
    if (-not $ok) {
        [void]$said.Add('the stand-in did not run this: ' + $command)
        return [pscustomobject]@{ Out = @($said); Code = 1 }
    }

    # The line as it would arrive, the far folder swapped for ./ and the shell
    # started in the stand-in folder. Under cmd.exe, /d leaves out this machine's AutoRun, which belongs to
    # this machine and not to any server. Under PowerShell 7 the whole line is
    # its command; the shapes above hold no double quote to break the one
    # round it.
    if ($shell -ne 'pwsh' -and -not $OnWindows) { return [pscustomobject]@{ Out = @('not run: cmd.exe is not on this machine, which is not Windows'); Code = 0 } }
    $line = $line.Replace($far.Temp, $far.DiskFwd)
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    if ($shell -eq 'pwsh') {
        $psi.FileName = Get-BoxPowerShell
        $psi.Arguments = '-NoProfile -NonInteractive -Command "' + $line + '"'
    }
    else {
        $psi.FileName = Get-WindowsPath 'System32\cmd.exe'
        $psi.Arguments = '/d /c ' + $line
    }
    $psi.WorkingDirectory = $far.Disk
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $p = [System.Diagnostics.Process]::Start($psi)
    foreach ($l in $stdin) { $p.StandardInput.WriteLine($l) }
    $p.StandardInput.Close()
    $errTask = $p.StandardError.ReadToEndAsync()
    $stdout = $p.StandardOutput.ReadToEnd()
    $p.WaitForExit()
    $stderr = $errTask.Result
    foreach ($l in (($stdout + "`n" + $stderr) -split "`r?`n")) {
        if ($l.Trim()) { [void]$said.Add($l) }
    }
    return [pscustomobject]@{ Out = @($said); Code = $p.ExitCode }
}

function global:ssh {
    $all = @($args | ForEach-Object { [string]$_ })
    $at = [Array]::IndexOf($all, $global:TsFar.Target)
    $command = ''
    if ($at -ge 0 -and $at -lt ($all.Count - 1)) { $command = ($all[($at + 1)..($all.Count - 1)] -join ' ') }
    # What the helper piped in, as sshd would carry it to the command.
    $in = @($input | ForEach-Object { [string]$_ })
    $ran = Invoke-TsFarEnd $command '' $in
    [void]$global:TsRemoteCalls.Add([pscustomobject]@{ Tool = 'ssh'; Line = ($all -join ' '); Command = $command; Stdin = $in; Sent = ''; Out = ($ran.Out -join "`n"); Code = $ran.Code })
    foreach ($l in $ran.Out) { $l }
    $global:LASTEXITCODE = $ran.Code
}
function global:scp {
    # A long script's copy (#3059). The local file is the argument that
    # exists on disk. It lands in the stand-in folder only if it was bound
    # for C:/Windows/Temp, by a plain name.
    $all = @($args | ForEach-Object { [string]$_ })
    $src = $null
    $far = ''
    foreach ($s in $all) {
        $isFile = $false
        try { $isFile = [IO.File]::Exists($s) } catch { }
        if ($isFile) { $src = $s; continue }
        $m = [regex]::Match($s, '^[^@\s]+@[^:\s]+:(.+)$')
        if ($m.Success) { $far = $m.Groups[1].Value }
    }
    $sent = ''
    $code = 1
    if ($src) { $sent = [IO.File]::ReadAllText($src) }
    $temp = $global:TsFar.Temp
    if ($src -and $far.StartsWith($temp) -and $far.Substring($temp.Length) -match '^[A-Za-z0-9._-]+$') {
        [IO.File]::Copy($src, (Join-Path $global:TsFar.Disk $far.Substring($temp.Length)), $true)
        $global:TsFar.Copied[$far.Substring($temp.Length)] = $sent
        $code = 0
    }
    [void]$global:TsRemoteCalls.Add([pscustomobject]@{ Tool = 'scp'; Line = ($all -join ' '); Command = ''; Sent = $sent; Out = ''; Code = $code })
    $global:LASTEXITCODE = $code
}
Yes 'ssh is the stand-in here, so nothing can reach a server' ((Get-Command ssh).CommandType -eq 'Function')
Yes 'and so is scp' ((Get-Command scp).CommandType -eq 'Function')
if ($script:fail) { Done }

# The copy a runner on a call's line takes, or '' when the line is no runner.
function Get-RunnerPath($call) { return (& $global:TsFar.RunnerPath (Get-Encoded $call.Command)) }
function Get-Encoded([string]$line) {
    $m = [regex]::Match($line, 'EncodedCommand\s+(\S+)')
    if (-not $m.Success) { return '' }
    try { return [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($m.Groups[1].Value)) } catch { return '' }
}

function Measure-Send([scriptblock]$send) {
    $global:TsRemoteCalls.Clear()
    Get-ChildItem -LiteralPath $global:TsFar.Disk -File | Remove-Item -Force
    $out = @()
    $stopped = ''
    $global:LASTEXITCODE = 0
    try { $out = @(& $send) } catch { $stopped = $_.Exception.Message }
    $code = $global:LASTEXITCODE
    $calls = @($global:TsRemoteCalls)
    $longest = 0
    foreach ($c in $calls) { if ($c.Line.Length -gt $longest) { $longest = $c.Line.Length } }
    return [pscustomobject]@{
        Ssh     = @($calls | Where-Object { $_.Tool -eq 'ssh' })
        Scp     = @($calls | Where-Object { $_.Tool -eq 'scp' })
        Longest = $longest
        Out     = (@($out | ForEach-Object { [string]$_ }) -join "`n")
        Code    = $code
        Stopped = $stopped
        Left    = @(Get-ChildItem -LiteralPath $global:TsFar.Disk -File).Count
    }
}

# Says what came back when a run failed, because "FAIL runs that file" alone
# sends the next person to guess.
function Show-Why($r) {
    if (-not $OnWindows) { return }
    if ($r.Stopped) { Write-Host ('      it stopped: ' + $r.Stopped) }
    foreach ($c in $r.Ssh) {
        if ($c.Code -ne 0 -and $c.Code -ne 7) {
            $first = ($c.Out -split "`n" | Where-Object { $_ -match 'fail|not|error' } | Select-Object -First 1)
            if (-not $first) { $first = ($c.Out -split "`n" | Select-Object -First 1) }
            Write-Host ('      the far end said, exit ' + $c.Code + ': ' + $first)
        }
    }
}

# The runner's line a helper sent, run again under a PowerShell 7 outer
# shell, with the same copy put back for it. Its exit code is not compared:
# Windows PowerShell's -Command, which sshd may hand the line to, hands back
# 1 for any program that failed, so the 7 the script exits with cannot be
# counted on to come through that way. Every helper sends the
# very same runner with the very same copy, so that pair is run this way once
# and not again. Measured 24 September on a busy machine: run for every
# helper, it took this from 136 seconds to 213; run once a pair, from 126 to
# 152.
$script:otherShellRan = @{}
function Test-OtherShell($r) {
    if ($r.Ssh.Count -ne 1) { return $false }
    # A runner's line names its own copy, so the pair is the runner with
    # that name taken out and what the copy held.
    $key = $r.Ssh[0].Command + "`n" + (@($r.Ssh[0].Stdin) -join "`n")
    $rp = Get-RunnerPath $r.Ssh[0]
    if ($rp) { $key = (Get-Encoded $r.Ssh[0].Command).Replace($rp, '') + "`n" + $global:TsFar.Copied[($rp -split '\\')[-1]] }
    if (-not $script:otherShellRan.ContainsKey($key)) {
        $script:otherShellRan[$key] = (Invoke-OtherShell $r.Ssh[0].Command @($r.Ssh[0].Stdin))
    }
    return $script:otherShellRan[$key]
}
function Invoke-OtherShell([string]$command, [string[]]$stdin) {
    $ran = Invoke-TsFarEnd $command 'pwsh' $stdin
    $out = ($ran.Out -join "`n")
    if ($out.Contains($lastLine)) { return $true }
    $first = ($ran.Out | Where-Object { $_ -match 'fail|not|error' } | Select-Object -First 1)
    if (-not $first) { $first = ($ran.Out | Select-Object -First 1) }
    Write-Host ('      PowerShell 7 said, exit ' + $ran.Code + ': ' + $first)
    return $false
}

function Test-Sends([string]$name, [scriptblock]$sendBig, [scriptblock]$sendShort, [bool]$handsBackCode) {
    $r = Measure-Send $sendBig
    $ran = ($r.Ssh.Count -eq 1 -and $r.Ssh[0].Code -eq 7 -and $r.Ssh[0].Out.Contains($lastLine))
    Yes "$name sends a 10 KB script on no command line longer than cmd.exe's $Limit" ($r.Longest -gt 0 -and $r.Longest -le $Limit)
    Yes '  as one copy, holding the whole script, and one ssh call' ($r.Scp.Count -eq 1 -and $r.Scp[0].Sent.Contains($big) -and $r.Ssh.Count -eq 1)
    Yes '  the runner on the command line, taking that copy, and nothing on standard input' ($r.Ssh.Count -eq 1 -and $r.Scp.Count -eq 1 -and (Get-RunnerPath $r.Ssh[0]) -and $r.Scp[0].Line.EndsWith(((Get-RunnerPath $r.Ssh[0]) -replace '\\', '/')) -and @($r.Ssh[0].Stdin).Count -eq 0)
    Runs '  runs it to its last line when cmd.exe on this machine hands the line on' $ran
    Yes '  and when PowerShell 7 on this machine hands the same line on instead' (Test-OtherShell $r)
    Runs '  and what it printed comes back' ($r.Out.Contains($lastLine))
    Yes '  and the runner leaves nothing in the far temp folder, with no call to tidy it' (@($r.Ssh | Where-Object { $_.Command -match 'Remove-Item|-File' }).Count -eq 0 -and ($r.Left -eq 0 -or -not $OnWindows))
    if ($handsBackCode) {
        Runs "  and hands back the script's own exit code" ($r.Code -eq 7)
    }
    if (-not $ran -or $r.Stopped) { Show-Why $r }

    $r = Measure-Send $sendShort
    Yes '  and a short one still goes inline, in one call' ($r.Scp.Count -eq 0 -and $r.Ssh.Count -eq 1)
    Yes '  whole' ($r.Ssh.Count -eq 1 -and (Get-Encoded $r.Ssh[0].Command).Contains($short))
    Runs '  and runs' ($r.Out.Contains('short and sent inline'))
    if (-not $r.Out.Contains('short and sent inline')) { Show-Why $r }
}

# ---- Send-Script.ps1, the helper every script sends through (#1070) -----------
$sendScript = Join-Path $RepoPath 'scripts\vps\Send-Script.ps1'
Yes 'Send-Script.ps1 is there' (Test-Path -LiteralPath $sendScript)
if (Test-Path -LiteralPath $sendScript) {
    . $sendScript
    Test-Sends 'Send-Script.ps1 Invoke-ThornswoodRemote' {
        Invoke-ThornswoodRemote -Target $target -SshArgs $ssh -Script $big
    } {
        Invoke-ThornswoodRemote -Target $target -SshArgs $ssh -Script $short
    } $true
}

# ---- Remote.ps1, which takes any script --------------------------------------
$remotePs1 = Join-Path $RepoPath 'scripts\vps\Remote.ps1'
Yes 'Remote.ps1 is there' (Test-Path -LiteralPath $remotePs1)
if (Test-Path -LiteralPath $remotePs1) {
    Test-Sends 'Remote.ps1 -Script' {
        & $remotePs1 -Script $big -VpsHost $VpsHost -VpsUser $VpsUser
    } {
        & $remotePs1 -Script $short -VpsHost $VpsHost -VpsUser $VpsUser
    } $true

    $bigFile = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-big-' + [Guid]::NewGuid().ToString('N') + '.ps1')
    try {
        [IO.File]::WriteAllText($bigFile, $big)
        $r = Measure-Send { & $remotePs1 -File $bigFile -VpsHost $VpsHost -VpsUser $VpsUser }
        Yes "Remote.ps1 -File with a 10 KB script sends no command line longer than cmd.exe's $Limit" ($r.Longest -gt 0 -and $r.Longest -le $Limit)
        Yes '  and copies the whole script up once, for the runner on one ssh line' ($r.Scp.Count -eq 1 -and $r.Scp[0].Sent.Contains($big) -and $r.Ssh.Count -eq 1 -and (Get-RunnerPath $r.Ssh[0]))
        Runs '  and runs it to its last line' ($r.Out.Contains($lastLine))
        Runs "  and hands back the script's own exit code" ($r.Code -eq 7)
        if (-not $r.Out.Contains($lastLine)) { Show-Why $r }
    }
    finally { Remove-Item -LiteralPath $bigFile -Force -ErrorAction SilentlyContinue }
}

# ---- the Remote function in every script that has one -------------------------
#
# Found by the parser, not by counting braces: two of these quote PowerShell's
# own "Missing closing '}'" in their comments, which is exactly the message
# the guard exists to prevent, and a brace counter stops there.
function Get-FunctionText([string]$path, [string]$name) {
    $tokens = $null; $errors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors)
    $all = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true)
    foreach ($fn in $all) {
        if ($fn.Name -eq $name) { return $fn.Extent.Text }
    }
    return ''
}

$helpers = 0
foreach ($f in (Get-ChildItem -Path (Join-Path $RepoPath 'scripts') -Filter *.ps1 -File -Recurse | Where-Object { $_.Name -notlike 'test-*' -and $_.FullName -notmatch '[\\/]oneoff[\\/]' } | Sort-Object Name)) {
    $fn = Get-FunctionText $f.FullName 'Remote'
    if (-not $fn) { continue }
    # Since #1070 the copies call Send-Script.ps1, loaded above, which keeps
    # the far side's exit code, so theirs is held to that as well.
    if ($fn -match 'Invoke-ThornswoodRemote') {
        $helpers++
        try { Invoke-Expression $fn } catch { Yes ("the Remote in {0} can be lifted" -f $f.Name) $false; continue }
        Test-Sends $f.Name { Remote $big } { Remote $short } $true
        continue
    }
    if ($fn -notmatch '\$cmd\.Length -(le|gt) \d+') {
        Write-Host ("SKIP  {0}: its Remote has no guard; it sends only its own blocks, which test-remote-length.ps1 measures" -f $f.Name)
        continue
    }
    $helpers++
    try { Invoke-Expression $fn } catch { Yes ("the Remote in {0} can be lifted" -f $f.Name) $false; continue }
    # Rotate-BotToken.ps1 (#902) refused a long script here until #3035, when
    # its writer went up as a file first; it sends through Send-Script.ps1
    # now, the token on standard input, so the loop above sends it a 10 KB
    # script like any other.
    Test-Sends $f.Name { Remote $big } { Remote $short } $false
}
Yes 'the guarded helpers were found and sent to' ($helpers -ge 10)

# Issue #1166: these three used to pass the block on the ssh command line.
# The loop above sends a 10 KB script through every Remote that calls
# Invoke-ThornswoodRemote, which is how they send now. Named here so a
# later edit that drops one of them out of that loop fails this file.
foreach ($rel in 'scripts\deploy\Install-Backup.ps1', 'scripts\vps\Restart-Server.ps1', 'scripts\vps\Restore-Box.ps1') {
    $fn1166 = Get-FunctionText (Join-Path $RepoPath $rel) 'Remote'
    Yes ("{0} calls Invoke-ThornswoodRemote, so a 10 KB script went through it above (#1166)" -f (Split-Path -Leaf $rel)) ($fn1166 -match 'Invoke-ThornswoodRemote -Target')
}

# ---- and the ones that are not a Remote function -------------------------------
#
# Install-Voice.ps1 sends its install inline in the script body, so nothing
# above can call it. So every script is read for the one shape of line that
# fails under cmd.exe here: ssh told to run a -File path in single quotes.
# That shape did run on the VPS on 20 and 21 September, so this is not a
# claim about the VPS. It keeps every helper on the form that runs under
# either shell while which one the VPS uses is not known.
$quoted = @()
foreach ($f in (Get-ChildItem -Path (Join-Path $RepoPath 'scripts') -Filter *.ps1 -File -Recurse | Where-Object { $_.Name -notlike 'test-*' -and $_.FullName -notmatch '[\\/]oneoff[\\/]' } | Sort-Object Name)) {
    $i = 0
    foreach ($line in [IO.File]::ReadAllLines($f.FullName)) {
        $i++
        if ($line -match '&\s*ssh\b.*-File\s+''') { $quoted += ('{0}:{1}' -f $f.Name, $i) }
    }
}
$why = ''
if ($quoted.Count) { $why = ': ' + ($quoted -join ', ') }
Yes ('no script has ssh run a -File path in single quotes, the form that fails under cmd.exe here' + $why) ($quoted.Count -eq 0)

Done
