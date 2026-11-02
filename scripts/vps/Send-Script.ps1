<#
  Send-Script.ps1

  The one way a script here runs PowerShell on the VPS. Dot-source it beside
  Vps.ps1:

      . (Join-Path $Here '..\vps\Send-Script.ps1')
      function Remote($script) { Invoke-ThornswoodRemote -Target "$User@$Vps" -SshArgs $ssh -Script $script }

  WHY THIS EXISTS (issue #1070). Seventeen scripts carried their own copy of
  Remote($script), and four more a copy of their own under another name.
  Over 6,000 characters each copy sent the script as a file to one fixed path
  on the VPS (C:/Windows/Temp/thornswood-remote.ps1 in seventeen of them), so
  two runs at once, from two machines or a lane and a person, could run or
  delete each other's script. And each copy ran the file, then removed it,
  and the removal's exit code was the last one the caller saw, so a script
  that failed on the far side looked like one that worked.

  WHAT IT DOES. Under the limit the script goes on the command line, one
  round trip. Over it, scp copies the script to the box as a file of its own
  name, and one ssh call runs a short runner on the command line, which reads
  the file, deletes it, and only then runs what it read. $LASTEXITCODE
  afterwards is the far side's.

  Why not the command line: sshd on Windows hands the command to cmd.exe,
  which stops at 8,191 characters and says nothing, and base64 of UTF-16 is
  about 2.7 times the script. On 17 and 20 September a long block arrived cut
  in half and the far side complained about a brace in a script nobody could
  see. Standard input has no such limit.

  Why not standard input (issue #3059). From 21 Oct 2026 (#3036) a long
  script went on ssh's standard input, and on the box it hung: measured that
  day from One, the box's sshd hands a command its standard input whole only
  up to about 8 KB. Over that, whether the rest and the end of input arrive
  is chance, session by session, whichever way the far side reads (Install-
  Runner's 135,700 byte firewall script never arrived; a 16 KB line arrived
  for one reader and not for three others). Nothing written after the
  session starts arrives at all (#2912). So standard input carries only a
  short value now (-Stdin, at most 8,000 bytes, the size that arrived every
  time), and a long script goes by scp, which carries any size.

  Why the file is removed by the run that reads it (issues #3027 and #3059).
  Until 21 Oct 2026 the file was run with -File by a second ssh call and
  removed by a third, so a run cut before the third (a bridge reset, the
  machine running it going away) left the file on the box. Now the runner
  deletes it before it runs anything, so a run that starts leaves nothing,
  however it ends. What is left is a run cut between its copy and its run, a
  few seconds: the box gives no sign that the run is gone (the end of
  standard input never arrives, and a far process outlives its ssh session,
  measured 21 Oct, #3064). So each runner also deletes every such file older
  than ten minutes, which no live run can still own, and a file a cut run
  leaves goes with the next long run after that. The runner runs the script
  the way -File ran the file: an exit inside it is the far side's exit code,
  an error that stops it is 1, and otherwise 0.

  Host key checking is always on (issues #450 and #1078): a caller's own
  weaker StrictHostKeyChecking is refused before anything is sent, because
  ssh takes the first value it is given for an option and a weaker one would
  win over the one added here.

  A secret never goes through here as part of the script: Send-Secret.ps1
  puts it on standard input, and uses this for the rest.

  A warning ssh prints on stderr is not a failure (issue #941): ssh and scp
  run inside Invoke-ThornswoodNative (Vps.ps1), so the OpenSSH post-quantum
  warning does not stop a Windows PowerShell 5.1 caller, and whether the far
  side ran is ssh's exit code, the same under PowerShell 7.
#>

. (Join-Path $PSScriptRoot 'Vps.ps1')

# The most a far side here is sent on standard input, in bytes with its line
# end (the header's Why not standard input).
$ThornswoodStdinLimit = 8000

# What a long script runs under on the box: reads the file at $Path (its
# Windows form), deletes it, deletes every copy older than ten minutes that
# a cut run left (the header says why), and runs what it read in its own
# scope, as -Command would run it. A file it cannot read or delete is exit
# 254, with nothing run; a script that does not parse is 1, as under -File.
# What it says goes on the error stream with Write-Error, never straight to
# the console's: Windows PowerShell with its output redirected writes that
# stream as CLIXML once anything (the first module it loads) has put a
# progress record there, and a raw line after that is a line the caller's
# PowerShell cannot read (measured on the VPS runners, #3059). Kept apart so
# the harnesses know it when they see it (Get-ThornswoodRemoteRunnerPath,
# tests\test-remote-big-script.ps1).
function Get-ThornswoodRemoteRunner([Parameter(Mandatory = $true)][string]$Path) {
    if ($Path -notmatch '^C:\\Windows\\Temp\\thornswood-remote-[0-9a-f]{32}\.ps1$') { throw ('not a runner''s file: ' + $Path) }
    return @"
`$ThornswoodRunFile = '$Path'
try { `$ThornswoodRunText = [IO.File]::ReadAllText(`$ThornswoodRunFile, [Text.Encoding]::UTF8); [IO.File]::Delete(`$ThornswoodRunFile) }
catch { Write-Error -Message ('the script could not be taken from ' + `$ThornswoodRunFile + ': ' + `$_.Exception.GetBaseException().Message + ' Nothing ran.') -ErrorAction Continue; exit 254 }
foreach (`$ThornswoodRunOld in @(Get-ChildItem -LiteralPath 'C:\Windows\Temp' -Filter 'thornswood-remote-*.ps1' -File -ErrorAction SilentlyContinue)) {
  if (`$ThornswoodRunOld.Name -match '^thornswood-remote-[0-9a-f]{32}\.ps1`$' -and `$ThornswoodRunOld.LastWriteTimeUtc -lt [DateTime]::UtcNow.AddMinutes(-10)) {
    try { [IO.File]::Delete(`$ThornswoodRunOld.FullName) } catch { Write-Error -Message ('could not remove ' + `$ThornswoodRunOld.FullName + ', left by a run cut short: ' + `$_.Exception.GetBaseException().Message) -ErrorAction Continue }
  }
}
try { `$ThornswoodRunBlock = [scriptblock]::Create(`$ThornswoodRunText) } catch { Write-Error -Message ('the script does not parse: ' + `$_.Exception.GetBaseException().Message) -ErrorAction Continue; exit 1 }
Remove-Variable -Name ThornswoodRunFile, ThornswoodRunOld, ThornswoodRunText -ErrorAction SilentlyContinue
. `$ThornswoodRunBlock
"@
}

# The file a runner from Get-ThornswoodRemoteRunner takes, from its text, or
# '' when the text is no runner. For the harnesses' stand-in boxes, which
# call it from their own scope (${function:Get-ThornswoodRemoteRunnerPath}),
# so it calls nothing of this file's.
function Get-ThornswoodRemoteRunnerPath([AllowEmptyString()][string]$Text) {
    $m = [regex]::Match([string]$Text, "^\`$ThornswoodRunFile = '(C:\\Windows\\Temp\\thornswood-remote-[0-9a-f]{32}\.ps1)'\r?\n(?s:.*)\r?\n\. \`$ThornswoodRunBlock\r?\n?$")
    if ($m.Success) { return $m.Groups[1].Value }
    return ''
}

# A script file of the repository's, as the text that runs it on the box with
# $Arguments, for Invoke-ThornswoodRemote to send (#3035). $Arguments is
# written as it would be typed after the file's name there: '-DryRun', or
# "-From '203.0.113.7'". The file is never copied to the box: until 21 Oct
# 2026 Harden-VPS.ps1, Set-SshScope.ps1 and Set-TimeWait.ps1 each copied
# theirs into C:\Windows\Temp with scp and ran it with -File, and a run cut
# between the copy and the end of the run left it there for good.
#
# Dot-sourced, not called with &, so the file's own top level is the scope
# its functions reach with $script:, as under -File. Called with &, the
# block's top level is a scope of its own and $script: is the one above it:
# measured 21 Oct 2026, a file that sets $stopped = $false at its top, has a
# function set $script:stopped = $true, and exits 3 when $stopped is true
# exited 0 with &, and 3 dot-sourced (tests\test-3035-file-script.ps1).
function Get-ThornswoodFileScript {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [string]$Arguments = ''
    )
    return ". {`r`n" + [IO.File]::ReadAllText($Path) + "`r`n} " + $Arguments.Trim()
}

# Runs $Script on the VPS and hands back what the far side printed (2>&1, the
# same as every Remote here).
#   -Target   user@host
#   -SshArgs  the caller's ssh options (@ssh)
#   -Bypass   -ExecutionPolicy Bypass on the command line as well, for a
#             script that dot-sources a file (a long script's runner always
#             has it, as -File had it)
#   -Limit    the longest command line sent; over it the script goes by scp
#   -Stdin    one line for the far side's standard input (Send-Secret.ps1),
#             at most $ThornswoodStdinLimit bytes with its line end. A long
#             script's runner reads none of it, so the script reads it as
#             its first line either way
#   -NewBox   run it in the Windows PowerShell a new Windows Server comes
#             with, for Bootstrap-VPS.ps1 alone, which is what puts
#             PowerShell 7 on a new box (Remote.ps1 says so). Everything
#             else runs in pwsh, as the box's own tasks do (#5356).
function Invoke-ThornswoodRemote {
    param(
        [Parameter(Mandatory = $true)][string]$Target,
        [string[]]$SshArgs = @(),
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Script,
        [switch]$Bypass,
        [int]$Limit = 6000,
        [AllowEmptyString()][string]$Stdin,
        [switch]$NewBox
    )
    $shell = 'pwsh'
    if ($NewBox) { $shell = 'powershell' }
    $weak = @($SshArgs | Where-Object { $_ -match '(?i)StrictHostKeyChecking\s*=\s*(?!yes\b)' })
    if ($weak.Count) { throw ('ssh options with host key checking turned down (' + ($weak -join ', ') + '). Only the box whose key is pinned is talked to. Nothing was sent.') }
    $ssh = @(@($SshArgs | Where-Object { $_ }) + @('-o', 'StrictHostKeyChecking=yes'))
    $piped = $PSBoundParameters.ContainsKey('Stdin')
    if ($piped -and ([Text.Encoding]::UTF8.GetByteCount($Stdin) + 2) -gt $ThornswoodStdinLimit) { throw ('the line for standard input is ' + ([Text.Encoding]::UTF8.GetByteCount($Stdin) + 2) + ' bytes, over the ' + $ThornswoodStdinLimit + ' the box is measured to take whole (Send-Script.ps1, #3059). Nothing was sent.') }
    if ($piped) {
        # Plain ASCII on the pipe whichever PowerShell runs this, so no byte
        # order mark goes in front of the line.
        $OutputEncoding = New-Object Text.ASCIIEncoding
    }

    $policy = ''
    if ($Bypass) { $policy = ' -ExecutionPolicy Bypass' }
    $e = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($Script))
    $cmd = $shell + ' -NoProfile' + $policy + ' -EncodedCommand ' + $e
    if ($cmd.Length -le $Limit) {
        if ($piped) { return ($Stdin | Invoke-ThornswoodNative { $input | & ssh @ssh $Target $cmd } 2>&1) }
        return (Invoke-ThornswoodNative { & ssh @ssh $Target $cmd } 2>&1)
    }

    # Over the limit: the script by scp to a name of its own, then the
    # runner on the command line, which takes the file off the box before it
    # runs it, with the caller's line on its standard input.
    $id = [Guid]::NewGuid().ToString('N')
    $far = 'C:\Windows\Temp\thornswood-remote-' + $id + '.ps1'
    $run = $shell + ' -NoProfile -ExecutionPolicy Bypass -EncodedCommand ' + [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes((Get-ThornswoodRemoteRunner -Path $far)))
    $tmp = [IO.Path]::GetTempFileName()
    $rc = 1
    try {
        [IO.File]::WriteAllText($tmp, $Script, (New-Object Text.UTF8Encoding($false)))
        $sent = @(Invoke-ThornswoodNative { & scp @ssh $tmp ($Target + ':' + $far.Replace('\', '/')) } 2>&1)
        if ($LASTEXITCODE -ne 0) {
            # scp's own exit code and lines, as ssh's come back for a short
            # script that cannot connect, for the caller's check to decide.
            $rc = $LASTEXITCODE
            return @($sent) + @(New-Object Management.Automation.ErrorRecord((New-Object Exception('could not copy the script to ' + $Target + ' (scp exit ' + $rc + '). Nothing was run.')), 'ThornswoodScriptNotCopied', 'ConnectionError', $Target))
        }
        if ($piped) { $out = @($Stdin | Invoke-ThornswoodNative { $input | & ssh @ssh $Target $run } 2>&1) }
        else { $out = @(Invoke-ThornswoodNative { & ssh @ssh $Target $run } 2>&1) }
        $rc = $LASTEXITCODE
    }
    finally {
        # The local copy is this helper's own scratch, not a change the caller
        # asked about, so a caller's -WhatIf does not keep it (#3123).
        Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue -WhatIf:$false
        # The far side's exit code, scp's when the copy failed, or 1 when
        # nothing ran.
        $global:LASTEXITCODE = $rc
    }
    return $out
}

# Starts $Script on the VPS and leaves it running, for a far side that keeps
# going while the caller works (Run-OnBox.ps1's run folder, issue #2999).
# Returns the ssh process, its standard input and output redirected; what ssh
# itself says on standard error goes to this console as it would for any ssh.
# Measured 21 Oct 2026 (#3059): the box passes on nothing written to or
# closed on that input after the session starts, and a far process outlives
# its session, so neither can tell the far side to finish. It is told over a
# second session instead, the way Close-ThornswoodOnBoxFolder does (#3063).
#
# Only the command line form, and a script over the limit is refused, before
# anything is sent.
function Start-ThornswoodRemote {
    param(
        [Parameter(Mandatory = $true)][string]$Target,
        [string[]]$SshArgs = @(),
        [Parameter(Mandatory = $true)][string]$Script,
        [int]$Limit = 6000
    )
    $weak = @($SshArgs | Where-Object { $_ -match '(?i)StrictHostKeyChecking\s*=\s*(?!yes\b)' })
    if ($weak.Count) { throw ('ssh options with host key checking turned down (' + ($weak -join ', ') + '). Only the box whose key is pinned is talked to. Nothing was sent.') }
    $cmd = 'pwsh -NoProfile -EncodedCommand ' + [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($Script))
    if ($cmd.Length -gt $Limit) { throw ('a held script goes on the command line, and this one is ' + $cmd.Length + ' characters there, over ' + $Limit + '. Nothing was sent.') }
    $words = @(@($SshArgs | Where-Object { $_ }) + @('-o', 'StrictHostKeyChecking=yes', $Target, $cmd))
    $bad = @($words | Where-Object { $_ -match '["\r\n]' })
    if ($bad.Count) { throw ('an ssh word holds a double quote or a line break: ' + ($bad -join ' ') + '. Nothing was sent.') }
    # Arguments as one string, which Windows PowerShell 5.1's .NET takes as
    # well as 7's (Add-ThornswoodKnownHostThroughBridge, Vps.ps1).
    $psi = New-Object Diagnostics.ProcessStartInfo
    $psi.FileName = 'ssh'
    $psi.Arguments = (@($words | ForEach-Object { '"' + $_ + '"' }) -join ' ')
    $psi.UseShellExecute = $false
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    return [Diagnostics.Process]::Start($psi)
}

# A script that runs on the box on its own, for one that cuts the session
# it would run in (issue #3193: Setup-Domain.ps1 stops Caddy, and from One
# ssh to the box goes through the bridge, which goes through Caddy, so the
# session was cut halfway, what the script said after that was lost and the
# run ended as ssh's exit 255 whether or not the box finished). Builds the
# texts and sends nothing:
#   Start  what to send with Invoke-ThornswoodRemote. It writes $Script to a
#          file of its own name in $Folder and starts it through WMI, so its
#          parent is the WMI service and nothing about the session ending
#          can reach it, and says STARTED and the run's process id. Nothing
#          of $Script has run by then. Files earlier runs left that are a
#          day old go first; a run still going is minutes old.
#          The run waits for the ssh session that started it to end before
#          any of $Script runs (#3214): a script that stops the bridge, or
#          Caddy in front of it, started at once, cut the start's own session
#          on its way out when it stopped them quickly enough. The start
#          names the session's own sshd process in <File>.session; a run that
#          finds one waits for it to exit, SessionWait seconds at most, and
#          past that runs nothing and ends as END 1 after an ERROR line.
#   Read   what to send, any number of times, to read the run's report:
#          REPORT NONE before there is one, else REPORT <n> and its n lines.
#          The last is END <exit code> once the run is over, and the read
#          that sees it deletes the report. An exit in $Script ends it with
#          that code; an error that stops it is END 1, after an ERROR line.
#   File, Log  the two files on the box, for a message that names them.
# $Folder is for the harnesses, which run both texts on Windows themselves.
function Get-ThornswoodDetachedRun {
    param(
        [Parameter(Mandatory = $true)][string]$Script,
        [string]$Folder = 'C:\Windows\Temp',
        [int]$SessionWait = 120
    )
    if ($Folder -match "['`r`n]") { throw ('not a folder for a run: ' + $Folder) }
    $id = [Guid]::NewGuid().ToString('N')
    $file = $Folder.TrimEnd('\') + '\thornswood-run-' + $id + '.ps1'
    $log = $Folder.TrimEnd('\') + '\thornswood-run-' + $id + '.log'
    # Run with &, so an exit in it ends it and not this, and its code is
    # $LASTEXITCODE; it ends with exit 0, so a code a program it ran left
    # behind is never taken for its own.
    $runner = @"
`$ProgressPreference = 'SilentlyContinue'
`$log = '$log'
function Put([string]`$l) { [IO.File]::AppendAllText(`$log, `$l + "``r``n") }
`$rc = 1
try {
  `$session = '$file.session'
  if (Test-Path -LiteralPath `$session) {
    `$sid = [int]([IO.File]::ReadAllText(`$session).Trim())
    Remove-Item -LiteralPath `$session -Force -EA SilentlyContinue
    `$p = Get-Process -Id `$sid -EA SilentlyContinue
    if (`$p -and -not `$p.WaitForExit($($SessionWait * 1000))) { throw ('the ssh session that started this run (process ' + `$sid + ') did not end within $SessionWait s, so none of the run was started') }
  }
  `$global:LASTEXITCODE = 0
  & '$file' *>&1 | ForEach-Object { Put ([string]`$_) }
  `$rc = `$LASTEXITCODE
} catch { Put ('ERROR ' + `$_.Exception.Message) }
finally {
  Remove-Item -LiteralPath '$file' -Force -EA SilentlyContinue
  Put ('END ' + `$rc)
}
"@
    $cmd = 'pwsh -NoProfile -ExecutionPolicy Bypass -EncodedCommand ' + [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($runner))
    $body = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Script + "`r`nexit 0`r`n"))
    $start = @"
`$ErrorActionPreference = 'Stop'
Get-ChildItem -LiteralPath '$Folder' -Filter 'thornswood-run-*' -File -EA SilentlyContinue |
  Where-Object { `$_.Name -match '^thornswood-run-[0-9a-f]{32}\.(ps1|log|ps1\.session)`$' -and `$_.LastWriteTimeUtc -lt [DateTime]::UtcNow.AddDays(-1) } |
  Remove-Item -Force -EA SilentlyContinue
[IO.File]::WriteAllText('$file', [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('$body')), (New-Object Text.UTF8Encoding(`$true)))
# The session's own sshd process, the nearest above this one, for the run to
# wait out. Each step up must have started before the one below it, so a
# parent id Windows has since given to another process is not followed.
`$at = Get-CimInstance Win32_Process -Filter ("ProcessId=" + `$PID) -EA SilentlyContinue
for (`$i = 0; `$i -lt 8 -and `$at; `$i++) {
  `$up = Get-CimInstance Win32_Process -Filter ("ProcessId=" + `$at.ParentProcessId) -EA SilentlyContinue
  if (-not `$up -or `$up.CreationDate -gt `$at.CreationDate) { break }
  if (`$up.Name -match '^sshd(-session)?\.exe`$') { [IO.File]::WriteAllText('$file.session', [string]`$up.ProcessId); break }
  `$at = `$up
}
`$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = '$cmd' }
if (`$r.ReturnValue -ne 0) {
  Remove-Item -LiteralPath '$file', '$file.session' -Force -EA SilentlyContinue
  'the run could not be started (Win32_Process Create said ' + `$r.ReturnValue + '). Nothing of it ran.'
  exit 1
}
'STARTED ' + `$r.ProcessId
"@
    # The report is read with the run still writing it (#3233): opened so the
    # run's next AppendAllText may write, which ReadAllLines does not allow,
    # and that append failing ended the run as ERROR and END 1.
    $read = @"
`$l = '$log'
if (-not (Test-Path -LiteralPath `$l)) { 'REPORT NONE'; exit 0 }
`$lines = @()
`$fs = New-Object IO.FileStream(`$l, [IO.FileMode]::Open, [IO.FileAccess]::Read, ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
try { `$sr = New-Object IO.StreamReader(`$fs, [Text.Encoding]::UTF8); while (`$null -ne (`$x = `$sr.ReadLine())) { `$lines += `$x } } finally { `$fs.Dispose() }
'REPORT ' + `$lines.Count
`$lines
if (`$lines.Count -and `$lines[-1] -match '^END ') { Remove-Item -LiteralPath `$l -Force -EA SilentlyContinue }
"@
    return [pscustomobject]@{ Start = $start; Read = $read; File = $file; Log = $log }
}
