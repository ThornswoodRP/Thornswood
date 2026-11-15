<#
  test-ssh-host-keys.ps1

      pwsh -NoProfile -File .\tests\test-ssh-host-keys.ps1

  Every ssh and scp a script runs against the VPS checks the box's host key
  with StrictHostKeyChecking=yes, and the key it checks against is the one
  scripts\vps\vps.json pins.

  WHY. About thirty scripts ran ssh and scp against the VPS as Administrator
  with StrictHostKeyChecking=no, which takes whatever key answers. Anything
  sitting between this machine and the box could have answered as the box and
  been handed the scripts, the logs and the secrets they carry. The 25
  September audit found it and they moved to accept-new (#362), which still
  takes whatever answers the first time a machine connects. Issue #450,
  Patrick, 28 September: host key checking on in every script. So every call
  says yes, ssh never adds a key by itself, and Setup-SshKey.ps1 is the one
  step that writes the box into known_hosts, and only a key whose fingerprint
  vps.json pins.

  HOW. Every .ps1 under tools and scripts is read with PowerShell's own
  parser, so a comment that explains the old option does not count and a
  string that passes it to ssh does.
    1. No token turns checking down: StrictHostKeyChecking with any value but
       yes (no, off, accept-new, ask), or a known_hosts file of /dev/null or
       NUL, which makes every key new.
    2. Every command that runs ssh, scp or sftp carries
       StrictHostKeyChecking=yes, on its own line or through a splatted
       array (& ssh @ssh ...) that the same file fills with it. A bare
       "& ssh $target" would fall back to ask, which prompts. "& $ssh ..."
       counts as ssh when the file got $ssh from Get-Command ssh. Every
       call to Invoke-ThornswoodSecretRemote (Send-Secret.ps1, #451) hands
       it such an array, and Send-Secret.ps1 itself adds the option and
       refuses a weaker one, run here against a stand-in ssh.
    3. The same for the other languages: no .py, .js, .sh, .cmd or workflow
       file turns it off.
    4. vps.json pins the box's host keys as SHA256 fingerprints and carries
       nothing that looks like a private key.
    5. Setup-SshKey.ps1 writes StrictHostKeyChecking yes into the ssh config
       Host block and writes known_hosts only through Add-ThornswoodKnownHost.
    6. Add-ThornswoodKnownHost and Test-ThornswoodKnownHost (Vps.ps1), run
       against throwaway keys made here and a stand-in ssh-keyscan: a pinned
       key is written, a key that is not pinned is refused with nothing
       written, and a known_hosts that already holds a wrong key is refused.
       Never connects to anything.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# The tests are in tests\, what they test is in scripts\.
$repo = Split-Path -Parent $Here

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Rel([string]$p) { return $p.Substring($repo.Length + 1) }

$files = @()
foreach ($d in @((Join-Path $repo 'scripts'))) {
    # Not the scripts' own harnesses in scripts\tests (#5341), which name what they look for.
    if (Test-Path -LiteralPath $d) { $files += @(Get-ChildItem -LiteralPath $d -Filter *.ps1 -File -Recurse | Where-Object { $_.FullName -notmatch '[\\/]scripts[\\/]tests[\\/]' }) }
}

# ---- 1 and 2: the PowerShell scripts -------------------------------------------
$off = @()
$bare = @()
$calls = 0
$secretCalls = 0
$helperCalls = 0
$contentCalls = 0
$onBoxCalls = 0
foreach ($f in $files) {
    $tokens = $null; $errors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($f.FullName, [ref]$tokens, [ref]$errors)
    foreach ($t in $tokens) {
        if ($t.Kind -eq 'Comment') { continue }
        $m = [regex]::Match($t.Text, '(?i)StrictHostKeyChecking\s*[= ]\s*"?([A-Za-z-]+)')
        if ($m.Success -and $m.Groups[1].Value -ne 'yes') {
            $off += ('{0}:{1} ({2})' -f (Rel $f.FullName), $t.Extent.StartLineNumber, $m.Groups[1].Value)
        }
        if ($t.Text -match '(?i)(UserKnownHostsFile|GlobalKnownHostsFile)\s*[= ]\s*"?(/dev/null|NUL)\b') {
            $off += ('{0}:{1} (known_hosts thrown away)' -f (Rel $f.FullName), $t.Extent.StartLineNumber)
        }
    }

    # The arrays this file fills with the strict option, by variable name.
    # And the variables that hold ssh itself, for "& $ssh ..." (Watch-Outside.ps1
    # finds it with Get-Command so it can say when it is missing).
    $strictVars = @{}
    $toolVars = @{}
    $assigns = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.AssignmentStatementAst] }, $true)
    foreach ($a in $assigns) {
        $left = $a.Left
        if ($left -is [System.Management.Automation.Language.ConvertExpressionAst]) { $left = $left.Child }
        if (-not ($left -is [System.Management.Automation.Language.VariableExpressionAst])) { continue }
        $vn = $left.VariablePath.UserPath.ToLowerInvariant()
        if ($a.Right.Extent.Text -match 'StrictHostKeyChecking=yes') { $strictVars[$vn] = $true }
        if ($a.Right.Extent.Text -match '(?i)Get-Command\s+[''"]?(ssh|scp|sftp)(\.exe)?\b|^[''"][^''"]*\\(ssh|scp|sftp)\.exe[''"]$') { $toolVars[$vn] = $true }
    }

    $cmds = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true)
    foreach ($c in $cmds) {
        $name = $c.GetCommandName()
        if (-not $name) {
            $first = $c.CommandElements[0]
            if ($c.InvocationOperator -ne 'Unknown' -and $first -is [System.Management.Automation.Language.VariableExpressionAst] -and
                -not $first.Splatted -and $toolVars.ContainsKey($first.VariablePath.UserPath.ToLowerInvariant())) { $name = 'ssh' }
            else { continue }
        }
        if ($name -eq 'Invoke-ThornswoodSecretRemote' -or $name -eq 'Invoke-ThornswoodRemote' -or $name -eq 'Start-ThornswoodRemote') {
            # Send-Secret.ps1 and Send-Script.ps1 (#1070, and its held run
            # Start-ThornswoodRemote, #3059) add the option themselves and
            # refuse a weaker one, but a caller still hands them the script's
            # strict array.
            if ($name -eq 'Invoke-ThornswoodSecretRemote') { $secretCalls++ } else { $helperCalls++ }
            $okS = $false
            for ($i = 0; $i -lt $c.CommandElements.Count - 1; $i++) {
                $e = $c.CommandElements[$i]
                if ($e -is [System.Management.Automation.Language.CommandParameterAst] -and $e.ParameterName -eq 'SshArgs') {
                    $v = $c.CommandElements[$i + 1]
                    if ($v.Extent.Text -match 'StrictHostKeyChecking=yes' -or
                        ($v -is [System.Management.Automation.Language.VariableExpressionAst] -and $strictVars.ContainsKey($v.VariablePath.UserPath.ToLowerInvariant()))) { $okS = $true }
                }
            }
            # ServerContent.ps1 (#2334) and OnBox.ps1 (#3035) pass their
            # caller's array through, the way Artifact.ps1 does; their callers
            # are checked just below.
            if (-not $okS -and $f.Name -notin @('Send-Script.ps1', 'Send-Secret.ps1', 'Artifact.ps1', 'ServerContent.ps1', 'OnBox.ps1')) { $bare += ('{0}:{1} ({2})' -f (Rel $f.FullName), $c.Extent.StartLineNumber, $name) }
            continue
        }
        if ($name -eq 'Open-ThornswoodOnBoxFolder') {
            # Its -SshArgs defaults to none, and the folder it hands back
            # carries the array to Close-ThornswoodOnBoxFolder, so a caller
            # always hands it a strict one.
            $onBoxCalls++
            $okS = $false
            for ($i = 0; $i -lt $c.CommandElements.Count - 1; $i++) {
                $e = $c.CommandElements[$i]
                if ($e -is [System.Management.Automation.Language.CommandParameterAst] -and $e.ParameterName -eq 'SshArgs') {
                    $v = $c.CommandElements[$i + 1]
                    if ($v.Extent.Text -match 'StrictHostKeyChecking=yes' -or
                        ($v -is [System.Management.Automation.Language.VariableExpressionAst] -and $strictVars.ContainsKey($v.VariablePath.UserPath.ToLowerInvariant()))) { $okS = $true }
                }
            }
            if (-not $okS) { $bare += ('{0}:{1} ({2})' -f (Rel $f.FullName), $c.Extent.StartLineNumber, $name) }
            continue
        }
        if ($name -eq 'Read-ThornswoodServerContent') {
            # Its own -SshArgs defaults to the strict array, so a caller that
            # leaves it out is strict; one that passes it hands a strict array.
            $contentCalls++
            for ($i = 0; $i -lt $c.CommandElements.Count - 1; $i++) {
                $e = $c.CommandElements[$i]
                if ($e -is [System.Management.Automation.Language.CommandParameterAst] -and $e.ParameterName -eq 'SshArgs') {
                    $v = $c.CommandElements[$i + 1]
                    if (-not ($v.Extent.Text -match 'StrictHostKeyChecking=yes' -or
                        ($v -is [System.Management.Automation.Language.VariableExpressionAst] -and $strictVars.ContainsKey($v.VariablePath.UserPath.ToLowerInvariant())))) {
                        $bare += ('{0}:{1} ({2})' -f (Rel $f.FullName), $c.Extent.StartLineNumber, $name)
                    }
                }
            }
            continue
        }
        if (@('ssh', 'scp', 'sftp', 'ssh.exe', 'scp.exe', 'sftp.exe') -notcontains $name.ToLowerInvariant()) { continue }
        $calls++
        $ok = $false
        foreach ($e in $c.CommandElements) {
            if ($e.Extent.Text -match 'StrictHostKeyChecking=yes') { $ok = $true; break }
            if ($e -is [System.Management.Automation.Language.VariableExpressionAst] -and $e.Splatted -and
                $strictVars.ContainsKey($e.VariablePath.UserPath.ToLowerInvariant())) { $ok = $true; break }
        }
        if (-not $ok) { $bare += ('{0}:{1}' -f (Rel $f.FullName), $c.Extent.StartLineNumber) }
    }
}

