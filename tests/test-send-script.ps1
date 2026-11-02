<#
  test-send-script.ps1

  Send-Script.ps1, the one helper every script here runs PowerShell on the VPS
  with (issue #1070), against a fake ssh and scp.

      pwsh -NoProfile -File .\tests\test-send-script.ps1

  WHY THIS EXISTS. Seventeen scripts carried their own copy of Remote(), and
  four more a copy under another name. Over 6,000 characters each sent the
  script as a file to one fixed path on the VPS
  (C:/Windows/Temp/thornswood-remote.ps1 in seventeen of them), so two runs at
  once could run or delete each other's script, and each handed back the exit
  code of the tidy up rather than of the script. This proves the helper that
  replaced them does not:

    - a short script goes on the command line, once, and its exit code comes
      back;
    - a long one goes whole by scp to a name of its own in the far temp
      folder, and one ssh call runs a short runner on the command line that
      takes the copy off the folder before it runs it, so nothing is left
      there once it has run (issues #3027 and #3059). The old three calls,
      cut before their tidy up, are shown to leave their file, so the check
      is known to catch it. A run cut between the copy and the run leaves its
      copy, and the next run removes it once it is ten minutes old, and
      leaves a younger one, which may be another run's still on its way;
    - the exit code is the far side's: an exit inside the script, 1 for an
      error that stops it or a script that does not parse, 0 otherwise, the
      same as when it ran by file;
    - host key checking is always on, and a caller's weaker setting is
      refused before anything is sent;
    - standard input reaches the far side both ways (Send-Secret.ps1 uses it),
      and a line over the 8000 bytes the box takes whole is refused before
      anything is sent;
    - two runs at once, in two processes, each run their own script, get
      their own exit code and leave nothing behind, each copy under a name
      of its own. The old fixed name,
      run the same way, is shown to collide, so the check is known to catch
      it.

  And, reading the scripts: no script sends to a fixed file name in the VPS
  temp folder any more, and every script that had a copy uses the helper.

  THE FAR SIDE IS THIS MACHINE. The fake ssh runs what it is handed in Windows
  PowerShell here (pwsh where there is none), with a scratch folder standing
  for C:/Windows/Temp. Every host it names ends in .invalid. Never connects.
#>
[CmdletBinding()]
param()
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent $Here
$sendScript = Join-Path $repo 'scripts\vps\Send-Script.ps1'

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Done {
    Remove-Item -Path function:global:ssh, function:global:scp -ErrorAction SilentlyContinue
    if ($script:work -and (Test-Path -LiteralPath $script:work)) { Remove-Item -LiteralPath $script:work -Recurse -Force -ErrorAction SilentlyContinue }
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}

Yes 'scripts\vps\Send-Script.ps1 is there' (Test-Path -LiteralPath $sendScript)
if ($script:fail) { Done }
$errs = $null
[void][System.Management.Automation.Language.Parser]::ParseFile($sendScript, [ref]$null, [ref]$errs)
Yes 'Send-Script.ps1 parses' (@($errs).Count -eq 0)
. $sendScript

. (Join-Path $PSScriptRoot 'Windows.ps1')
# The far side runs in PowerShell 7, as on the box since #5356.
$farShell = Get-BoxPowerShell

$script:work = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-send-script-' + [Guid]::NewGuid().ToString('N'))
$far = Join-Path $script:work 'far'
New-Item -ItemType Directory -Path $far -Force | Out-Null

# ---- the fakes, as text, so the two processes of the at-once case load the
# same ones. $global:TsSs is their state: the far folder, every call, how long
# a run waits before it starts, and what should fail. A runner from
# Send-Script.ps1 runs with its C:\Windows\Temp pointed at the far folder.
$fakes = @'
function global:ssh {
    # A native ssh knows nothing of -WhatIf, so neither does its fake.
    $WhatIfPreference = $false
    $a = @($args | ForEach-Object { [string]$_ })
    $cmd = $a[-1]
    $in = @($input)
    $temp = 'C:/Windows/Temp/'
    $m = [regex]::Match($cmd, '^pwsh -NoProfile (-ExecutionPolicy Bypass )?-EncodedCommand ([A-Za-z0-9+/=]+)$')
    $said = ''
    if ($m.Success) { $said = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($m.Groups[2].Value)) }
    $r = [regex]::Match($said, '^\$ThornswoodRunFile = ''(C:\\Windows\\Temp\\(thornswood-remote-[0-9a-f]{32}\.ps1))''')
    [void]$global:TsSs.Calls.Add([pscustomobject]@{ Tool = 'ssh'; Args = $a; Command = $cmd; Said = $said; Copy = $(if ($r.Success) { $r.Groups[2].Value } else { '' }) })
    if ($m.Success) {
        $enc = $m.Groups[2].Value
        if ($r.Success) {
            if ($global:TsSs.RunCut) { 'ssh: the connection was cut'; $global:LASTEXITCODE = 255; return }
            if ($global:TsSs.CopyGone) { Remove-Item -LiteralPath (Join-Path $global:TsSs.Far $r.Groups[2].Value) -Force }
            $mine = $said.Replace($r.Groups[1].Value, (Join-Path $global:TsSs.Far $r.Groups[2].Value)).Replace("'C:\Windows\Temp'", ("'" + $global:TsSs.Far + "'"))
            $enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($mine))
        }
        if ($global:TsSs.RunDelayMs) { Start-Sleep -Milliseconds $global:TsSs.RunDelayMs }
        if ($in.Count) { $in | & $global:TsSs.Shell -NoProfile -NonInteractive -EncodedCommand $enc 2>&1 }
        else { & $global:TsSs.Shell -NoProfile -NonInteractive -EncodedCommand $enc 2>&1 }
        return
    }
    $m = [regex]::Match($cmd, '^pwsh -NoProfile -ExecutionPolicy Bypass -File (C:/Windows/Temp/[A-Za-z0-9._-]+)$')
    if ($m.Success) {
        if ($global:TsSs.RunThrows) { throw 'the run broke on the way' }
        if ($global:TsSs.RunDelayMs) { Start-Sleep -Milliseconds $global:TsSs.RunDelayMs }
        $here = Join-Path $global:TsSs.Far $m.Groups[1].Value.Substring($temp.Length)
        if (-not (Test-Path -LiteralPath $here)) { 'THE FILE WAS NOT THERE'; $global:LASTEXITCODE = 1; return }
        if ($in.Count) { $in | & $global:TsSs.Shell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $here 2>&1 }
        else { & $global:TsSs.Shell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $here 2>&1 }
        return
    }
    $m = [regex]::Match($cmd, '^pwsh -NoProfile -Command Remove-Item -LiteralPath ''(C:/Windows/Temp/[A-Za-z0-9._-]+)'' -Force$')
    if ($m.Success) {
        if ($global:TsSs.TidyCut) { 'ssh: the connection was cut'; $global:LASTEXITCODE = 255; return }
        Remove-Item -LiteralPath (Join-Path $global:TsSs.Far $m.Groups[1].Value.Substring($temp.Length)) -Force -ErrorAction SilentlyContinue
        $global:LASTEXITCODE = 0
        return
    }
    'THE FAKE SSH DID NOT RUN THIS: ' + $cmd
    $global:LASTEXITCODE = 255
}
function global:scp {
    $WhatIfPreference = $false
    $a = @($args | ForEach-Object { [string]$_ })
    $src = $a[-2]; $dst = $a[-1]
    [void]$global:TsSs.Calls.Add([pscustomobject]@{ Tool = 'scp'; Args = $a; Command = $dst; Src = $src; Sent = [IO.File]::ReadAllText($src) })
    if ($global:TsSs.ScpFails) { $global:LASTEXITCODE = 1; return }
    $m = [regex]::Match($dst, '^[^@\s]+@[^:\s]+:C:/Windows/Temp/([A-Za-z0-9._-]+)$')
    if (-not $m.Success) { $global:LASTEXITCODE = 1; return }
    Copy-Item -LiteralPath $src -Destination (Join-Path $global:TsSs.Far $m.Groups[1].Value) -Force
    $global:LASTEXITCODE = 0
}
'@
function New-FakeState([string]$farDir, [string]$shell) {
    return @{ Far = $farDir; Shell = $shell; Calls = (New-Object System.Collections.ArrayList); RunDelayMs = 0; RunThrows = $false; ScpFails = $false; TidyCut = $false; RunCut = $false; CopyGone = $false }
}
$global:TsSs = New-FakeState $far $farShell
. ([scriptblock]::Create($fakes))
Yes 'ssh and scp are the fakes here, so nothing can reach a server' ((Get-Command ssh).CommandType -eq 'Function' -and (Get-Command scp).CommandType -eq 'Function')

