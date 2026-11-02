<#
  test-syn-flood.ps1

      pwsh -NoProfile -File .\tests\test-syn-flood.ps1

  Issue #2995. scripts\vps\vps-syn-flood.ps1 measures the forged SYN flood on
  the box's port 443 and what it costs, sent to the box by Remote.ps1 -File.
  This proves:

    1. it parses under pwsh, which is what runs it on the box;
    2. it only reads: no cmdlet or command that changes the machine, and no
       window longer than five minutes;
    3. it prints no address, only counts and how many /16s;
    4. on Windows, a short run under PowerShell 7, as an account
       that is not an administrator, reads the TCP totals, prints every line
       it promises, ending in one VERDICT, and exits 0 (or 1 with VERDICT
       UNKNOWN where nothing listens on 443).

  Reads only.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent $Here
$script = Join-Path (Join-Path (Join-Path $repo 'scripts') 'vps') 'vps-syn-flood.ps1'
. (Join-Path $PSScriptRoot 'Windows.ps1')

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

$t = [IO.File]::ReadAllText($script)
# The code without its comments, so the help text may name what the code must not do.
$code = [regex]::Replace($t, '(?s)<#.*?#>', '')
$code = [regex]::Replace($code, '(?m)^\s*#.*$', '')

# ---- 1. it parses ------------------------------------------------------------
$errs = $null
[void][System.Management.Automation.Language.Parser]::ParseInput($t, [ref]$null, [ref]$errs)
Yes 'it parses under pwsh' (-not ($errs -and $errs.Count))

# ---- 2. it only reads --------------------------------------------------------
$writes = [regex]::Matches($code, '(?i)\b(Set|New|Remove|Register|Unregister|Disable|Enable|Stop|Restart|Start-Process|Add|Clear|Rename|Move|Copy|Out-File|Export)-[A-Za-z]+|\bnetsh\b|\breg(\.exe)?\s+(add|delete)|\bpktmon\b|\bschtasks\b|\bsc(\.exe)?\s|\bOut-File\b|\bSet-Content\b|>\s*[^\s=]') | ForEach-Object { $_.Value }
$writes = @($writes | Where-Object { $_ -notmatch '^>\s*\d' })
Yes ("it runs nothing that changes the machine" + $(if ($writes.Count) { ': ' + ($writes -join ', ') } else { '' })) ($writes.Count -eq 0)
Yes '  its window is 10 to 300 seconds, 60 unless told' ($t -match '\[ValidateRange\(10, 300\)\]\[int\]\$Seconds = 60')
Yes '  and it reads the TCP totals any account may read, at both ends of the window' (([regex]::Matches($code, 'GetTcpIPv4Statistics\(\)')).Count -eq 1 -and $code -match '\$t0 = Get-Tcp' -and $code -match '\$t1 = Get-Tcp')
Yes '  not the performance counters, which read as zeros under the Windows runner''s account (#2995)' ($code -notmatch 'Win32_PerfRawData|Get-Counter')
Yes '  and when it cannot read them it says UNKNOWN and exits 1, never a window of zeros' ($code -match "if \(-not \`$t0\) \{ 'VERDICT UNKNOWN the TCP totals could not be read[^']*'; exit 1 \}")

# ---- 3. no address leaves the box ---------------------------------------------
# [^\r\n]* and no $: a Windows checkout has CRLF, and (?m)$ matches only before \n.
$printed = @([regex]::Matches($code, "(?m)^[ \t]*'[A-Z-]+ [^\r\n]*") | ForEach-Object { $_.Value })
Yes "every line it prints is one of its own labels ($($printed.Count) of them)" ($printed.Count -ge 6)
Yes '  and none of them prints an address, only counts' (@($printed | Where-Object { $_ -match 'RemoteAddress|\$addrs\.Keys|\$a\b' }).Count -eq 0)

# ---- 4. a short run --------------------------------------------------------------
if (-not $OnWindows) {
    Write-Host 'SKIP  the run: Get-NetTCPConnection is only on Windows; the Windows runners run it'
    Done
}
$out = @(& (Get-BoxPowerShell) -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $script -Seconds 10 2>&1 | ForEach-Object { "$_" })
$runCode = $LASTEXITCODE
$all = $out -join "`n"
Write-Host ($out | ForEach-Object { '      ' + $_ } | Out-String).TrimEnd()
if ($all -match 'VERDICT UNKNOWN nothing listens on 443') {
    Yes "where nothing listens on 443 it says so and exits 1 (exit $runCode)" ($runCode -eq 1)
    Done
}
Yes "a 10 second run exits 0 (exit $runCode)" ($runCode -eq 0)
Yes '  having read the TCP totals: segments were sent in the window' ($all -match '(?m)^RETRANSMITS [0-9.,]+/s of ([1-9][0-9,]*\.[0-9]|0\.[1-9])')
foreach ($label in 'LISTENER', 'HALF-OPEN 443', 'CONNECTS', 'RETRANSMITS', 'COST') {
    Yes "  and prints its $label line" ($all -match "(?m)^$label ")
}
Yes '  and ends in one VERDICT, FLOOD or QUIET' (([regex]::Matches($all, '(?m)^VERDICT (FLOOD|QUIET) ')).Count -eq 1 -and $out[-1] -match '^VERDICT ')
Yes '  and no address is in what it printed' ($all -notmatch '\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b')
Done
