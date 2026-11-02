<#
  test-3216-ask-from-stdin.ps1

  Read-ThornswoodSecret (scripts\vps\Send-Secret.ps1) takes the value from one
  line of standard input when there is no keyboard, so a cloud Desk can run
  Set-Turnstile.ps1 and the other scripts that ask through it (#3216).

  WHY. A cloud Desk has no console. There Read-Host -AsSecureString on a
  redirected standard input ended the whole script on the spot with exit code
  0 and nothing printed, so a run looked finished when nothing had been sent
  (PowerShell 7.6, 22 Oct 2026).

  HOW. A child PowerShell dot-sources the real Send-Secret.ps1 and asks once,
  with a value piped in and with nothing piped in, and says what it got and
  that it carried on. Off Windows, Set-Turnstile.ps1 itself is then run with
  the value piped in and a fake ssh first on PATH, which keeps what came on its
  standard input and its arguments: the value must arrive there, as the wire
  form, and on no argument. Nothing connects anywhere.

    pwsh -File tests\test-3216-ask-from-stdin.ps1
#>
[CmdletBinding()]
param()
$env:THORNSWOOD_HARNESS = '1'

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot

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

. (Join-Path $PSScriptRoot 'Windows.ps1')
# The scripts run in PowerShell 7 only (#5356), so the child is this one.
$shells = @(Get-BoxPowerShell)

$work = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-3216-stdin-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work -Force | Out-Null
try {
    $noMark = New-Object Text.UTF8Encoding($false)
    $asker = Join-Path $work 'ask.ps1'
    $send = Join-Path $Root 'scripts\vps\Send-Secret.ps1'
    [IO.File]::WriteAllText($asker, @"
. '$send'
`$s = Read-ThornswoodSecret 'The value'
'GOT[' + `$s + ']'
'CARRIED ON'
"@, $noMark)

    # A child whose standard input is the bytes given, or empty.
    function Run-Asker([string]$shell, [string]$stdin) {
        $psi = New-Object Diagnostics.ProcessStartInfo
        $psi.FileName = $shell
        $psi.Arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $asker + '"'
        $psi.UseShellExecute = $false
        $psi.RedirectStandardInput = $true
        $psi.RedirectStandardOutput = $true
        $psi.RedirectStandardError = $true
        $p = [Diagnostics.Process]::Start($psi)
        $p.StandardInput.Write($stdin)
        $p.StandardInput.Close()
        $out = $p.StandardOutput.ReadToEnd() + $p.StandardError.ReadToEnd()
        $p.WaitForExit()
        return $out
    }

    foreach ($shell in $shells) {
        $name = Split-Path -Leaf $shell
        $out = Run-Asker $shell "a value with  spaces/+=`r`n"
        Yes "$name, a value piped in: it is read whole, the CR dropped" ($out.Contains('GOT[a value with  spaces/+=]'))
        Yes "$name, a value piped in: the script carries on after the ask" ($out.Contains('CARRIED ON'))
        Yes "$name, a value piped in: it says it read standard input, and never prints the prompt as asked of a keyboard" ($out.Contains('The value: read from standard input'))
        $out = Run-Asker $shell ''
        Yes "$name, nothing piped in: the value is empty and the script carries on" ($out.Contains('GOT[]') -and $out.Contains('CARRIED ON'))
        if (-not $out.Contains('CARRIED ON')) { Write-Host ('      it said: ' + $out) }
    }

    if ($OnWindows) {
        Write-Host 'SKIP  Set-Turnstile.ps1 end to end: the fake ssh here is a shell script, and test-3216-set-turnstile.ps1 runs the far side on Windows'
        Done
    }
    $bin = Join-Path $work 'bin'
    New-Item -ItemType Directory -Path $bin -Force | Out-Null
    $fake = @"
#!/bin/sh
cat > '$work/stdin.txt'
printf '%s\n' "`$@" > '$work/args.txt'
echo 'FAKE ssh'
"@
    foreach ($n in 'ssh', 'scp') {
        $f = Join-Path $bin $n
        [IO.File]::WriteAllText($f, $fake.Replace("`r`n", "`n"), $noMark)
        & chmod +x $f
    }
    $secret = 'harness-' + [Guid]::NewGuid().ToString('N')
    $was = $env:PATH
    try {
        $env:PATH = $bin + [IO.Path]::PathSeparator + $was
        $out = ($secret | & $shells[0] -NoProfile -NonInteractive -File (Join-Path $Root 'scripts/deploy/Set-Turnstile.ps1') -PublicSiteKey '0x4AAAAAAAHarnessKey_01' -Vps 'nowhere.invalid' -User 'nobody' 2>&1 | Out-String)
    } finally { $env:PATH = $was }
    Yes 'Set-Turnstile.ps1 with the secret piped in goes on to send it' ($out.Contains('FAKE ssh'))
    if (-not $out.Contains('FAKE ssh')) { Write-Host ('      it said: ' + $out) }
    $wire = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($secret))
    $stdin = ''; $args2 = ''
    if (Test-Path (Join-Path $work 'stdin.txt')) { $stdin = [IO.File]::ReadAllText((Join-Path $work 'stdin.txt')) }
    if (Test-Path (Join-Path $work 'args.txt')) { $args2 = [IO.File]::ReadAllText((Join-Path $work 'args.txt')) }
    Yes '  and the value reaches ssh on its standard input, as the wire form' ($stdin.Trim() -eq $wire)
    Yes '  and on none of its arguments, plain or wire form' (-not $args2.Contains($secret) -and -not $args2.Contains($wire) -and $args2.Length -gt 0)
    Yes '  and it is printed nowhere' (-not $out.Contains($secret) -and -not $out.Contains($wire))
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
Done
