<#
  test-ssh-stderr.ps1

      pwsh -NoProfile -File .\tests\test-ssh-stderr.ps1

  A line ssh or scp writes on stderr is not an error by itself, and a real
  failure still is, by its exit code. Issue #941.

  WHY. From 28 September the OpenSSH client on Patrick's machine prints
  "** WARNING: connection is not using a post-quantum key exchange
  algorithm." on stderr for every connection to the VPS. Under Windows
  PowerShell 5.1 a native program's stderr line becomes an error record when
  stderr is redirected (2>&1, 2>$null, or a caller that redirected the whole
  script), and with $ErrorActionPreference = 'Stop', which every script sets,
  that stopped the script: Install-Voice.ps1 under powershell.exe died in
  Remote.ps1 with a NativeCommandError and exit 1, having done nothing wrong.
  Every ssh, scp, ssh-keygen and ssh-keyscan now runs inside
  Invoke-ThornswoodNative (scripts\vps\Vps.ps1).

  HOW. A stand-in ssh.cmd and scp.cmd, first on PATH, print that warning on
  stderr, echo their standard input, and exit with the code this test asks
  for. The checks run in a child pwsh, the PowerShell the scripts run in
  since #5356, so they get an engine of their own:
    1. A bare "& ssh ... 2>&1" under Stop does not throw in PowerShell 7,
       which is how 7 always behaved.
    2. Through Invoke-ThornswoodNative, under Stop: 2>&1, 2>$null, | Out-Null
       and no redirection all go through, the stdout lines come back as
       strings and the warning as an error record, and $LASTEXITCODE is 0.
    3. Exit 255 (ssh could not connect) comes back as 255, still no throw,
       so the caller's exit code check is what decides.
    4. Standard input piped in reaches ssh (the secret channel's path).
    5. Remote.ps1 end to end, short script and long (by scp and a runner,
       #3059), and called with 2>$null the way Install-Voice.ps1
       calls it: exit 0 with the far end's output; 255 when ssh fails.
    6. Send-Secret.ps1's Invoke-ThornswoodSecretRemote with the warning:
       the value arrives on standard input and the output comes back.
  Then, once, by reading the scripts with PowerShell's parser: no ssh, scp,
  sftp, ssh-keygen or ssh-keyscan under scripts\ runs outside
  Invoke-ThornswoodNative, and every file that uses it can reach Vps.ps1.
  Never connects to anything.
#>
[CmdletBinding()]
param(
    # Internal: run the checks in this PowerShell and print PASS/FAIL lines.
    [string]$Child = ''
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent $Here
. (Join-Path $PSScriptRoot 'Windows.ps1')

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

$warning = '** WARNING: connection is not using a post-quantum key exchange algorithm.'

if ($Child) {
    # ------------------------------------------------------ one PowerShell -----
    $env:PATH = $Child + [IO.Path]::PathSeparator + $env:PATH
    $v = $PSVersionTable.PSVersion.Major
    $tag = "[PS $v]"
    . (Join-Path $repo 'scripts\vps\Vps.ps1')
    $env:TS_FAKE_RC = '0'

    # 1. The fault, reproduced without the helper.
    $threw = $false
    try { $null = & ssh -o BatchMode=yes tester@box.invalid 'echo hi' 2>&1 } catch { $threw = $true }
    Yes "$tag PowerShell 7 never threw on stderr, so a bare call does not" (-not $threw)

    # 2. Through the helper.
    $threw = $false; $out = @()
    try { $out = @(Invoke-ThornswoodNative { & ssh -o BatchMode=yes tester@box.invalid 'echo hi' } 2>&1) } catch { $threw = $true }
    Yes "$tag 2>&1: no throw" (-not $threw)
    Yes "$tag   exit code 0" ($LASTEXITCODE -eq 0)
    Yes "$tag   the far end's line comes back as a string" (@($out | Where-Object { $_ -is [string] -and $_ -eq 'far-end-said-hi' }).Count -eq 1)
    Yes "$tag   the warning comes back as an error record, so Where-Object { `$_ -is [string] } still drops it" (@($out | Where-Object { -not ($_ -is [string]) -and ([string]$_).Trim() -eq $warning }).Count -eq 1)

    $threw = $false
    try { $out = @(Invoke-ThornswoodNative { & ssh tester@box.invalid 'x' } 2>$null) } catch { $threw = $true }
    Yes "$tag 2>`$null: no throw, and only stdout" ((-not $threw) -and ($out -join '|') -eq 'far-end-said-hi')

    $threw = $false
    try { Invoke-ThornswoodNative { & scp C:\nothing tester@box.invalid:C:/x } 2>&1 | Out-Null } catch { $threw = $true }
    Yes "$tag scp 2>&1 | Out-Null: no throw, exit 0" ((-not $threw) -and $LASTEXITCODE -eq 0)

    $threw = $false
    try { $out = @(Invoke-ThornswoodNative { & ssh tester@box.invalid 'x' }) } catch { $threw = $true }
    Yes "$tag no redirection: no throw, stdout captured" ((-not $threw) -and ($out -join '|') -eq 'far-end-said-hi')

    # 3. A real failure is still one, by its exit code.
    $env:TS_FAKE_RC = '255'
    $threw = $false
    try { $out = @(Invoke-ThornswoodNative { & ssh tester@box.invalid 'x' } 2>&1) } catch { $threw = $true }
    Yes "$tag ssh exit 255 comes back as 255 for the caller to judge" ((-not $threw) -and $LASTEXITCODE -eq 255)
    $env:TS_FAKE_RC = '0'

    # 4. Standard input reaches ssh.
    $env:TS_FAKE_STDIN = '1'
    $out = @('line-on-stdin' | Invoke-ThornswoodNative { $input | & ssh tester@box.invalid 'x' } 2>&1 | Where-Object { $_ -is [string] })
    Yes "$tag piped standard input reaches ssh" (($out -contains 'stdin:line-on-stdin') -and $LASTEXITCODE -eq 0)
    $env:TS_FAKE_STDIN = ''

    # 5. Remote.ps1, as a script run from a script that set Stop.
    $remote = Join-Path $repo 'scripts\vps\Remote.ps1'
    $threw = $false; $text = ''
    try { $text = (& $remote "'x'" -VpsHost box.invalid -VpsUser tester 2>&1 | Out-String) } catch { $threw = $true; $text = [string]$_ }
    Yes "$tag Remote.ps1 short script: no throw, exit 0" ((-not $threw) -and $LASTEXITCODE -eq 0 -and $text -match 'far-end-said-hi')
    $threw = $false
    try { $text = (& $remote "'x'" -VpsHost box.invalid -VpsUser tester 2>$null | Out-String) } catch { $threw = $true }
    Yes "$tag Remote.ps1 called with 2>`$null, the way Install-Voice.ps1 calls it: no throw, exit 0" ((-not $threw) -and $LASTEXITCODE -eq 0 -and $text -match 'far-end-said-hi')
    $long = "'" + ('y' * 4000) + "'"
    $threw = $false
    try { $text = (& $remote $long -VpsHost box.invalid -VpsUser tester 2>&1 | Out-String) } catch { $threw = $true; $text = [string]$_ }
    Yes "$tag Remote.ps1 long script (by scp and its runner): no throw, exit 0" ((-not $threw) -and $LASTEXITCODE -eq 0 -and $text -match 'far-end-said-hi')
    $env:TS_FAKE_RC = '255'
    $threw = $false
    try { $null = (& $remote "'x'" -VpsHost box.invalid -VpsUser tester 2>&1 | Out-String) } catch { $threw = $true }
    Yes "$tag Remote.ps1 when ssh fails: exit 255, not 0" ((-not $threw) -and $LASTEXITCODE -eq 255)
    $threw = $false
    try { $null = (& $remote $long -VpsHost box.invalid -VpsUser tester 2>&1 | Out-String) } catch { $threw = $true }
    Yes "$tag Remote.ps1 long script when scp fails: exit 255, not 0" ((-not $threw) -and $LASTEXITCODE -eq 255)
    $env:TS_FAKE_RC = '0'

    # 6. The secret channel.
    . (Join-Path $repo 'scripts\vps\Send-Secret.ps1')
    $env:TS_FAKE_STDIN = '1'
    $threw = $false; $out = @()
    try { $out = @(Invoke-ThornswoodSecretRemote -Target 'tester@box.invalid' -SshArgs @('-o', 'BatchMode=yes') -Secret 'not-a-secret' -Script "'x'") } catch { $threw = $true }
    $wire = ConvertTo-ThornswoodSecretWire 'not-a-secret'
    Yes "$tag Invoke-ThornswoodSecretRemote: no throw, exit 0" ((-not $threw) -and $LASTEXITCODE -eq 0)
    Yes "$tag   the value went on standard input" (@($out | Where-Object { $_ -is [string] }) -contains ('stdin:' + $wire))

    $env:TS_FAKE_STDIN = ''
    Write-Host ("CHILD {0} {1}" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}

# ------------------------------------------------------------ the stand-in -----
$bin = Join-Path ([IO.Path]::GetTempPath()) ('ts-ssh-stderr-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $bin | Out-Null
try {
    # Prints the warning on stderr, the far end's line on stdout, echoes each
    # line of standard input as stdin:<line>, and exits with TS_FAKE_RC.
    # Standard input is read only under TS_FAKE_STDIN=1, the checks that pipe
    # something in, so a call with nothing piped does not wait on a console.
    $cmd = @(
        '@echo off',
        ('echo ' + $warning + ' 1>&2'),
        'if "%TS_FAKE_RC%"=="255" exit /b 255',
        'echo far-end-said-hi',
        'if "%TS_FAKE_STDIN%"=="1" for /f "usebackq delims=" %%L in (`findstr /r "^"`) do echo stdin:%%L',
        'exit /b %TS_FAKE_RC%'
    ) -join "`r`n"
    if ($OnWindows) {
        [IO.File]::WriteAllText((Join-Path $bin 'ssh.cmd'), $cmd + "`r`n", (New-Object Text.ASCIIEncoding))
        [IO.File]::WriteAllText((Join-Path $bin 'scp.cmd'), $cmd + "`r`n", (New-Object Text.ASCIIEncoding))
    } else {
        # Off Windows nothing runs a .cmd, so the same stand-in as a shell script.
        $sh = @(
            '#!/bin/sh',
            ("printf '%s\n' '" + $warning + "' 1>&2"),
            'if [ "$TS_FAKE_RC" = "255" ]; then exit 255; fi',
            'echo far-end-said-hi',
            'if [ "$TS_FAKE_STDIN" = "1" ]; then while IFS= read -r l || [ -n "$l" ]; do printf ''stdin:%s\n'' "$l"; done; fi',
            'exit "${TS_FAKE_RC:-0}"'
        ) -join "`n"
        foreach ($n in 'ssh', 'scp') {
            $f = Join-Path $bin $n
            [IO.File]::WriteAllText($f, $sh + "`n", (New-Object Text.ASCIIEncoding))
            & chmod 755 $f
        }
    }

    # The scripts run in PowerShell 7 only (#5356).
    $shells = @(Get-BoxPowerShell)
    # This runs under Stop too, and the children write on stderr.
    . (Join-Path $repo 'scripts\vps\Vps.ps1')
    foreach ($sh in $shells) {
        $lines = @(Invoke-ThornswoodNative { & $sh -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath -Child $bin } 2>&1 | ForEach-Object { [string]$_ })
        $rc = $LASTEXITCODE
        foreach ($l in $lines) {
            if ($l -match '^PASS  ') { $script:pass++; Write-Host $l }
            elseif ($l -match '^FAIL  ') { $script:fail++; Write-Host $l }
        }
        $done = @($lines | Where-Object { $_ -match '^CHILD ' })
        Yes ("the checks ran to the end under " + (Split-Path -Leaf $sh)) ($done.Count -eq 1 -and ($rc -eq 0 -or $script:fail))
        if (-not $done.Count) { $lines | Select-Object -Last 15 | ForEach-Object { Write-Host ("    " + $_) } }
    }
}
finally {
    Remove-Item -LiteralPath $bin -Recurse -Force -ErrorAction SilentlyContinue
}

# ------------------------------------------------------------ every script -----
$names = @('ssh', 'scp', 'sftp', 'ssh-keygen', 'ssh-keyscan', 'ssh.exe', 'scp.exe', 'sftp.exe', 'ssh-keygen.exe', 'ssh-keyscan.exe')
$bare = @()
$users = @()
$wrapped = 0
foreach ($f in (Get-ChildItem -LiteralPath (Join-Path $repo 'scripts') -Filter *.ps1 -File -Recurse)) {
    $rel = $f.FullName.Substring($repo.Length + 1).Replace([string][IO.Path]::DirectorySeparatorChar, '\')
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($f.FullName, [ref]$null, [ref]$null)
    $uses = $false
    foreach ($c in $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true)) {
        $n = $c.GetCommandName()
        if ($n -eq 'Invoke-ThornswoodNative') { $uses = $true; continue }
        if (-not $n -or ($names -notcontains $n.ToLowerInvariant())) { continue }
        $p = $c.Parent; $in = $false
        while ($p) {
            if ($p -is [System.Management.Automation.Language.CommandAst] -and $p.GetCommandName() -eq 'Invoke-ThornswoodNative') { $in = $true; break }
            $p = $p.Parent
        }
        if ($in) { $wrapped++ } else { $bare += ('{0}:{1}' -f $rel, $c.Extent.StartLineNumber) }
    }
    if ($uses -and $rel -ne 'scripts\vps\Vps.ps1') {
        $t = [IO.File]::ReadAllText($f.FullName)
        if ($t -notmatch '(?i)(Vps|Send-Script|Send-Secret|Artifact|Feed-Store)\.ps1''\)') { $users += $rel }
    }
}
Yes ('no ssh, scp, sftp, ssh-keygen or ssh-keyscan under scripts\ runs outside Invoke-ThornswoodNative' + $(if ($bare.Count) { ': ' + ($bare -join ', ') } else { '' })) ($bare.Count -eq 0)
Yes ("  and there are real calls inside it ($wrapped)") ($wrapped -ge 70)
Yes ('every file that uses it dot-sources Vps.ps1 or a helper that does' + $(if ($users.Count) { ': ' + ($users -join ', ') } else { '' })) ($users.Count -eq 0)

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