Yes ('no script turns host key checking down' + $(if ($off.Count) { ': ' + ($off -join ', ') } else { '' })) ($off.Count -eq 0)
Yes ('every ssh, scp and sftp call carries StrictHostKeyChecking=yes' + $(if ($bare.Count) { ': ' + ($bare -join ', ') } else { '' })) ($bare.Count -eq 0)
# Since #1070 twenty scripts send through Send-Script.ps1 instead of four ssh
# and scp calls each, so the raw calls are fewer and the helper calls count.
Yes ("  and there are real calls to check ($calls found)") ($calls -ge 60)
Yes ("  every Invoke-ThornswoodRemote caller hands it a strict array ($helperCalls found)") ($helperCalls -ge 20)
Yes ("  every Invoke-ThornswoodSecretRemote caller hands it a strict array ($secretCalls found)") ($secretCalls -ge 8)
$contentDefault = [IO.File]::ReadAllText((Join-Path $repo 'scripts\deploy\ServerContent.ps1')) -match "\[string\[\]\]\`$SshArgs = @\('-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes'\)"
Yes ("  Read-ThornswoodServerContent defaults to the strict array, and its callers ($contentCalls found) hand it one") ($contentDefault -and $contentCalls -ge 3)
Yes ("  every Open-ThornswoodOnBoxFolder caller hands it a strict array ($onBoxCalls found)") ($onBoxCalls -ge 2)

