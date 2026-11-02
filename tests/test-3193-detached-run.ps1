<#
  test-3193-detached-run.ps1

      pwsh -NoProfile -File .\tests\test-3193-detached-run.ps1

  Issue #3193. Setup-Domain.ps1 stops Caddy in the script it sends to the
  box, and from One ssh to the box goes through the bridge, which goes
  through Caddy. On 21 Oct 2026 (#2995's step A2) the session was cut
  halfway, everything the script said after that was lost, and the run
  ended as ssh's exit 255 though the box had finished. Now the script runs
  on the box on its own, started through WMI so the session ending cannot
  reach it, and writes a report that a fresh session reads once Caddy, and
  the bridge with it, is back: Get-ThornswoodDetachedRun (Send-Script.ps1).

  This checks:
    1. The texts it builds, anywhere: the start writes the script and starts
       it through Win32_Process Create and only then says STARTED; the read
       says REPORT NONE before there is a report; the two files are named
       for the run in the folder given; a folder that would break the
       quoting is refused.
    2. On Windows, both texts run for real in PowerShell 7, which is what
       the box runs, with a scratch folder standing for
       C:\Windows\Temp:
         - the run's parent is the WMI service's process, not the
           PowerShell that started it, and it is still going after that one
           has ended;
         - what the script says, its errors too, is in the report in order,
           and the last line is END and the script's exit code;
         - an error that stops the script is an ERROR line and END 1;
         - a script that ends without exit is END 0 even when a program it
           ran last exited 5;
         - the script's file is gone once the run is over, and the read that
           sees END deletes the report;
         - a read while the run has its report open for appending reads it
           and leaves the run able to write (#3233: ReadAllLines did not, so
           a read mid-run made the run's next line fail and end it as END 1);
         - a run whose starting session is still open waits for it to end
           before any of its script runs, and one whose session does not
           end within its limit runs nothing and is ERROR and END 1 (#3214:
           Install-Bridge's run stopped the bridge its own start rode).
  Setup-Domain.ps1's use of it is in tests\test-setup-domain-taskonly.ps1.
  Starts only the PowerShell processes it waits for, in the scratch
  folder it removes; nothing leaves this machine.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'Windows.ps1')
. ([IO.Path]::Combine($Repo, 'scripts', 'vps', 'Send-Script.ps1'))

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

# ---- 1. the texts -----------------------------------------------------------
$r = Get-ThornswoodDetachedRun -Script "'hello'"
Yes 'the run''s files are named for it in C:\Windows\Temp by default' (
    $r.File -match '^C:\\Windows\\Temp\\thornswood-run-[0-9a-f]{32}\.ps1$' -and $r.Log -eq ($r.File -replace '\.ps1$', '.log'))
$cim = $r.Start.IndexOf('Invoke-CimMethod -ClassName Win32_Process -MethodName Create')
Yes 'the start writes the script, then starts it through WMI, then says STARTED' (
    $r.Start.IndexOf('WriteAllText') -ge 0 -and $r.Start.IndexOf('WriteAllText') -lt $cim -and $cim -lt $r.Start.IndexOf("'STARTED '"))
Yes 'the read says REPORT NONE before there is a report' ($r.Read.Contains("'REPORT NONE'"))
$threw = $false
try { [void](Get-ThornswoodDetachedRun -Script 'x' -Folder "C:\it's") } catch { $threw = $true }
Yes 'a folder with a quote in it is refused' $threw
# #3233: ReadAllLines lets nobody write while it reads, so a read mid-run made
# the run's next AppendAllText fail and the run end as ERROR and END 1.
Yes 'the read opens the report so the run can go on writing it (#3233)' (
    -not $r.Read.Contains('ReadAllLines') -and $r.Read.Contains('[IO.FileShare]::ReadWrite'))
# #3214: the start names its session's sshd process before it starts the
# run, and the run waits for it before any of the script.
$runnerText = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String(([regex]::Match($r.Start, '-EncodedCommand ([A-Za-z0-9+/=]+)')).Groups[1].Value))
Yes 'the start names the session''s own sshd process for the run before it starts it (#3214)' (
    $r.Start.IndexOf(".ps1.session', [string]`$up.ProcessId)") -gt 0 -and $r.Start.IndexOf(".ps1.session', [string]`$up.ProcessId)") -lt $cim -and
    $r.Start.Contains("'^sshd(-session)?\.exe`$'") -and $r.Start.Contains('CreationDate -gt'))
Yes '  and the run waits for that process to exit before it runs the script' (
    $runnerText.Contains('WaitForExit(120000)') -and $runnerText.IndexOf('WaitForExit(') -lt $runnerText.IndexOf("*>&1 | ForEach-Object"))

if (-not $OnWindows) {
    Write-Host 'SKIP  the runs: they start through WMI''s Win32_Process, which only Windows has'
    Done
}

# ---- 2. the runs, on Windows --------------------------------------------------
$boxPs = Get-BoxPowerShell
$scratch = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-3193-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $scratch | Out-Null

function Invoke-Box([string]$text) {
    $e = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($text))
    $out = @(& $boxPs -NoProfile -ExecutionPolicy Bypass -EncodedCommand $e 2>&1 | ForEach-Object { "$_" })
    return [pscustomobject]@{ Out = $out; Code = $LASTEXITCODE }
}
# Starts a run and reads its report until END, a minute at most. With -Go,
# the run waits for that file, which is made only once the first read is
# done, so the first read finds it still going however slowly this machine
# starts a PowerShell (a fixed three seconds was not enough on One,
# where the start and the first read took longer, #3861).
#
# With -GoOnceRead too, the go file is made only once the run has read its
# session file too, which it deletes as it reads it, so a stand-in session
# that -Go lets go is still open when the run looks for it (#5159).
function Invoke-Run([string]$script, [string]$Go = '', [int]$SessionPid = 0, [int]$SessionWait = 120, [switch]$GoOnceRead) {
    $run = Get-ThornswoodDetachedRun -Script $script -Folder $scratch -SessionWait $SessionWait
    # A harness has no ssh session above it, so the start names none; this
    # names a process of the harness's in its place.
    if ($SessionPid) { [IO.File]::WriteAllText($run.File + '.session', [string]$SessionPid) }
    $s = Invoke-Box $run.Start
    $runPid = 0
    $m = @($s.Out | Where-Object { $_ -match '^STARTED (\d+)$' })
    if ($m.Count) { $runPid = [int]($m[0] -replace '^STARTED ', '') }
    $parent = ''
    if ($runPid) {
        $p = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $runPid) -ErrorAction SilentlyContinue
        if ($p) { $q = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $p.ParentProcessId) -ErrorAction SilentlyContinue; if ($q) { $parent = $q.Name } }
    }
    $lines = @(); $first = $null; $went = $false
    $until = (Get-Date).AddMinutes(1)
    while ((Get-Date) -lt $until) {
        $rd = Invoke-Box $run.Read
        if ($null -eq $first) { $first = ($rd.Out -join '|') }
        if ($Go -and -not $went -and -not ($GoOnceRead -and (Test-Path -LiteralPath ($run.File + '.session')))) {
            [IO.File]::WriteAllText($Go, 'go'); $went = $true
        }
        if ($rd.Out.Count -and $rd.Out[0] -match '^REPORT \d+$') {
            $lines = @($rd.Out | Select-Object -Skip 1)
            if ($lines.Count -and $lines[-1] -match '^END ') { break }
        }
        Start-Sleep -Milliseconds 500
    }
    $lines | ForEach-Object { Write-Host ('      ' + $_) }
    return [pscustomobject]@{ Start = $s; Pid = $runPid; Parent = $parent; Lines = $lines; First = $first; Run = $run }
}

