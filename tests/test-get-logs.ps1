<#
  test-get-logs.ps1

      pwsh -NoProfile -File .\tests\test-get-logs.ps1

  Get-Logs.ps1, issue #453 leftover: the rolled generations of every log
  that rolls come down with the current file. door.log does not roll, so it
  stays current-only.

  And the pull itself (#1605). On 4 Oct every pull under PowerShell 7.6.6
  printed a MetadataError for every log, said "1 lines" for each, and wrote a
  rolled generation the box does not have as a file holding the MISSING line.
  Two causes. The script kept what ssh answered in $lines, which is the
  [int]$Lines parameter, because PowerShell names ignore case. And it made up
  the names: .1 through .5 of every log that rolls, each asked for whether
  the box had it or not, 15 of 31 asks on that pull answered MISSING. It now
  asks the box once which files it has and reads exactly those.

  So this runs the real script against a stand-in ssh that runs each
  question's PowerShell, the way the box would, against a stand-in box in a
  temp folder, and looks at what it asks, what it says and what it leaves in
  the folder.

  No ssh and no VPS.
#>
[CmdletBinding()]
param([string]$RepoPath)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent $Here
if ($RepoPath) { $repo = $RepoPath }

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

$getLogs = Join-Path $repo 'scripts\vps\Get-Logs.ps1'
Yes 'Get-Logs.ps1 is in scripts\vps' (Test-Path -LiteralPath $getLogs)

$errs = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($getLogs, [ref]$null, [ref]$errs)
Yes 'Get-Logs.ps1 parses' (@($errs).Count -eq 0)
if (@($errs).Count -gt 0) {
    foreach ($e in $errs) { Write-Host ("  parse: {0}" -f $e) }
}

$text = [IO.File]::ReadAllText($getLogs)
Yes 'header says the rolled generations come down' ($text -match 'its\s+rolled generations come down too')
Yes 'header says the box is asked which it has' ($text -match 'the box is asked\s+once which of them it has')
Yes 'header says door.log does not roll' ($text -match 'door\.log does not roll')

foreach ($name in @('server.log', 'thornswood.log', 'voice.log', 'site.log', 'bot.log')) {
    $pat = "Name = '$name'[^`r`n]*Rolls = \`$true"
    Yes ("$name rolls") ($text -match $pat)
}

$doorLine = [regex]::Match($text, "Name = 'door\.log'[^`r`n]*")
Yes 'door.log is listed' $doorLine.Success
Yes 'door.log does not roll' ($doorLine.Success -and $doorLine.Value -notmatch 'Rolls')

# ---- the runbook says what the script fetches (#1625) ----------------------
# MOVING-THE-SERVER.md's bullet on Get-Logs is in the private ops repo since
# #3693, and its tests\test-ops-runbooks.ps1 holds it to the list above.

# ---- no parameter is given a new value (#1605) ------------------------------
# Names ignore case, so $lines is $Lines. A parameter is only ever filled in
# when it was not given, inside if (-not $Name) { }, and nothing else in the
# script may assign to one or loop over one, under any spelling.
$params = @($ast.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath })
Yes ('the parameters are read ({0})' -f ($params -join ', ')) ($params -contains 'Lines' -and $params -contains 'Out')
$reused = @()
$assigned = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.AssignmentStatementAst] }, $true)
foreach ($a in $assigned) {
    $left = $a.Left
    if ($left -is [System.Management.Automation.Language.ConvertExpressionAst]) { $left = $left.Child }
    if (-not ($left -is [System.Management.Automation.Language.VariableExpressionAst])) { continue }
    $param = @($params | Where-Object { $_ -ieq $left.VariablePath.UserPath })
    if (-not $param.Count) { continue }
    $filling = $false
    for ($up = $a.Parent; $up; $up = $up.Parent) {
        if (-not ($up -is [System.Management.Automation.Language.IfStatementAst])) { continue }
        foreach ($clause in $up.Clauses) {
            $inBody = ($clause.Item2.Extent.StartOffset -le $a.Extent.StartOffset -and $a.Extent.EndOffset -le $clause.Item2.Extent.EndOffset)
            if ($inBody -and $clause.Item1.Extent.Text -match ('^-not\s+\$' + [regex]::Escape($param[0]) + '$')) { $filling = $true }
        }
    }
    if (-not $filling) { $reused += ('line {0}: {1}' -f $a.Extent.StartLineNumber, $a.Extent.Text) }
}
$loops = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.ForEachStatementAst] }, $true)
foreach ($l in $loops) {
    if ($params | Where-Object { $_ -ieq $l.Variable.VariablePath.UserPath }) {
        $reused += ('line {0}: foreach ({1} in ...)' -f $l.Extent.StartLineNumber, $l.Variable.Extent.Text)
    }
}
foreach ($r in $reused) { Write-Host "      $r" }
Yes 'no parameter is given a new value under any spelling, only filled in when it was not given' ($reused.Count -eq 0)