# ---- 2b: Send-Secret.ps1 keeps its own guard ----------------------------------------
# Whatever a caller passes, the secret goes only over a host-key-checked
# connection. Run against a stand-in ssh that records its options.
. (Join-Path $repo 'scripts\vps\Send-Secret.ps1')
$global:ThornswoodSshSeen = @()
function global:ssh { $global:ThornswoodSshSeen = @($args | ForEach-Object { [string]$_ }); $null = @($input); 'stand-in'; $global:LASTEXITCODE = 0 }
try {
    [void](Invoke-ThornswoodSecretRemote -Target 'nobody@203.0.113.9' -SshArgs @('-o', 'BatchMode=yes') -Secret 'not-a-secret' -Script "'x'")
    Yes 'Send-Secret.ps1 adds StrictHostKeyChecking=yes when a caller left it out' (($global:ThornswoodSshSeen -join ' ') -match 'StrictHostKeyChecking=yes')
    $global:ThornswoodSshSeen = @()
    $threw = $false
    try { [void](Invoke-ThornswoodSecretRemote -Target 'nobody@203.0.113.9' -SshArgs @('-o', 'StrictHostKeyChecking=accept-new') -Secret 'not-a-secret' -Script "'x'") } catch { $threw = $true }
    Yes '  and refuses one that turned it down, before ssh runs' ($threw -and $global:ThornswoodSshSeen.Count -eq 0)
}
finally {
    Remove-Item -Path function:global:ssh -ErrorAction SilentlyContinue
    Remove-Variable -Name ThornswoodSshSeen -Scope Global -ErrorAction SilentlyContinue
}