$target = 'tester@box.invalid'
$sshArgs = @('-o', 'BatchMode=yes', '-o', 'ConnectTimeout=1')

# A script long enough to go by file, printing a marker and exiting with a
# code of its own.
function Long([string]$marker, [int]$code) {
    $lines = New-Object System.Collections.Generic.List[string]
    $lines.Add("Write-Output 'MARK $marker'")
    $n = 0
    while (($lines -join "`r`n").Length -lt 4000) { $n++; $lines.Add(('$null = {0} # filler so the script is too long for one command line' -f $n)) }
    $lines.Add("exit $code")
    return ($lines -join "`r`n")
}
# Callers wrap it in @(): one call comes back a lone PSCustomObject, which has no .Count on 5.1 (#2226).
function Calls([string]$tool) { return @($global:TsSs.Calls | Where-Object { $_.Tool -eq $tool }) }
function Reset { $global:TsSs.Calls.Clear(); $global:TsSs.RunThrows = $false; $global:TsSs.ScpFails = $false; $global:TsSs.RunDelayMs = 0; $global:TsSs.TidyCut = $false; $global:TsSs.RunCut = $false; $global:TsSs.CopyGone = $false }
function Left { return @(Get-ChildItem -LiteralPath $far -File).Count }
# The runner a long script runs under: short, on the command line, the same
# every run but for its copy's name, and the script itself never in it.
$runnerShape = '^pwsh -NoProfile -ExecutionPolicy Bypass -EncodedCommand [A-Za-z0-9+/=]+$'
$copyShape = '^tester@box\.invalid:C:/Windows/Temp/thornswood-remote-[0-9a-f]{32}\.ps1$'
function Runner-Shape($call) { return $call.Said.Replace(('C:\Windows\Temp\' + $call.Copy), 'COPY') }

# ---- 1. short: on the command line --------------------------------------------
Reset
$out = @(Invoke-ThornswoodRemote -Target $target -SshArgs $sshArgs -Script "Write-Output 'short'; exit 3" | ForEach-Object { "$_" })
$rc = $LASTEXITCODE
Yes 'short: one ssh call and no scp' (@(Calls 'ssh').Count -eq 1 -and @(Calls 'scp').Count -eq 0)
Yes 'short: what it printed comes back' ($out -contains 'short')
Yes 'short: the far side''s exit code comes back (3)' ($rc -eq 3)

# ---- 2. long: by scp, and its run takes the copy off the box -------------------
Reset
$out = @(Invoke-ThornswoodRemote -Target $target -SshArgs $sshArgs -Script (Long 'one' 7) | ForEach-Object { "$_" })
$rc = $LASTEXITCODE
$runs = @(Calls 'ssh')
$copies = @(Calls 'scp')
Yes 'long: one scp and one ssh call' ($runs.Count -eq 1 -and $copies.Count -eq 1)
Yes 'long: the scp carries the whole script, to a name of its own in the box''s temp folder' ($copies.Count -eq 1 -and $copies[0].Sent -eq (Long 'one' 7) -and $copies[0].Command -match $copyShape)
Yes ('long: the command line is the short runner, naming that copy (' + $(if ($runs.Count) { $runs[0].Command.Length } else { 0 }) + ' characters)') (
    $runs.Count -eq 1 -and $runs[0].Command -match $runnerShape -and $runs[0].Command.Length -lt 6000 -and $runs[0].Copy -and $copies[0].Command.EndsWith('/' + $runs[0].Copy) -and
    (Get-ThornswoodRemoteRunnerPath $runs[0].Said) -eq ('C:\Windows\Temp\' + $runs[0].Copy))
Yes 'long: the script is not on the command line' ($runs.Count -eq 1 -and -not $runs[0].Said.Contains('MARK one') -and -not $runs[0].Said.Contains('filler'))
Yes 'long: its run took the copy off the far temp folder, so nothing is left there' ((Left) -eq 0)
Yes 'long: what it printed comes back' ($out -contains 'MARK one')
Yes 'long: the far side''s exit code comes back (7)' ($rc -eq 7)
$first = $null
if ($runs.Count) { $first = $runs[0] }

Reset
$out = @(Invoke-ThornswoodRemote -Target $target -SshArgs $sshArgs -Script (Long 'two' 0) | ForEach-Object { "$_" })
$rc = $LASTEXITCODE
$runs = @(Calls 'ssh')
Yes 'long again: the same runner, whatever the script, but for a copy name made afresh' ($runs.Count -eq 1 -and $first -and (Runner-Shape $runs[0]) -eq (Runner-Shape $first) -and $runs[0].Copy -ne $first.Copy)
Yes 'long again: a script that exits 0 hands back 0' ($rc -eq 0 -and ($out -contains 'MARK two'))

Reset
$noExit = (Long 'eight' 0) -replace 'exit 0$', "Write-Output 'END eight'"
$out = @(Invoke-ThornswoodRemote -Target $target -SshArgs $sshArgs -Script $noExit | ForEach-Object { "$_" })
Yes 'long: a script with no exit runs to its end and hands back 0, as it did by file' ($LASTEXITCODE -eq 0 -and ($out -contains 'MARK eight') -and ($out -contains 'END eight'))
Reset
$withParam = "param([string]`$Who = 'nobody')`r`nWrite-Output ('WHO ' + `$Who)`r`n" + (Long 'nine' 0)
$out = @(Invoke-ThornswoodRemote -Target $target -SshArgs $sshArgs -Script $withParam | ForEach-Object { "$_" })
Yes 'long: a script that opens with param() still runs' ($LASTEXITCODE -eq 0 -and ($out -contains 'WHO nobody') -and ($out -contains 'MARK nine'))
Reset
$utf = "Write-Output ('SAID ' + [string][char]0x00E9 + [string][char]0x2014)`r`n" + (Long 'ten' 0)
$out = @(Invoke-ThornswoodRemote -Target $target -SshArgs $sshArgs -Script $utf | ForEach-Object { "$_" })
$said = @($out | Where-Object { $_ -like 'SAID *' }) | Select-Object -First 1
Yes 'long: a script with letters past ASCII arrives as it was written' ("$said".Length -eq 7 -and [int]"$said"[5] -eq 0x00E9 -and [int]"$said"[6] -eq 0x2014)

# -WhatIf on a caller (a box wrapper run with -WhatIf) reaches the helper as
# $WhatIfPreference. The local temp copy is the helper's own scratch, not a
# change the caller asked about, so it goes all the same (#3123).
Reset
& {
    $WhatIfPreference = $true
    Invoke-ThornswoodRemote -Target $target -SshArgs $sshArgs -Script (Long 'whatif' 0) | Out-Null
}
$copies = @(Calls 'scp')
Yes 'long, under -WhatIf: the local temp copy of the script is removed all the same (#3123)' ($copies.Count -eq 1 -and $copies[0].Src -and -not (Test-Path -LiteralPath $copies[0].Src))

# ---- 3. when something fails -----------------------------------------------------
Reset
$out = @(Invoke-ThornswoodRemote -Target $target -SshArgs $sshArgs -Script ((Long 'three' 0) -replace 'exit 0$', "throw 'the run broke on the way'") 2>&1 | ForEach-Object { "$_" })
$rc = $LASTEXITCODE
Yes 'a long script that throws: the error comes back' (($out -join ' ') -match 'the run broke on the way')
Yes '  and the exit code says it failed (1)' ($rc -eq 1)
Yes '  and nothing is left in the far temp folder' ((Left) -eq 0)
Reset
$out = @(Invoke-ThornswoodRemote -Target $target -SshArgs $sshArgs -Script ((Long 'four' 0) + "`r`n'unclosed {") 2>&1 | ForEach-Object { "$_" })
$rc = $LASTEXITCODE
$ok = ($rc -eq 1 -and -not ($out -contains 'MARK four') -and (($out -join ' ') -match 'does not parse'))
Yes 'a long script that does not parse: nothing of it runs, it says so, and the exit code says so (1)' $ok
if (-not $ok) { Write-Host ('      it said, exit ' + $rc + ': ' + ((@($out) | Select-Object -Last 8) -join ' | ')) }
Yes '  and its copy is gone all the same' ((Left) -eq 0)
Reset
$global:TsSs.ScpFails = $true
$threw = $null; $out = @()
try { $out = @(Invoke-ThornswoodRemote -Target $target -SshArgs $sshArgs -Script (Long 'eleven' 0) 2>&1 | ForEach-Object { "$_" }) } catch { $threw = $_ }
$rc = $LASTEXITCODE
Yes ('an scp that fails: no throw, its exit code comes back for the caller to judge (' + $rc + '), it says so, and nothing is run') ($null -eq $threw -and $rc -eq 1 -and (($out -join ' ') -match 'could not copy the script') -and @(Calls 'ssh').Count -eq 0)
Reset
$global:TsSs.CopyGone = $true
$out = @(Invoke-ThornswoodRemote -Target $target -SshArgs $sshArgs -Script (Long 'twelve' 0) 2>&1 | ForEach-Object { "$_" })
$rc = $LASTEXITCODE
Yes 'a copy the run cannot take: it says so, nothing of it runs, and the exit code is 254' ($rc -eq 254 -and -not ($out -contains 'MARK twelve') -and (($out -join ' ') -match 'could not be taken'))

# A run cut short, the way #3027 was found: the old way sent the script up,
# ran it, and removed it with a third call; cut before that call, its file
# stays on the box. The helper has no third call: the run takes its copy
# off before it runs it.
$oldThree = @'
function Invoke-OldThreeCalls([string]$Target, [string[]]$SshArgs, [string]$Script) {
  $far = 'C:/Windows/Temp/thornswood-remote-' + [Guid]::NewGuid().ToString('N') + '.ps1'
  $tmp = [IO.Path]::GetTempFileName()
  try {
    [IO.File]::WriteAllText($tmp, $Script, (New-Object Text.UTF8Encoding($true)))
    & scp @SshArgs $tmp "${Target}:$far" 2>&1 | Out-Null
    & ssh @SshArgs $Target "pwsh -NoProfile -ExecutionPolicy Bypass -File $far" 2>&1
  }
  finally {
    & ssh @SshArgs $Target "pwsh -NoProfile -Command Remove-Item -LiteralPath '$far' -Force" 2>&1 | Out-Null
    Remove-Item -LiteralPath $tmp -Force -EA SilentlyContinue
  }
}
'@
. ([scriptblock]::Create($oldThree))
Reset
$global:TsSs.TidyCut = $true
Invoke-OldThreeCalls -Target $target -SshArgs $sshArgs -Script (Long 'cut-old' 0) | Out-Null
$oldLeft = Left
Yes ('cut before its tidy up, the old three calls leave their file on the box (' + $oldLeft + '), so the check below can fail') ($oldLeft -eq 1)
Get-ChildItem -LiteralPath $far -File | Remove-Item -Force
Reset
$global:TsSs.TidyCut = $true
Invoke-ThornswoodRemote -Target $target -SshArgs $sshArgs -Script (Long 'cut-new' 0) | Out-Null
Yes 'with the same cut, the helper leaves nothing on the box: it has no tidy up to cut' ((Left) -eq 0 -and @(Calls 'ssh').Count -eq 1)

# Cut between the copy and the run, the run never starts, so nothing on the
# box can take the copy, and the box gives no sign the caller is gone (a far
# process outlives its session, #3059). The next run takes any such copy
# once it is ten minutes old, the longest a copy waits for its own run, and
# leaves a younger one, which may be another run's on its way.
Reset
$global:TsSs.RunCut = $true
Invoke-ThornswoodRemote -Target $target -SshArgs $sshArgs -Script (Long 'cut-between' 0) 2>&1 | Out-Null
$rc = $LASTEXITCODE
$stale = @(Get-ChildItem -LiteralPath $far -File)
Yes 'cut between the copy and the run: the cut comes back (255) and the copy is left' ($rc -eq 255 -and $stale.Count -eq 1 -and $stale[0].Name -match '^thornswood-remote-[0-9a-f]{32}\.ps1$')
foreach ($x in $stale) { $x.LastWriteTimeUtc = [DateTime]::UtcNow.AddMinutes(-11) }
$young = Join-Path $far ('thornswood-remote-' + [Guid]::NewGuid().ToString('N') + '.ps1')
[IO.File]::WriteAllText($young, "'another run on its way'")
$otherOld = Join-Path $far 'thornswood-remote-notours.ps1'
[IO.File]::WriteAllText($otherOld, "'not a copy of Send-Script.ps1'")
(Get-Item -LiteralPath $otherOld).LastWriteTimeUtc = [DateTime]::UtcNow.AddMinutes(-60)
Reset
Invoke-ThornswoodRemote -Target $target -SshArgs $sshArgs -Script (Long 'after-cut' 0) | Out-Null
Yes 'the next run takes the copy left over ten minutes ago' ($stale.Count -eq 1 -and -not (Test-Path -LiteralPath $stale[0].FullName))
Yes '  and leaves a younger one, and a file whose name is not a copy''s' ((Test-Path -LiteralPath $young) -and (Test-Path -LiteralPath $otherOld) -and (Left) -eq 2)
Get-ChildItem -LiteralPath $far -File | Remove-Item -Force

# ---- 4. host key checking ---------------------------------------------------------
Reset
$threw = $null
try { Invoke-ThornswoodRemote -Target $target -SshArgs @('-o', 'StrictHostKeyChecking=no') -Script "'x'" | Out-Null } catch { $threw = $_ }
Yes 'StrictHostKeyChecking=no from a caller is refused' ($null -ne $threw)
$threw = $null
try { Invoke-ThornswoodRemote -Target $target -SshArgs @('-o', 'StrictHostKeyChecking=accept-new') -Script (Long 'five' 0) | Out-Null } catch { $threw = $_ }
Yes 'and so is accept-new' ($null -ne $threw)
Yes '  before anything was sent' ($global:TsSs.Calls.Count -eq 0)
Reset
Invoke-ThornswoodRemote -Target $target -SshArgs $sshArgs -Script (Long 'six' 0) | Out-Null
Invoke-ThornswoodRemote -Target $target -Script "'y'" | Out-Null
$weak = @($global:TsSs.Calls | Where-Object { ($_.Args -join ' ') -notmatch 'StrictHostKeyChecking=yes' })
Yes ('every ssh and scp call carries StrictHostKeyChecking=yes, long or short, with or without the caller''s options (' + $global:TsSs.Calls.Count + ' calls)') ($global:TsSs.Calls.Count -eq 3 -and $weak.Count -eq 0)
Yes 'the caller''s own options are passed on, to the scp and the ssh of the call that gave them' (@($global:TsSs.Calls | Where-Object { ($_.Args -join ' ') -match 'ConnectTimeout=1' }).Count -eq 2)

# ---- 5. standard input and -Bypass -------------------------------------------------
Reset
$reader = "`$l = [Console]::In.ReadLine(); Write-Output ('GOT ' + `$l)"
$out = @(Invoke-ThornswoodRemote -Target $target -SshArgs $sshArgs -Script $reader -Stdin 'line-on-stdin' | ForEach-Object { "$_" })
Yes '-Stdin: a short script reads the line' ($out -contains 'GOT line-on-stdin')
Reset
$out = @(Invoke-ThornswoodRemote -Target $target -SshArgs $sshArgs -Script ($reader + "`r`n" + (Long 'seven' 0)) -Stdin 'line-on-stdin' | ForEach-Object { "$_" })
Yes '-Stdin: a long one reads it too' ($out -contains 'GOT line-on-stdin' -and @(Calls 'scp').Count -eq 1 -and @(Calls 'ssh').Count -eq 1)
Yes '-Stdin: the line is in no command line and no file sent' (-not (($global:TsSs.Calls | ForEach-Object { ($_.Args -join ' ') + [string]$_.Said + [string]$_.Sent }) -join "`n").Contains('line-on-stdin'))
Reset
$most = 'y' * ($ThornswoodStdinLimit - 2)
$out = @(Invoke-ThornswoodRemote -Target $target -SshArgs $sshArgs -Script "`$l = [Console]::In.ReadLine(); Write-Output ('LEN ' + `$l.Length)" -Stdin $most | ForEach-Object { "$_" })
Yes ('-Stdin: a line of ' + $ThornswoodStdinLimit + ' bytes with its line end, the most the box is measured to take whole, goes') ($out -contains ('LEN ' + $most.Length))
Reset
$threw = $null
try { Invoke-ThornswoodRemote -Target $target -SshArgs $sshArgs -Script "'x'" -Stdin ($most + 'y') | Out-Null } catch { $threw = $_ }
Yes '-Stdin: one byte more is refused, before anything is sent' ($null -ne $threw -and "$threw" -match 'Nothing was sent' -and $global:TsSs.Calls.Count -eq 0)
Reset
Invoke-ThornswoodRemote -Target $target -SshArgs $sshArgs -Script "'z'" -Bypass | Out-Null
Yes '-Bypass: the command line says -ExecutionPolicy Bypass' (@(Calls 'ssh').Count -eq 1 -and @(Calls 'ssh')[0].Command -like 'pwsh -NoProfile -ExecutionPolicy Bypass -EncodedCommand *')
# A new box has only the Windows PowerShell Windows comes with until
# Bootstrap-VPS.ps1 puts PowerShell 7 on it, so -NewBox, which Remote.ps1
# passes for that script alone, is the one line that names it (#5356).
Reset
Invoke-ThornswoodRemote -Target $target -SshArgs $sshArgs -Script "'z'" -NewBox | Out-Null
Yes '-NewBox: the command line starts the Windows PowerShell a new box comes with' (@(Calls 'ssh').Count -eq 1 -and @(Calls 'ssh')[0].Command -like 'powershell -NoProfile -EncodedCommand *')
Reset
Invoke-ThornswoodRemote -Target $target -SshArgs $sshArgs -Script "'z'" | Out-Null
Yes '  and without it, pwsh' (@(Calls 'ssh').Count -eq 1 -and @(Calls 'ssh')[0].Command -like 'pwsh -NoProfile -EncodedCommand *')

# ---- 6. two runs at once ------------------------------------------------------------
#
# Two processes, one far folder. Each waits for the same go file, copies its
# script up, then waits two seconds before its run starts, which is when the
# other one's copy lands. With one shared name the second copy replaces the
# first, and the first runs the wrong script or finds it gone.
$oldCopy = @'
function Invoke-OldRemote([string]$Target, [string[]]$SshArgs, [string]$Script) {
  $far = 'C:/Windows/Temp/thornswood-remote.ps1'
  $tmp = [IO.Path]::GetTempFileName()
  try {
    Set-Content -LiteralPath $tmp -Value $Script -Encoding UTF8
    & scp @SshArgs $tmp "${Target}:$far" 2>&1 | Out-Null
    & ssh @SshArgs $Target "pwsh -NoProfile -ExecutionPolicy Bypass -File $far" 2>&1
    & ssh @SshArgs $Target "pwsh -NoProfile -Command Remove-Item -LiteralPath '$far' -Force" 2>&1 | Out-Null
  }
  finally { Remove-Item -LiteralPath $tmp -Force -EA SilentlyContinue }
}
'@
function Start-AtOnce([string]$how) {
    $farDir = Join-Path $script:work ('far-' + $how)
    New-Item -ItemType Directory -Path $farDir -Force | Out-Null
    $go = Join-Path $script:work ('go-' + $how)
    $jobs = @()
    foreach ($pair in @(@('A', 5), @('B', 6))) {
        $jobs += Start-Job -ScriptBlock {
            param($fakes, $oldCopy, $sendScript, $farDir, $shell, $go, $how, $marker, $code, $target, $script)
            $global:TsSs = @{ Far = $farDir; Shell = $shell; Calls = (New-Object System.Collections.ArrayList); RunDelayMs = 2000; RunThrows = $false; ScpFails = $false; TidyCut = $false; RunCut = $false; CopyGone = $false }
            . ([scriptblock]::Create($fakes))
            . $sendScript
            . ([scriptblock]::Create($oldCopy))
            [IO.File]::WriteAllText(($go + '.' + $marker), 'ready')
            while (-not (Test-Path -LiteralPath $go)) { Start-Sleep -Milliseconds 50 }
            $global:LASTEXITCODE = 0
            if ($how -eq 'new') { $out = @(Invoke-ThornswoodRemote -Target $target -Script $script 2>&1 | ForEach-Object { "$_" }) }
            else { $out = @(Invoke-OldRemote -Target $target -SshArgs @() -Script $script 2>&1 | ForEach-Object { "$_" }) }
            $rc = $LASTEXITCODE
            $names = @($global:TsSs.Calls | Where-Object { $_.Tool -eq 'scp' } | ForEach-Object { $_.Command.Substring($_.Command.IndexOf(':') + 1) })
            [pscustomobject]@{ Marker = $marker; Out = $out; Code = $rc; Names = $names }
        } -ArgumentList $fakes, $oldCopy, $sendScript, $farDir, $farShell, $go, $how, $pair[0], $pair[1], $target, (Long $pair[0] $pair[1])
    }
    $until = (Get-Date).AddSeconds(90)
    while (((Get-ChildItem -LiteralPath $script:work -Filter ('go-' + $how + '.*')).Count -lt 2) -and (Get-Date) -lt $until) { Start-Sleep -Milliseconds 100 }
    [IO.File]::WriteAllText($go, 'go')
    $res = @($jobs | Wait-Job -Timeout 120 | Receive-Job)
    $jobs | Remove-Job -Force
    return [pscustomobject]@{ Results = $res; Left = @(Get-ChildItem -LiteralPath $farDir -File).Count }
}

$new = Start-AtOnce 'new'
$a = @($new.Results | Where-Object { $_.Marker -eq 'A' }) | Select-Object -First 1
$b = @($new.Results | Where-Object { $_.Marker -eq 'B' }) | Select-Object -First 1
Yes 'at once: both runs finished' ($a -and $b)
if ($a -and $b) {
    Yes 'at once: each copied its script up once, under a name of its own' ($a.Names.Count -eq 1 -and $b.Names.Count -eq 1 -and $a.Names[0] -ne $b.Names[0])
    Yes 'at once: each ran its own script and not the other''s' (($a.Out -contains 'MARK A') -and -not ($a.Out -contains 'MARK B') -and ($b.Out -contains 'MARK B') -and -not ($b.Out -contains 'MARK A'))
    Yes ('at once: each got its own exit code (' + $a.Code + ' and ' + $b.Code + ')') ($a.Code -eq 5 -and $b.Code -eq 6)
    Yes 'at once: nothing is left in the far temp folder' ($new.Left -eq 0)
}

$old = Start-AtOnce 'old'
$oa = @($old.Results | Where-Object { $_.Marker -eq 'A' }) | Select-Object -First 1
$ob = @($old.Results | Where-Object { $_.Marker -eq 'B' }) | Select-Object -First 1
$collided = $false
if ($oa -and $ob) {
    $collided = (-not ($oa.Out -contains 'MARK A')) -or (-not ($ob.Out -contains 'MARK B')) -or ($oa.Out -contains 'MARK B') -or ($ob.Out -contains 'MARK A')
}
Yes 'the old copy, run the same way, collides: one run did not run its own script (so the check above can fail)' $collided

# ---- 7. the scripts -----------------------------------------------------------------
$skip = '(?i)[\\/](tests|engine|node_modules|\.git|local|out)[\\/]'
$files = @(Get-ChildItem -LiteralPath $repo -Recurse -File -Filter *.ps1 -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName.Substring($repo.Length) -notmatch $skip })
Yes ('scripts found to read: ' + $files.Count) ($files.Count -gt 100)

# A whole file name in the VPS temp folder written as one literal is a name
# every run shares. A name with a guid added at run time is not one literal.
$fixed = @()
foreach ($f in $files) {
    $tokens = $null; $e = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($f.FullName, [ref]$tokens, [ref]$e)
    foreach ($s in @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.StringConstantExpressionAst] -or $n -is [System.Management.Automation.Language.ExpandableStringExpressionAst] }, $true))) {
        if ($s.Value -match '(?i)^C:[\\/]+Windows[\\/]+Temp[\\/]+[A-Za-z0-9._-]+\.[A-Za-z0-9]+$') { $fixed += ('{0}:{1}  {2}' -f $f.Name, $s.Extent.StartLineNumber, $s.Value) }
    }
}
foreach ($x in $fixed) { Write-Host "      $x" }
Yes ('no script sends to a fixed file name in the VPS temp folder (' + $fixed.Count + ' found)') ($fixed.Count -eq 0)