# ---- the pull, against a stand-in box (#1605) --------------------------------
$work = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-get-logs-' + [Guid]::NewGuid().ToString('n'))
$pulled = Join-Path $work 'pulled'
$global:standInBox = Join-Path $work 'box'
New-Item -ItemType Directory -Path $pulled -Force | Out-Null
# The script names the box's folders as C:\...; off Windows there is no C:
# drive for Join-Path to accept, so one is lent for the run. Nothing is
# written under it: the stand-in ssh moves every C: path into the stand-in box.
$lentC = $false
if (-not (Get-PSDrive -Name C -ErrorAction SilentlyContinue)) {
    New-PSDrive -Name C -PSProvider FileSystem -Root $work -Scope Global | Out-Null
    $lentC = $true
}

# What the box has. site.log is not there at all. server.log.2 rolls away
# between the question and the read. voice.log.1 is empty. Beside them sit
# files that are not logs of these names and must not be read.
function Put([string]$rel, [int]$count) {
    $p = Join-Path $global:standInBox $rel
    New-Item -ItemType Directory -Path (Split-Path -Parent $p) -Force | Out-Null
    $body = @(for ($i = 1; $i -le $count; $i++) { "$rel line $i" })
    Set-Content -LiteralPath $p -Value $body -Encoding UTF8
}
Put 'Thornswood-Server-Dev\server.log' 7
Put 'Thornswood-Server-Dev\server.log.1' 7
Put 'Thornswood-Server-Dev\server.log.2' 7
Put 'Thornswood-Server-Dev\server.log.bak' 7
Put 'Thornswood-Server-Dev\server.log.1.old' 7
Put 'Thornswood-Server-Dev\thornswood.log' 7
Put 'Thornswood-Server-Dev\private\door.log' 7
Put 'Thornswood-Server-Dev\private\door.log.1' 7
Put 'Thornswood-Voice-Dev\voice.log' 7
Put 'Thornswood-Voice-Dev\voice.log.1' 0
Put 'Thornswood-Bot\data\bot.log' 7
New-Item -ItemType Directory -Path (Join-Path $global:standInBox 'Thornswood-Docs') -Force | Out-Null

# Here, from an earlier pull: an older voice.log.1, which the empty one on
# the box must replace.
Set-Content -LiteralPath (Join-Path $pulled 'voice.log.1') -Value 'an older voice.log.1' -Encoding UTF8

