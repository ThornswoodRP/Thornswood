<#
  test-3041-box-guard.ps1

      pwsh -NoProfile -File .\tests\test-3041-box-guard.ps1

  Issue #3041. Five box scripts refused a gaming PC by looking for
  C:\Thornswood\Game\SkyrimSE.exe, which a launcher installed on D: is not
  in, and three more asked Windows whether the machine is a server and went
  ahead when it did not answer. scripts\vps\BoxGuard.ps1 is the one rule now
  (ask Windows; a server goes ahead, a workstation and no answer are
  refused), and each box script carries an exact copy of it. This fails on:
    1. the rule answering wrong, with Windows' answer stood in for: a server
       and a domain controller go ahead, and a workstation, an unknown
       product type and no answer at all are refused; or the rule reading
       anything off the disk, which is where the old guard looked;
    2. a box script that does not carry the rule, carries a copy that differs
       from BoxGuard.ps1, or asks Windows for ProductType anywhere else;
       Copy-BoxGuard.ps1 is run over a planted copy first, so the writer the
       header names is held too;
    3. a box script doing anything but set variables and define functions
       before it asks;
    4. a box script not refusing when the rule says this is not the box. Each
       is run, in PowerShell 7 as on the box since #5356, with
       Windows' answer stood in for as a workstation and as no answer, and
       must say the rule's reason and stop. These runs only start once 1 and
       3 have passed, so a script that would go on past a broken rule is
       never run.
  The rule and the runs need nothing of Windows, so it runs everywhere. A few
  seconds.