$shared = @()
foreach ($f in $files) {
    $i = 0
    foreach ($l in [IO.File]::ReadAllLines($f.FullName)) { $i++; if ($l -match '(?i)thornswood-remote\.ps1' -and $l -notmatch '^\s*#' -and $f.Name -ne 'Send-Script.ps1') { $shared += ('{0}:{1}' -f $f.Name, $i) } }
}
Yes ('no script names C:/Windows/Temp/thornswood-remote.ps1 (' + ($shared -join ', ') + ')') ($shared.Count -eq 0)

# A function that copies a script up and runs it by file itself, rather than
# through Send-Script.ps1, names the file afresh each run. Harden-VPS.ps1
# does that on purpose: it sends a file of the repository with its own
# arguments, and it already used a guid before #1070. Feed-Store.ps1 used to
# be the other one; since #1167 Invoke-FeedStoreOp sends through the helper.
$own = @()
foreach ($f in $files) {
    if ($f.Name -eq 'Send-Script.ps1') { continue }
    $tokens = $null; $e = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($f.FullName, [ref]$tokens, [ref]$e)
    foreach ($fn in @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true))) {
        $t = $fn.Extent.Text
        if ($t -match '&\s*scp\b' -and $t -match '-File\s+\$' -and $t -notmatch 'NewGuid\(\)') { $own += ('{0}:{1} {2}' -f $f.Name, $fn.Extent.StartLineNumber, $fn.Name) }
    }
}
foreach ($x in $own) { Write-Host "      $x" }
Yes ('no function copies a script up and runs it by a name it does not make afresh each run (' + $own.Count + ' found)') ($own.Count -eq 0)