try {
    Write-Host ''
    Write-Host 'A run that says things, errs, waits to be let go and exits 3:'
    $go = Join-Path $scratch 'go-a'
    $wait = "`$until = [DateTime]::UtcNow.AddMinutes(1); while (-not (Test-Path -LiteralPath '" + $go + "') -and [DateTime]::UtcNow -lt `$until) { Start-Sleep -Milliseconds 100 }"
    $a = Invoke-Run ("'first line'`r`nWrite-Error 'an error line'`r`n" + $wait + "`r`n'last line'`r`nexit 3") -Go $go
    Yes '  the start says STARTED and exits 0' ($a.Pid -gt 0 -and $a.Start.Code -eq 0)
    Yes ('  the run''s parent is the WMI service''s process (' + $a.Parent + '), not the PowerShell that started it') ($a.Parent -eq 'WmiPrvSE.exe')
    Yes ('  it is still going once that PowerShell has ended: the first read finds no END yet (' + $a.First + ')') (
        $null -ne $a.First -and $a.First -match '^REPORT' -and $a.First -notmatch 'END ')
    $want = @('first line', 'an error line', 'last line', 'END 3')
    Yes '  the report holds what it said, its error too, in order, then END 3' (($a.Lines -join '|') -eq ($want -join '|'))
    Yes '  the script''s file is gone' (-not (Test-Path -LiteralPath $a.Run.File))
    Yes '  and the read that saw END deleted the report' (-not (Test-Path -LiteralPath $a.Run.Log))

    Write-Host ''
    Write-Host 'A read while the run holds its report open, appending:'
    $h = Get-ThornswoodDetachedRun -Script "'x'" -Folder $scratch
    [IO.File]::WriteAllText($h.Log, "one`r`ntwo`r`n")
    # As AppendAllText opens it in PowerShell 7: append, write, others may read.
    $held = New-Object IO.FileStream($h.Log, [IO.FileMode]::Append, [IO.FileAccess]::Write, [IO.FileShare]::Read)
    try { $rd = Invoke-Box $h.Read } finally { $held.Dispose() }
    $rd.Out | ForEach-Object { Write-Host ('      ' + $_) }
    Yes '  it reads the report, and does not fail for the run having it open (#3233)' (
        $rd.Code -eq 0 -and ($rd.Out -join '|') -eq 'REPORT 2|one|two')
    Remove-Item -LiteralPath $h.Log -Force -ErrorAction SilentlyContinue

    Write-Host ''
    Write-Host 'A run stopped by an error:'
    $b = Invoke-Run "'before'`r`nthrow 'stops here'`r`n'never'"
    Yes '  an ERROR line with what stopped it, then END 1' (
        ($b.Lines -join '|') -eq 'before|ERROR stops here|END 1')

    Write-Host ''
    Write-Host 'A run whose starting session is still open until it is let go:'
    # #5159: the stand-in session slept a fixed 6 s, which a loaded machine
    # spent before the run looked for it, and the script asked for it by its
    # id alone, which Windows had by then given to another process, so the
    # script said "session still open" after the session had ended. Now it
    # stays until it is let go, once the run has read the session file, and
    # the script asks for that id and that start time both.
    $let = Join-Path $scratch 'session-let-go'
    $sleeper = Start-Process -FilePath $boxPs -ArgumentList '-NoProfile', '-Command', ("`$t = (Get-Date).AddMinutes(1); while (-not (Test-Path -LiteralPath '" + $let + "') -and (Get-Date) -lt `$t) { Start-Sleep -Milliseconds 100 }") -PassThru -WindowStyle Hidden
    try {
        $born = $sleeper.StartTime.Ticks
        $d = Invoke-Run ("`$q = Get-Process -Id " + $sleeper.Id + " -ErrorAction SilentlyContinue`r`nif (`$q -and `$q.StartTime.Ticks -eq " + $born + ") { 'session still open' } else { 'session gone' }") -SessionPid $sleeper.Id -Go $let -GoOnceRead
    } finally { Stop-Process -Id $sleeper.Id -Force -ErrorAction SilentlyContinue }
    Yes '  none of its script runs until that session has ended (#3214)' (($d.Lines -join '|') -eq 'session gone|END 0')
    Yes '  and the session file is gone' (-not (Test-Path -LiteralPath ($d.Run.File + '.session')))

    Write-Host ''
    Write-Host 'A run whose starting session outlasts its limit:'
    $stuck = Start-Process -FilePath $boxPs -ArgumentList '-NoProfile', '-Command', 'Start-Sleep -Seconds 60' -PassThru -WindowStyle Hidden
    try { $e2 = Invoke-Run "'never'" -SessionPid $stuck.Id -SessionWait 2 } finally { Stop-Process -Id $stuck.Id -Force -ErrorAction SilentlyContinue }
    Yes '  runs nothing, and says so with ERROR, then END 1' (
        ($e2.Lines -join '|') -eq ('ERROR the ssh session that started this run (process ' + $stuck.Id + ') did not end within 2 s, so none of the run was started|END 1'))
    Yes '  and its script file is gone' (-not (Test-Path -LiteralPath $e2.Run.File))

    Write-Host ''
    Write-Host 'A run that ends without exit, after a program that exited 5:'
    $c = Invoke-Run "cmd.exe /c exit 5`r`n'went on'"
    Yes '  END 0, the script''s own end, not the program''s 5' (($c.Lines -join '|') -eq 'went on|END 0')
}
finally {
    Remove-Item -LiteralPath $scratch -Recurse -Force -ErrorAction SilentlyContinue
}
Done