# ---- 3: the other languages ----------------------------------------------------------
$others = @()
foreach ($d in 'scripts', 'bot', 'voice', 'site', '.github', 'launcher') {
    $p = Join-Path $repo $d
    if (-not (Test-Path -LiteralPath $p)) { continue }
    foreach ($f in (Get-ChildItem -LiteralPath $p -File -Recurse -Include *.py, *.js, *.sh, *.cmd, *.bat, *.yml, *.yaml, *.psm1, *.cs -ErrorAction SilentlyContinue)) {
        if ($f.FullName -match '[\\/]node_modules[\\/]') { continue }
        $n = 0
        foreach ($line in [IO.File]::ReadAllLines($f.FullName)) {
            $n++
            if ($line -match '(?i)StrictHostKeyChecking\s*[= ]\s*"?(no|off|accept-new|ask)\b' -or
                $line -match '(?i)UserKnownHostsFile\s*[= ]\s*"?(/dev/null|NUL)\b') {
                $others += ('{0}:{1}' -f (Rel $f.FullName), $n)
            }
        }
    }
}
Yes ('no other file turns host key checking down' + $(if ($others.Count) { ': ' + ($others -join ', ') } else { '' })) ($others.Count -eq 0)

# ---- 4: the pin ------------------------------------------------------------------------
$vpsJson = Join-Path $repo 'scripts\vps\vps.json'
$raw = [IO.File]::ReadAllText($vpsJson)
$j = $raw | ConvertFrom-Json
$pins = @(@($j.hostKeys) | Where-Object { $_ })
Yes "vps.json pins the box's host keys ($($pins.Count))" ($pins.Count -ge 1)
Yes '  each one a SHA256 fingerprint, nothing else' (@($pins | Where-Object { [string]$_ -notmatch '^SHA256:[A-Za-z0-9+/]{43}$' }).Count -eq 0)
Yes '  and no key material beside them' ($raw -notmatch '(?i)PRIVATE KEY|BEGIN OPENSSH|ssh-ed25519 AAAA|ssh-rsa AAAA|ecdsa-sha2')

# ---- 5: the setup step --------------------------------------------------------------------
$setup = [IO.File]::ReadAllText((Join-Path $repo 'scripts\vps\Setup-SshKey.ps1'))
# Since #2891 the Host block is written by Set-ThornswoodBridgeSsh in Vps.ps1,
# for the bridge and for -NewBox alike.
$vpsPs1 = [IO.File]::ReadAllText((Join-Path $repo 'scripts\vps\Vps.ps1'))
Yes 'Setup-SshKey.ps1 writes its Host block, both times, with Set-ThornswoodBridgeSsh, which writes StrictHostKeyChecking yes' (
    ([regex]::Matches($setup, 'Set-ThornswoodBridgeSsh -Address \$VpsHost')).Count -eq 2 -and ([regex]::Matches($vpsPs1, "(?m)^\s+'    StrictHostKeyChecking yes',\s*$")).Count -eq 1)
Yes '  and writes known_hosts only through the pinned check' ($setup -match 'Add-ThornswoodKnownHost' -and $setup -notmatch 'Add-Content[^\r\n]*known_hosts')
Yes '  and -Test ends before anything is written' ($setup -match '(?s)if \(\$Test\) \{.*?Done 1\s*\}' -and $setup.IndexOf('if ($Test) {') -lt $setup.IndexOf('Add-ThornswoodKnownHost'))