$named = @(
    'scripts\deploy\Deploy-DevGamemode.ps1', 'scripts\deploy\Deploy-Docs.ps1', 'scripts\deploy\Deploy-Server.ps1',
    'scripts\deploy\Install-Bot.ps1', 'scripts\deploy\Remirror-Site-Feed.ps1', 'scripts\deploy\Rotate-ServerPassword.ps1',
    'scripts\deploy\Set-DiscordLogin.ps1', 'scripts\deploy\Setup-Domain.ps1', 'scripts\mods\Check-Manifest.ps1',
    'scripts\mods\Clean-Everything.ps1', 'scripts\ops\Set-Door.ps1', 'scripts\ops\Wipe-Saves.ps1',
    'scripts\vps\Backup-Server.ps1', 'scripts\vps\Check-Load.ps1',
    'scripts\vps\Watch-Load.ps1', 'scripts\vps\Watch-Services.ps1',
    'scripts\deploy\Install-Runner.ps1', 'scripts\deploy\Install-Voice.ps1', 'scripts\vps\Check-Site.ps1'
)
$notUsing = @()
foreach ($rel in $named) {
    $path = Join-Path $repo $rel
    $tokens = $null; $e = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$e)
    $fn = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Remote' }, $true))
    $text = [IO.File]::ReadAllText($path)
    $ok = ($fn.Count -eq 1 -and $fn[0].Extent.Text -match 'Invoke-ThornswoodRemote -Target' -and $text -match "Send-Script\.ps1'\)")
    if (-not $ok) { $notUsing += (Split-Path -Leaf $rel) }
}
Yes ('the ' + $named.Count + ' scripts that had a copy load Send-Script.ps1 and their Remote uses it' + $(if ($notUsing.Count) { ': not ' + ($notUsing -join ', ') } else { '' })) ($notUsing.Count -eq 0)
$remoteText = [IO.File]::ReadAllText((Join-Path $repo 'scripts\vps\Remote.ps1'))
$secretText = [IO.File]::ReadAllText((Join-Path $repo 'scripts\vps\Send-Secret.ps1'))
$artifactText = [IO.File]::ReadAllText((Join-Path $repo 'scripts\deploy\Artifact.ps1'))
Yes 'Remote.ps1, Send-Secret.ps1 and Artifact.ps1 send through it too' (
    $remoteText -match 'Invoke-ThornswoodRemote -Target' -and $secretText -match 'Invoke-ThornswoodRemote -Target' -and $artifactText -match 'Invoke-ThornswoodRemote -Target')