#>
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'Windows.ps1')
$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$ok) {
    if ($ok) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
function Path-Of([string]$rel) { return [IO.Path]::Combine([string[]](@($Repo) + @($rel -split '/'))) }
function Lf([string]$t) { return $t.Replace("`r`n", "`n") }
$FnAst = [System.Management.Automation.Language.FunctionDefinitionAst]
$CmdAst = [System.Management.Automation.Language.CommandAst]

$guard = Path-Of 'scripts/vps/BoxGuard.ps1'
$open = '# ---- BoxGuard.ps1 (copy) ----'
$close = '# ---- end BoxGuard.ps1 ----'
# The scripts that run on the box and refuse anywhere else, and what each is
# run with in part 4: arguments that stop it at its next check if it ever got
# past this one, and the word it refuses with.
$carriers = [ordered]@{
    'scripts/vps/Bootstrap-VPS.ps1'              = @{ Args = '';                                       Word = '' }
    'scripts/vps/Clear-OldWorldCopies.ps1'       = @{ Args = "-WhatIf -TempDirs '<scratch>'";          Word = 'REFUSED: ' }
    'scripts/vps/Delete-Person.ps1'              = @{ Args = "-SiteRoot '<scratch>'";                  Word = 'REFUSED: ' }
    'scripts/vps/Lock-VpsFolders.ps1'            = @{ Args = "-WhatIf -Parent '<scratch>' -SiteSid none -BotSid none -DumpWriterSids none"; Word = 'REFUSED: ' }
    'scripts/vps/Remove-HandMadeTasks.ps1'       = @{ Args = "-WhatIf -Parent '<scratch>'";            Word = 'REFUSED: ' }
    'scripts/deploy/Install-ThornswoodServer.ps1' = @{ Args = "-Zip '<scratch>\none.zip' -Root '<scratch>'"; Word = '' }
    'scripts/vps/vps-harden.ps1'                 = @{ Args = "-DryRun -SshdConfig '<scratch>\sshd_config' -Sshd '<scratch>\sshd.exe'"; Word = 'STOP ' }
    'scripts/vps/vps-openssh.ps1'                = @{ Args = "-DryRun -Pins 'SHA256:x'";               Word = 'STOP ' }
    'scripts/vps/vps-time-wait.ps1'              = @{ Args = '-Check';                                 Word = 'STOP ' }
    'scripts/vps/vps-ssh-scope.ps1'              = @{ Args = "-From '203.0.113.7' -DryRun";            Word = 'STOP ' }
    'scripts/vps/vps-web-firewall.ps1'           = @{ Args = "-Apply -Ranges '198.51.100.0/24' -DryRun"; Word = 'STOP ' }
    'scripts/vps/vps-inbound-rules.ps1'          = @{ Args = '-Apply -DryRun';                         Word = 'STOP ' }
    'scripts/vps/vps-firewall-policy.ps1'        = @{ Args = '-Apply -DryRun';                         Word = 'STOP ' }
}

# ---- 1. the rule --------------------------------------------------------------
Write-Host 'the rule, with Windows'' answer stood in for'
$guardText = [IO.File]::ReadAllText($guard)
Yes 'BoxGuard.ps1 is plain ASCII' (-not ($guardText.ToCharArray() | Where-Object { [int]$_ -gt 127 }))
$errs = $null
$gAst = [System.Management.Automation.Language.Parser]::ParseInput($guardText, [ref]$null, [ref]$errs)
Yes '  and parses' (-not $errs -or $errs.Count -eq 0)
$fns = @($gAst.FindAll({ param($n) $n -is $FnAst }, $true))
Yes '  and defines Get-ThornswoodBoxRefusal and nothing else' ($fns.Count -eq 1 -and $fns[0].Name -eq 'Get-ThornswoodBoxRefusal')
$ruleText = $(if ($fns.Count -eq 1) { Lf $fns[0].Extent.Text } else { '' })
$asked = @($gAst.FindAll({ param($n) $n -is $CmdAst }, $true) | ForEach-Object { $_.GetCommandName() } | Sort-Object -Unique)
Yes '  and asks Windows and reads nothing off the disk (Get-CimInstance is its only command)' (($asked -join ',') -eq 'Get-CimInstance')

$ruleOk = $false
if ($ruleText) {
    . ([scriptblock]::Create($ruleText))
    function Answer($a) {
        $global:BoxGuardStandIn = $a
        function global:Get-CimInstance {
            if ($global:BoxGuardStandIn -is [string]) { throw $global:BoxGuardStandIn }
            return [pscustomobject]@{ ProductType = $global:BoxGuardStandIn }
        }
        try { return (Get-ThornswoodBoxRefusal) } finally { Remove-Item function:\Get-CimInstance -ErrorAction SilentlyContinue }
    }
    $server = Answer 3; $dc = Answer 2; $ws = Answer 1; $odd = Answer 7; $none = Answer 'Access is denied.'
    $before = $script:fail
    Yes 'a server (product type 3) is the box' ($server -eq '')
    Yes 'a domain controller (2) is a server too' ($dc -eq '')
    Yes 'a workstation (1) is refused, as a gaming PC or a developer''s machine' ($ws -match 'workstation, a gaming PC')
    Yes 'a product type Windows does not document is refused' ($odd -match 'product type 7')
    Yes 'no answer from Windows is refused, with what Windows said' ($none -match 'did not say' -and $none -match 'Access is denied')
    Yes 'the rule never names an install folder or the game' (-not ($ruleText -match '(?i)SkyrimSE|Thornswood\.exe|C:\\'))
    $ruleOk = ($script:fail -eq $before)
    Remove-Item variable:\global:BoxGuardStandIn -ErrorAction SilentlyContinue
}

# ---- 2. one rule, carried -----------------------------------------------------
Write-Host ''
Write-Host 'every box script carries the rule, and only the rule'
function Get-Copies([string]$text) {
    return @([regex]::Matches((Lf $text), '(?ms)^' + [regex]::Escape($open) + '\n(.*?)\n' + [regex]::Escape($close) + '$') | ForEach-Object { $_.Groups[1].Value })
}
function Strip-Copies([string]$text) {
    return [regex]::Replace((Lf $text), '(?ms)^' + [regex]::Escape($open) + '\n.*?\n' + [regex]::Escape($close) + '$', '')
}
foreach ($rel in $carriers.Keys) {
    $p = Path-Of $rel
    if (-not (Test-Path -LiteralPath $p)) { Yes "$rel is here" $false; continue }
    $t = [IO.File]::ReadAllText($p)
    $c = @(Get-Copies $t)
    Yes "$rel carries one exact copy of BoxGuard.ps1" ($c.Count -eq 1 -and $c[0] -eq $ruleText)
    Yes '  and asks it' ((Strip-Copies $t) -match 'Get-ThornswoodBoxRefusal')
}
# Any other script with a copy holds it exactly too, and nothing outside a
# copy asks Windows for ProductType, the question the rule asks.
$scripts = @(Get-ChildItem -LiteralPath (Path-Of 'scripts') -Recurse -File -Filter '*.ps1')
$differ = @(); $asks = @()
foreach ($f in $scripts) {
    if ($f.FullName -eq $guard) { continue }
    $t = [IO.File]::ReadAllText($f.FullName)
    foreach ($c in @(Get-Copies $t)) { if ($c -ne $ruleText) { $differ += $f.FullName } }
    if ((Strip-Copies $t) -match 'ProductType') { $asks += $f.FullName }
}
Yes ("there are scripts to read ({0})" -f $scripts.Count) ($scripts.Count -gt 100)
Yes 'every copy anywhere in scripts is BoxGuard.ps1''s exactly (pwsh -NoProfile -File scripts\dev\Copy-BoxGuard.ps1 writes them)' ($differ.Count -eq 0)
foreach ($d in $differ) { Write-Host "      $d" }
Yes 'no script asks Windows for ProductType outside a copy of the rule' ($asks.Count -eq 0)
foreach ($a in $asks) { Write-Host "      $a" }

# The writer, over a planted folder: a stale copy is written, CRLF stays CRLF,
# a header naming the lines indented is not a copy, and a broken one is named
# and left.
$plant = Join-Path ([IO.Path]::GetTempPath()) ('ts-3041-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
try {
    $null = New-Item -ItemType Directory -Force -Path $plant
    $stale = Join-Path $plant 'Stale.ps1'
    [IO.File]::WriteAllText($stale, ("param()`r`n" + $open + "`r`nfunction Get-ThornswoodBoxRefusal { return '' }`r`n" + $close + "`r`n'after'`r`n"))
    $named = Join-Path $plant 'Named.ps1'
    [IO.File]::WriteAllText($named, ("<#`n  " + $open + "`n  " + $close + "`n#>`n'x'`n"))
    $copier = Path-Of 'scripts/dev/Copy-BoxGuard.ps1'
    $out = @(& pwsh -NoProfile -File $copier -Root $plant 2>&1 | ForEach-Object { "$_" })
    $code = $LASTEXITCODE
    $now = [IO.File]::ReadAllText($stale)
    Yes 'Copy-BoxGuard.ps1 writes the rule into a stale copy' ($code -eq 0 -and @(Get-Copies $now).Count -eq 1 -and @(Get-Copies $now)[0] -eq $ruleText)
    Yes '  keeps that file''s CRLF and what is around the copy' (-not [regex]::IsMatch($now, "(?<!\r)\n") -and $now.StartsWith("param()`r`n") -and $now.EndsWith("'after'`r`n"))
    Yes '  and leaves a header that only names the lines as it was' ([IO.File]::ReadAllText($named) -eq ("<#`n  " + $open + "`n  " + $close + "`n#>`n'x'`n") -and -not ($out -match 'Named'))
    [IO.File]::WriteAllText((Join-Path $plant 'Broken.ps1'), ($open + "`n'no end'`n"))
    $out = @(& pwsh -NoProfile -File $copier -Root $plant 2>&1 | ForEach-Object { "$_" })
    Yes '  and names a copy with no closing line, and exits 1' ($LASTEXITCODE -eq 1 -and (($out -join ' ') -match 'NOT WRITTEN .*Broken\.ps1'))
} finally {
    Remove-Item -LiteralPath $plant -Recurse -Force -ErrorAction SilentlyContinue
}

# ---- 3. it asks first ---------------------------------------------------------
# Above the question a script may only set variables and define functions
# (and, in the three with a layer, dot-source the harness's stand-ins). In
# vps-harden, vps-time-wait and vps-ssh-scope the question is the first thing
# their Invoke- function does, and the top level does nothing else before it
# calls that.
Write-Host ''
Write-Host 'each box script asks before it does anything'
$orderOk = $true
foreach ($rel in $carriers.Keys) {
    $p = Path-Of $rel
    if (-not (Test-Path -LiteralPath $p)) { $orderOk = $false; continue }
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($p, [ref]$null, [ref]$null)
    $inv = @($ast.FindAll({ param($n) $n -is $FnAst -and $n.Name -like 'Invoke-*' -and $n.Body.Extent.Text -match 'Get-ThornswoodBoxRefusal' }, $false))
    $first = $null
    if ($inv.Count -eq 1) {
        $body = @($inv[0].Body.EndBlock.Statements)
        $ok1 = ($body.Count -gt 0 -and $body[0].Extent.Text -match 'Get-ThornswoodBoxRefusal')
        Yes "$rel asks first thing in $($inv[0].Name)" $ok1
        if (-not $ok1) { $orderOk = $false }
        $callRe = '^\s*try\s*\{\s*' + [regex]::Escape($inv[0].Name) + '\s*\}'
    } else {
        $callRe = 'Get-ThornswoodBoxRefusal'
    }
    $loose = @()
    foreach ($s in @($ast.EndBlock.Statements)) {
        if ($s -is $FnAst) { continue }
        if ($s.Extent.Text -match $callRe) { $first = $s; break }
        $quiet = $s -is [System.Management.Automation.Language.AssignmentStatementAst] -or
                 ($s.Extent.Text -match '^if \(\$Layer\) \{ \. \$Layer \}$') -or
                 ($s -is [System.Management.Automation.Language.IfStatementAst] -and -not $s.ElseClause -and
                  @($s.Clauses | ForEach-Object { $_.Item2.Statements } | Where-Object { $_ -isnot [System.Management.Automation.Language.AssignmentStatementAst] }).Count -eq 0)
        if (-not $quiet) { $loose += ('line {0}: {1}' -f $s.Extent.StartLineNumber, ($s.Extent.Text -split "`n")[0]) }
    }
    $ok = ($null -ne $first -and $loose.Count -eq 0)
    Yes "$rel only sets variables and defines functions before it asks" $ok
    foreach ($l in $loose) { Write-Host "      $l" }
    if (-not $ok) { $orderOk = $false }
}

# ---- 4. it refuses ------------------------------------------------------------
Write-Host ''
Write-Host 'each box script refuses when the rule says this is not the box'
if (-not ($ruleOk -and $orderOk)) {
    Write-Host 'NOT RUN  the scripts are not run while the rule or the order above fails, so none can go on past a broken guard'
    $script:fail++
} else {
    $shell = Get-BoxPowerShell
    $scratch = Join-Path ([IO.Path]::GetTempPath()) ('ts-3041-run-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
    $null = New-Item -ItemType Directory -Force -Path $scratch
    try {
        foreach ($case in @(@{ Name = 'a workstation'; StandIn = 'return [pscustomobject]@{ ProductType = 1 }'; Re = 'workstation, a gaming PC' },
                            @{ Name = 'no answer from Windows'; StandIn = 'throw ''RPC server unavailable'''; Re = 'did not say.*RPC server unavailable' })) {
            foreach ($rel in $carriers.Keys) {
                $c = $carriers[$rel]
                $a = $c.Args.Replace('<scratch>', $scratch)
                $cmd = "`$ProgressPreference = 'SilentlyContinue'`r`nfunction global:Get-CimInstance { $($case.StandIn) }`r`n" +
                       "& '" + (Path-Of $rel).Replace("'", "''") + "' $a`r`nexit `$LASTEXITCODE"
                $enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($cmd))
                $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
                try { $out = (@(& $shell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand $enc 2>&1 | ForEach-Object { "$_" }) -join ' ') }
                finally { $ErrorActionPreference = $eap }
                $code = $LASTEXITCODE
                $said = $out -match $case.Re -and ($c.Word -eq '' -or $out.Contains($c.Word))
                Yes ("{0} on {1}: refused, exit {2}" -f $rel, $case.Name, $code) ($said -and $code -ne 0)
                if (-not ($said -and $code -ne 0)) { Write-Host ("      it said: " + $out.Substring(0, [Math]::Min(400, $out.Length))) }
            }
        }
        Yes 'and nothing was written into the scratch folder they were pointed at' (@(Get-ChildItem -LiteralPath $scratch -Force).Count -eq 0)
    } finally {
        Remove-Item -LiteralPath $scratch -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host ''
Write-Host "$script:pass passed, $script:fail failed"
if ($script:fail) { exit 1 }
exit 0
