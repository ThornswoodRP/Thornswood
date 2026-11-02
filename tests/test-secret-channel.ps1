<#
  test-secret-channel.ps1

  Send-Secret.ps1 sends a secret on ssh's standard input and never on a
  command line, and the far side gets it whole (issue #451).

      pwsh -NoProfile -File .\tests\test-secret-channel.ps1

  WHY THIS EXISTS. Every script that sent a secret to the VPS base64'd it into
  the remote script, and the script went to ssh as the command line
  powershell -EncodedCommand <that>. So the value was in the command line of
  ssh here and of cmd.exe and powershell.exe on the VPS while it ran, and over
  6,000 characters it sat in a file in C:\Windows\Temp instead.

  HOW. ssh and scp are swapped for fakes. The fake ssh keeps every argument it
  was handed, then runs the command line through cmd.exe on this machine with
  the same standard input, which is what sshd on the VPS does with it. The
  script that runs is real PowerShell 7, as on the box. It reports a
  hash of what arrived, never the value, and counts the processes whose
  command line holds the value while it runs (Win32_Process, what a process
  list shows). The fake scp copies into a scratch folder that stands in for
  C:\Windows\Temp on the box, and keeps what it copied.

  The value is made here at run time, with quotes, a dollar, a backtick, an
  ampersand and an accent in it: everything ssh, cmd and PowerShell could
  mangle. Nothing prints it.

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

$helper = Join-Path $repo 'scripts\vps\Send-Secret.ps1'
$remotePs1 = Join-Path $repo 'scripts\vps\Remote.ps1'
Yes 'scripts\vps\Send-Secret.ps1 is there' (Test-Path -LiteralPath $helper)
foreach ($f in @($helper, $remotePs1)) {
    $errs = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile($f, [ref]$null, [ref]$errs)
    Yes ((Split-Path -Leaf $f) + ' parses') (@($errs).Count -eq 0)
}
. $helper

. (Join-Path $PSScriptRoot 'Windows.ps1')
if (-not $OnWindows) {
    Write-Host 'SKIP  the rest: it runs as the box does, through cmd.exe, and counts what Win32_Process shows, which only Windows has'
    Done
}
# The far line names pwsh, which cmd.exe finds on PATH as the box's does.
$cmdExe = Get-WindowsPath 'System32\cmd.exe'

# ---- the fakes -----------------------------------------------------------
$work = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-secret-channel-' + [Guid]::NewGuid().ToString('N'))
$farDir = Join-Path $work 'far'
New-Item -ItemType Directory -Path $farDir -Force | Out-Null
# No $script: on these two: the fakes also run from inside Remote.ps1, whose
# own script scope would be the one $script: named there.
$ScFar = $farDir
$ScCalls = New-Object System.Collections.ArrayList

function ssh {
    $a = @($args | ForEach-Object { [string]$_ })
    $in = @($input)
    [void]$ScCalls.Add([pscustomobject]@{ Tool = 'ssh'; Args = $a; Sent = ''; Stdin = @($in | ForEach-Object { [string]$_ }) })
    # The box's C:/Windows/Temp is the scratch folder here.
    $line = $a[-1].Replace('C:/Windows/Temp/', ($ScFar.Replace('\', '/') + '/'))
    $m = [regex]::Match($line, '-EncodedCommand (\S+)$')
    if ($m.Success) {
        # A long script's runner (Send-Script.ps1, #3059) takes its copy
        # from the scratch folder too, and sweeps that folder, not the
        # machine's own C:\Windows\Temp.
        $said = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($m.Groups[1].Value))
        $copy = Get-ThornswoodRemoteRunnerPath $said
        if ($copy) {
            $said = $said.Replace($copy, (Join-Path $ScFar ($copy -split '\\')[-1])).Replace("'C:\Windows\Temp'", ("'" + $ScFar + "'"))
            $line = $line.Substring(0, $m.Groups[1].Index) + [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($said))
        }
    }
    if ($in.Count) { $in | & $cmdExe /d /c $line }
    else { & $cmdExe /d /c $line }
}

function scp {
    $a = @($args | ForEach-Object { [string]$_ })
    $src = $a[-2]; $dst = $a[-1]
    $far = $dst.Substring($dst.IndexOf(':') + 1).Replace('C:/Windows/Temp/', ($ScFar + '\'))
    $text = [IO.File]::ReadAllText($src)
    Copy-Item -LiteralPath $src -Destination $far -Force
    [void]$ScCalls.Add([pscustomobject]@{ Tool = 'scp'; Args = $a; Sent = $text })
    $global:LASTEXITCODE = 0
}

# Everything ssh and scp were handed, with every -EncodedCommand decoded and
# every file scp copied, as one text to look for the value in.
function AllSent {
    $sb = New-Object Text.StringBuilder
    foreach ($c in $ScCalls) {
        foreach ($x in $c.Args) {
            [void]$sb.AppendLine($x)
            $m = [regex]::Match($x, '-EncodedCommand (\S+)')
            if ($m.Success) { [void]$sb.AppendLine([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($m.Groups[1].Value))) }
        }
        [void]$sb.AppendLine($c.Sent)
    }
    return $sb.ToString()
}

function Hash([string]$s) {
    $sha = [Security.Cryptography.SHA256]::Create()
    return [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($s))).Replace('-', '')
}

# What runs on the far side: the hash of what arrived and how many process
# command lines hold it, never the value itself.
$probe = @'
$h = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes([string]$ThornswoodSecret))).Replace('-', '')
'HASH ' + $h
if ($ThornswoodSecret) {
  $w = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($ThornswoodSecret))
  # Each command line as it is and with any -EncodedCommand decoded, because
  # decoding it is all anybody reading the process list has to do.
  $seen = 0
  foreach ($p in @(Get-CimInstance Win32_Process)) {
    $c = [string]$p.CommandLine
    if (-not $c) { continue }
    $m = [regex]::Match($c, '-EncodedCommand\s+(\S+)')
    if ($m.Success) { try { $c += "`n" + [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($m.Groups[1].Value.Trim('"'))) } catch { } }
    if ($c.Contains($ThornswoodSecret) -or $c.Contains($w)) { $seen++ }
  }
  'SEEN ' + $seen
} else { 'EMPTY' }
'@

function Said($out, [string]$key) {
    $l = @($out | ForEach-Object { [string]$_ } | Where-Object { $_ -like ($key + ' *') } | Select-Object -First 1)
    if ($l.Count) { return $l[0].Substring($key.Length + 1).Trim() }
    return ''
}

$tick = [string][char]0x60
$secret = 'tw-' + [Guid]::NewGuid().ToString('N') + ' q''s "d" $x ' + $tick + 'y & | ^ % < > ' + [string][char]0x00E9
$wire = ConvertTo-ThornswoodSecretWire $secret

try {
    # ---- 0. the old way, so the checks below are known to see a leak: the
    # value base64'd into the script, the script on the command line.
    $ScCalls.Clear()
    $old = "`$ThornswoodSecret = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('$wire'))`r`n" + $probe
    $e = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($old))
    $out = & ssh 'tester@box.invalid' "pwsh -NoProfile -EncodedCommand $e"
    Yes 'control: the old way puts the value where these checks look' ((AllSent).Contains($wire))
    Yes 'control: and the process list shows it while the far side runs' ([int](Said $out 'SEEN') -gt 0)
    $old = $null; $e = $null

    # ---- 1. a short script: on the command line, the value on standard input
    $ScCalls.Clear()
    $out = Invoke-ThornswoodSecretRemote -Target 'tester@box.invalid' -SshArgs @('-o', 'BatchMode=yes') -Script $probe -Secret $secret
    Yes 'short: one ssh call and no scp' (@($ScCalls | Where-Object { $_.Tool -eq 'ssh' }).Count -eq 1 -and @($ScCalls | Where-Object { $_.Tool -eq 'scp' }).Count -eq 0)
    Yes 'short: the script went as pwsh -NoProfile -EncodedCommand' ($ScCalls.Count -and $ScCalls[0].Args[-1] -match '^pwsh -NoProfile -EncodedCommand \S+$')
    # Send-Secret.ps1 adds host key checking after the caller's own options (#450).
    Yes 'short: the ssh options and the target are passed as given, host key checking added' ($ScCalls.Count -and ($ScCalls[0].Args[0..4] -join ' ') -eq '-o BatchMode=yes -o StrictHostKeyChecking=yes tester@box.invalid')
    Yes 'short: the far side got the value whole, quotes, dollar, backtick, ampersand and accent included' ((Said $out 'HASH') -eq (Hash $secret))
    Yes 'short: no process command line held the value while the far side ran' ((Said $out 'SEEN') -eq '0')
    $all = AllSent
    Yes 'short: the value is in nothing handed to ssh, plain or base64, nor in the script' (-not $all.Contains($secret) -and -not $all.Contains($wire))
    Yes 'short: the output does not carry the value' (-not ((@($out) -join "`n").Contains($secret)))

    # ---- 2. a long script: by scp, the value on standard input (#3059)
    $ScCalls.Clear()
    $out = Invoke-ThornswoodSecretRemote -Target 'tester@box.invalid' -Script ($probe + "`r`nexit 7") -Secret $secret -Limit 200
    $rc = $LASTEXITCODE
    $calls = @($ScCalls | Where-Object { $_.Tool -eq 'ssh' })
    $copies = @($ScCalls | Where-Object { $_.Tool -eq 'scp' })
    $scriptText = ''
    if ($copies.Count) { $scriptText = [string]$copies[0].Sent }
    $runner = ''
    if ($calls.Count -and $calls[0].Args[-1] -match '-EncodedCommand (\S+)$') { $runner = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($Matches[1])) }
    $copy = Get-ThornswoodRemoteRunnerPath $runner
    Yes 'long: one scp and one ssh call' ($calls.Count -eq 1 -and $copies.Count -eq 1)
    Yes 'long: the command line is Send-Script.ps1''s runner, naming the copy scp made' ($copy -and $runner -eq (Get-ThornswoodRemoteRunner -Path $copy) -and $copies[0].Args[-1].EndsWith(':' + $copy.Replace('\', '/')))
    Yes 'long: the script went whole by scp' ($scriptText.Contains('SEEN ') -and $scriptText.TrimEnd().EndsWith('exit 7'))
    Yes 'long: the value is on standard input, the one line there' (@($calls[0].Stdin).Count -eq 1 -and @($calls[0].Stdin)[0] -eq $wire)
    Yes 'long: the script''s copy does not hold the value, plain or base64' ($scriptText -and -not $scriptText.Contains($secret) -and -not $scriptText.Contains($wire))
    Yes 'long: the far side got the value whole' ((Said $out 'HASH') -eq (Hash $secret))
    Yes 'long: no process command line held the value while it ran' ((Said $out 'SEEN') -eq '0')
    Yes 'long: the far end''s exit code comes back' ($rc -eq 7)
    Yes 'long: its run took its copy off the box''s temp folder' (@(Get-ChildItem -LiteralPath $farDir -File).Count -eq 0)
    $all = AllSent
    Yes 'long: the value is in nothing handed to ssh as an argument, nor in the script' (-not $all.Contains($secret) -and -not $all.Contains($wire))

    # ---- 3. -Bypass is passed on
    $ScCalls.Clear()
    $out = Invoke-ThornswoodSecretRemote -Target 'tester@box.invalid' -Script $probe -Secret 'abc' -Bypass
    Yes '-Bypass: the command line says -ExecutionPolicy Bypass' ($ScCalls.Count -and $ScCalls[0].Args[-1] -match '^pwsh -NoProfile -ExecutionPolicy Bypass -EncodedCommand ')
    Yes '-Bypass: the value still arrives' ((Said $out 'HASH') -eq (Hash 'abc'))

    # ---- 4. an empty value arrives empty, and the script can refuse on it
    $ScCalls.Clear()
    $out = Invoke-ThornswoodSecretRemote -Target 'tester@box.invalid' -Script $probe -Secret ''
    Yes 'empty: the far side sees an empty value' (@($out | Where-Object { "$_" -eq 'EMPTY' }).Count -eq 1)

    # ---- 5. a JSON payload, the shape Install-Bot and Set-DiscordLogin send
    $ScCalls.Clear()
    $tok = 'part1.' + [Guid]::NewGuid().ToString('N') + '.part3'
    $payload = @{ token = $tok; key = 'k' + [Guid]::NewGuid().ToString('N') } | ConvertTo-Json -Compress
    $out = Invoke-ThornswoodSecretRemote -Target 'tester@box.invalid' -Secret $payload -Script @'
$p = $ThornswoodSecret | ConvertFrom-Json
'HASH ' + [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes([string]$p.token))).Replace('-', '')
'@
    Yes 'json: the far side reads the token out of the payload' ((Said $out 'HASH') -eq (Hash $tok))
    Yes 'json: the token is in nothing handed to ssh' (-not (AllSent).Contains($tok))

    # ---- 6. Remote.ps1 -Secret, the way Discord-Hook.ps1 -Save uses it: a
    # SecureString handed over by a script that asked for it (#1069)
    $ScCalls.Clear()
    $out = @(& $remotePs1 ($probe + "`r`nexit 5") -Secret (ConvertTo-SecureString $secret -AsPlainText -Force) -VpsHost 'box.invalid' -VpsUser 'tester' 2>&1 | ForEach-Object { "$_" })
    $rc = $LASTEXITCODE
    Yes 'Remote.ps1 -Secret: one ssh call to the box' (@($ScCalls | Where-Object { $_.Tool -eq 'ssh' }).Count -eq 1 -and $ScCalls[0].Args -contains 'tester@box.invalid')
    Yes 'Remote.ps1 -Secret: the far side got the value whole' ((Said $out 'HASH') -eq (Hash $secret))
    Yes 'Remote.ps1 -Secret: no process command line held it' ((Said $out 'SEEN') -eq '0')
    Yes 'Remote.ps1 -Secret: the exit code comes back' ($rc -eq 5)
    $all = AllSent
    Yes 'Remote.ps1 -Secret: the value is in nothing handed to ssh' (-not $all.Contains($secret) -and -not $all.Contains($wire))

    # ---- 6b. a value typed after -Secret is refused before anything is sent:
    # typed, it would be in the shell's history (#1069)
    $ScCalls.Clear()
    $typed = $null
    try { & $remotePs1 "'x'" -Secret 'typed-on-the-command-line' -VpsHost 'box.invalid' -VpsUser 'tester' 2>&1 | Out-Null } catch { $typed = $_ }
    Yes 'Remote.ps1 -Secret refuses a typed value' ($null -ne $typed)
    Yes 'Remote.ps1 -Secret: and nothing went to ssh or scp' ($ScCalls.Count -eq 0)

    # ---- 7. Remote.ps1 without -Secret is unchanged: the script on the command line
    $ScCalls.Clear()
    $out = @(& $remotePs1 "'plain'" -VpsHost 'box.invalid' -VpsUser 'tester' 2>&1 | ForEach-Object { "$_" })
    Yes 'Remote.ps1 without -Secret still runs the script' (@($out | Where-Object { $_ -eq 'plain' }).Count -eq 1)
}
finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

Done