$helperText = [IO.File]::ReadAllText($sendScript)
Yes 'Send-Script.ps1 turns host key checking on with =yes and never anything weaker (#1078)' (
    $helperText -match "'StrictHostKeyChecking=yes'" -and $helperText -notmatch 'StrictHostKeyChecking=(no|accept-new)')

# ---- Feed-Store.ps1, through the helper, against the same stand-in (#1167) --
Reset
$feedStore = Join-Path $repo 'scripts\release\Feed-Store.ps1'
Yes 'Feed-Store.ps1 is there' (Test-Path -LiteralPath $feedStore)
. $feedStore
$feedSite = Join-Path $script:work 'feed-site'
New-Item -ItemType Directory -Path $feedSite -Force | Out-Null
$oldSite = $env:THORNSWOOD_TEST_SITE_DIR
Remove-Item Env:THORNSWOOD_TEST_SITE_DIR -ErrorAction SilentlyContinue
try {
    $feedOut = @(Invoke-FeedStoreOp 'main' 'look' @('version.json') @{} @{} '' @{ Vps = 'box.invalid'; User = 'tester'; Root = ($feedSite.Replace('\', '/')) })
} finally {
    if ($null -ne $oldSite) { $env:THORNSWOOD_TEST_SITE_DIR = $oldSite }
}
$feedRc = $LASTEXITCODE
$feedSsh = @(Calls 'ssh')
Yes 'Feed-Store Invoke-FeedStoreOp sends a long script through Invoke-ThornswoodRemote (#1167), by its runner' ($feedSsh.Count -eq 1 -and $feedSsh[0].Command -match $runnerShape -and $feedSsh[0].Copy -and @(Calls 'scp').Count -eq 1)
Yes '  the stand-in ran it and it said DONE' ($feedOut -contains 'DONE')
Yes '  and NONE for a file the scratch store does not have' ($feedOut -contains 'NONE|version.json')
Yes '  and its run took its copy off the far temp folder' ((Left) -eq 0)
Yes '  and the far side''s exit code comes back, not a dropped one' ($feedRc -eq 0)
$feedFn = ''
$ft = $null; $fe = $null
$fast = [System.Management.Automation.Language.Parser]::ParseFile($feedStore, [ref]$ft, [ref]$fe)
foreach ($fn in @($fast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Invoke-FeedStoreOp' }, $true))) { $feedFn = $fn.Extent.Text }
Yes '  and Invoke-FeedStoreOp no longer copies a script up itself' ($feedFn -match 'Invoke-ThornswoodRemote -Target' -and $feedFn -notmatch '&\s*scp\b')

Done