# The stand-in ssh. It takes the question the script would send the box,
# moves its C: paths into the stand-in box, and runs it in a PowerShell of
# its own, as pwsh -EncodedCommand on the box would: what that prints
# on stdout is the answer, what it prints on stderr stays stderr, and its
# exit code is ssh's. Every connection also says the post-quantum warning on
# stderr, as the box's OpenSSH did from 28 September (#941).
$global:standInPs = (Get-Process -Id $PID).Path
$global:standInAsks = New-Object System.Collections.Generic.List[string]
$global:standInListed = @()
function global:ssh {
    $b64 = ([string]$args[-1] -split ' ')[-1]
    $remote = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($b64))
    $global:standInAsks.Add($remote)
    # The voice service's /health on the box (#3806): no service runs here,
    # so the box answers the way the dev service does to a caller on it.
    if ($remote.Contains('/health')) {
        Write-Error '** WARNING: connection is not using a post-quantum key exchange algorithm.'
        '{"ok":true,"build":"stand-in-build","bind":"127.0.0.1","auth":"on","peers":0}'
        $global:LASTEXITCODE = 0
        return
    }
    $moved = $remote.Replace("'C:", "'" + $global:standInBox)
    $enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($moved))
    $came = @(& $global:standInPs -NoProfile -NonInteractive -EncodedCommand $enc 2>&1)
    $code = $LASTEXITCODE
    Write-Error '** WARNING: connection is not using a post-quantum key exchange algorithm.'
    $answer = @()
    foreach ($c in $came) {
        if ($c -is [System.Management.Automation.ErrorRecord]) { Write-Error -ErrorRecord $c; continue }
        $s = [string]$c
        if ($s.StartsWith($global:standInBox)) { $s = 'C:' + $s.Substring($global:standInBox.Length) }
        $answer += $s
    }
    if ($remote.Contains('Get-ChildItem')) {
        $global:standInListed = $answer
        # The roll: server.log.2 leaves between the question and the read.
        Remove-Item -LiteralPath (Join-Path $global:standInBox 'Thornswood-Server-Dev\server.log.2') -Force
    }
    $answer
    $global:LASTEXITCODE = $code
}
# What https://thornswood.net/voice-dev/health says to anybody since #3806.
$global:standInSiteAsks = New-Object System.Collections.Generic.List[string]
function global:Invoke-RestMethod { param([string]$Uri, [int]$TimeoutSec) $global:standInSiteAsks.Add($Uri); [pscustomobject]@{ ok = $true } }
try {
    # Run as a person runs it, where an error is printed and the pull goes on,
    # so every error it says is counted rather than the first one stopping this.
    $said = @(& {
        $ErrorActionPreference = 'Continue'
        try { & $getLogs -Vps 203.0.113.9 -User tester -Out $pulled -Lines 3 -Dev -NoPause *>&1 }
        catch { $_ }
    })
    $errors = @($said | Where-Object { $_ -is [System.Management.Automation.ErrorRecord] })
    foreach ($e in $errors) { Write-Host ('  said: ' + $e) }
    Yes 'the pull says no error' ($errors.Count -eq 0)
    $words = ($said | ForEach-Object { "$_" }) -join "`n"
    function Pulled([string]$name) { Join-Path $pulled $name }

    $listings = @($global:standInAsks | Where-Object { $_.Contains('Get-ChildItem') })
    $healthAsks = @($global:standInAsks | Where-Object { $_.Contains('/health') })
    $reads = @($global:standInAsks | Where-Object { $_ -match "Get-Content -LiteralPath '([^']+)'" } | ForEach-Object { [regex]::Match($_, "Get-Content -LiteralPath '([^']+)'").Groups[1].Value })
    Yes 'it asks the box once which files it has' ($listings.Count -eq 1)
    Yes ('the box names 8 files, and the pull reads those 8, asks voice once and nothing else ({0} asks)' -f $global:standInAsks.Count) (
        $global:standInListed.Count -eq 8 -and $reads.Count -eq 8 -and $healthAsks.Count -eq 1 -and $global:standInAsks.Count -eq 10)

    # ---- voice's /health, on the box (#3806) ----
    # Only a caller on the box is told the build, so the detail is read there,
    # on the dev port for -Dev, and the site is asked only whether it carries
    # voice, which it answers with ok and nothing more.
    Yes 'voice is asked on the box, at 127.0.0.1 on the dev port' ($healthAsks.Count -eq 1 -and $healthAsks[0].Contains("'http://127.0.0.1:7789/health'"))
    Yes 'health.json holds what the box said' ((Test-Path -LiteralPath (Pulled 'health.json')) -and
        ((Get-Content -LiteralPath (Pulled 'health.json') -Raw) | ConvertFrom-Json).build -eq 'stand-in-build')
    Yes 'and the pull says its build and where it was asked' ($words -match '(?m)^\s*health\.json\s+build stand-in-build, asked on the box at 127\.0\.0\.1:7789')
    Yes 'the site is asked only whether it carries dev voice' ($global:standInSiteAsks.Count -eq 1 -and $global:standInSiteAsks[0] -eq 'https://thornswood.net/voice-dev/health')
    Yes 'and the pull says it does' ($words -match 'the site carries it: https://thornswood\.net/voice-dev/health says ok')
    Yes 'the raw port is not asked from here any more' ($text -notmatch 'straight at')
    $unasked = @($reads | Where-Object { $global:standInListed -notcontains $_ })
    Yes 'every file it reads is one the box named' ($unasked.Count -eq 0)

    Yes 'it counts the lines ssh answered: server.log, 3 lines' ($words -match '(?m)^\s*server\.log\s+3 lines')
    Yes 'server.log comes down with the 3 lines asked for' ((Test-Path -LiteralPath (Pulled 'server.log')) -and @(Get-Content -LiteralPath (Pulled 'server.log')).Count -eq 3)
    Yes 'and holds the log and nothing ssh said on stderr' ((Test-Path -LiteralPath (Pulled 'server.log')) -and -not (Select-String -LiteralPath (Pulled 'server.log') -Pattern 'post-quantum' -Quiet))
    Yes 'a rolled generation the box has comes down: server.log.1' (Test-Path -LiteralPath (Pulled 'server.log.1'))
    Yes 'one that rolled away between the question and the read is said as not read' ($words -match '(?m)^\s*server\.log\.2\s+could not be read\. ssh exit 1: .*server\.log\.2')
    Yes 'and nothing is written for it' (-not (Test-Path -LiteralPath (Pulled 'server.log.2')))
    Yes 'files beside a log that are not its generations are not read: server.log.bak, server.log.1.old' (
        -not (Test-Path -LiteralPath (Pulled 'server.log.bak')) -and -not (Test-Path -LiteralPath (Pulled 'server.log.1.old')) -and
        -not ($reads | Where-Object { $_ -match '\.bak$|\.old$' }))
    Yes 'door.log comes down, and door.log.1 does not, because door.log does not roll' (
        (Test-Path -LiteralPath (Pulled 'door.log')) -and -not (Test-Path -LiteralPath (Pulled 'door.log.1')))
    Yes 'thornswood.log, with no rolled copies on the box, comes down alone' (
        (Test-Path -LiteralPath (Pulled 'thornswood.log')) -and -not ($words -match 'thornswood\.log\.\d'))
    Yes 'voice.log.1, empty on the box, comes down empty in place of the older copy here' (
        (Test-Path -LiteralPath (Pulled 'voice.log.1')) -and (Get-Item -LiteralPath (Pulled 'voice.log.1')).Length -eq 0 -and
        $words -match '(?m)^\s*voice\.log\.1\s+0 lines')
    Yes 'site.log, not on the box, is said as not on the VPS' ($words -match '(?m)^\s*site\.log\s+not on the VPS at ')
    Yes 'and nothing is written for it' (-not (Test-Path -LiteralPath (Pulled 'site.log')))
    Yes 'bot.log comes down' (Test-Path -LiteralPath (Pulled 'bot.log'))
    Yes 'nothing is called MISSING any more' (-not ($words -match 'MISSING'))
} finally {
    Remove-Item -Path function:global:ssh -ErrorAction SilentlyContinue
    Remove-Item -Path function:global:Invoke-RestMethod -ErrorAction SilentlyContinue
    if ($lentC) { Remove-PSDrive -Name C -Scope Global -ErrorAction SilentlyContinue }
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