# ---- 6: the pinned check itself, against throwaway keys --------------------------------
$keygen = Get-Command ssh-keygen -ErrorAction SilentlyContinue
if (-not $keygen) {
    Write-Host 'SKIP  no ssh-keygen here, so the pinned check was not run'
} else {
    $tmp = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-hostkey-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $tmp -Force | Out-Null
    try {
        . (Join-Path $repo 'scripts\vps\Vps.ps1')
        $keys = @{}
        foreach ($k in 'box', 'impostor') {
            $kp = Join-Path $tmp $k
            $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
            foreach ($empty in '""', '') {
                & ssh-keygen -q -t ed25519 -N $empty -C $k -f $kp 2>&1 | Out-Null
                if (Test-Path -LiteralPath "$kp.pub") { break }
            }
            $ErrorActionPreference = $old
            $pub = ([IO.File]::ReadAllText("$kp.pub")).Trim() -split '\s+'
            $keys[$k] = '203.0.113.9 ' + $pub[0] + ' ' + $pub[1]
        }
        $boxFp = Get-ThornswoodSshFingerprint $keys['box']
        $impFp = Get-ThornswoodSshFingerprint $keys['impostor']
        Yes 'a key line gives its SHA256 fingerprint' ($boxFp -match '^SHA256:' -and $impFp -match '^SHA256:' -and $boxFp -ne $impFp)

        $global:ThornswoodScanAnswer = @()
        function global:ssh-keyscan { $global:ThornswoodScanAnswer }
        $kh = Join-Path $tmp 'known_hosts'

        Yes 'nothing held yet reads as none' ((Test-ThornswoodKnownHost -Address '203.0.113.9' -KnownHosts $kh -Pinned @($boxFp)).Status -eq 'none')

        $global:ThornswoodScanAnswer = @('# 203.0.113.9:22 SSH-2.0-OpenSSH_for_Windows_9.5', $keys['impostor'])
        $threw = $false
        try { [void](Add-ThornswoodKnownHost -Address '203.0.113.9' -KnownHosts $kh -Pinned @($boxFp)) } catch { $threw = $true }
        Yes 'a machine showing a key that is not pinned is refused' $threw
        Yes '  and nothing is written' (-not (Test-Path -LiteralPath $kh))

        $global:ThornswoodScanAnswer = @($keys['impostor'], $keys['box'])
        $n = Add-ThornswoodKnownHost -Address '203.0.113.9' -KnownHosts $kh -Pinned @($boxFp)
        $held = [IO.File]::ReadAllText($kh)
        Yes 'the pinned key is written' ($n -eq 1 -and $held.Contains($keys['box']))
        Yes '  and the one beside it that is not pinned is left out' (-not $held.Contains($keys['impostor']))
        Yes '  after which it reads as trusted' ((Test-ThornswoodKnownHost -Address '203.0.113.9' -KnownHosts $kh -Pinned @($boxFp)).Status -eq 'trusted')
        Yes '  and a second run writes nothing more' ((Add-ThornswoodKnownHost -Address '203.0.113.9' -KnownHosts $kh -Pinned @($boxFp)) -eq 0)

        [IO.File]::WriteAllText($kh, $keys['impostor'] + "`n")
        Yes 'a known_hosts holding a key that is not pinned reads as wrong' ((Test-ThornswoodKnownHost -Address '203.0.113.9' -KnownHosts $kh -Pinned @($boxFp)).Status -eq 'wrong')
        $threw = $false
        try { [void](Add-ThornswoodKnownHost -Address '203.0.113.9' -KnownHosts $kh -Pinned @($boxFp)) } catch { $threw = $true }
        Yes '  and is refused rather than added to' ($threw -and ([IO.File]::ReadAllText($kh)).Trim() -eq $keys['impostor'])

        $threw = $false
        try { [void](Add-ThornswoodKnownHost -Address '203.0.113.9' -KnownHosts (Join-Path $tmp 'kh2') -Pinned @()) } catch { $threw = $true }
        Yes 'with nothing pinned it refuses rather than trusting whatever answers' $threw

        $real = @(Get-ThornswoodVpsHostKeys)
        Yes 'Vps.ps1 reads the pin out of vps.json' ($real.Count -eq $pins.Count -and $real[0] -eq [string]$pins[0])
    }
    finally {
        Remove-Item -Path function:global:ssh-keyscan -ErrorAction SilentlyContinue
        Remove-Variable -Name ThornswoodScanAnswer -Scope Global -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
