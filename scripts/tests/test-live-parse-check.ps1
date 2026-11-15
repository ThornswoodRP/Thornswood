<#
  test-live-parse-check.ps1

      pwsh -NoProfile -File .\scripts\tests\test-live-parse-check.ps1

  The three gamemode deploys check gamemode.js parses before anything is
  written or sent, and refuse on a machine without node.

  WHY. Deploy-DevGamemode.ps1 ran node --check; Deploy-Gamemode.ps1 and
  Deploy-Server.ps1 did not, so a gamemode.js with a syntax error could go to
  the live server and stop it at start (issue #544). The live two now refuse,
  and refuse too when node is missing, since the live server is the one that
  cannot be left down. The dev one still skipped the check with a warning
  where node was missing, then stopped the dev server and sent a file nobody
  had checked, and it sent the artifact to the box's store before the check
  either way (issue #1857). A gamemode that does not parse takes the dev
  server down for everybody testing on it, so it refuses the same way now.

  HOW. Reads the scripts as text and as syntax trees: the check is there, it
  throws, and it comes before the line that writes or sends the file. Each
  script asks for node in one place, and that place only refuses, with the
  same sentence, before anything leaves the machine; that block is run here
  with node missing and with node there. Then runs node --check on a broken
  file, to show the check this relies on really fails.
#>
[CmdletBinding()]
param([string]$Repo)
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# This harness is in scripts\tests\, the repository is two folders up.
$Here = Split-Path -Parent (Split-Path -Parent $Here)
if (-not $Repo) { $Repo = $Here }

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function LineOf([string[]]$lines, [string]$pattern) {
    for ($i = 0; $i -lt $lines.Count; $i++) { if ($lines[$i] -match $pattern) { return $i + 1 } }
    return 0
}

# ---- Deploy-Gamemode.ps1 ------------------------------------------------------
$g = @(Get-Content -LiteralPath (Join-Path $Repo 'scripts\deploy\Deploy-Gamemode.ps1'))
$check = LineOf $g '^\s*& node --check \$Gamemode'
$copy = LineOf $g "^\s*Copy-Item -LiteralPath \`$Gamemode -Destination \(Join-Path \`$Dist 'gamemode.js'\)"
Yes 'Deploy-Gamemode runs node --check on gamemode.js' ($check -gt 0)
Yes '  before it copies the file into the build' ($check -gt 0 -and $copy -gt $check)
Yes '  and stops when it fails' (($g -join "`n") -match "LASTEXITCODE -ne 0\) \{ throw 'gamemode.js does not parse")
Yes '  and stops when node is missing, rather than skipping' (($g -join "`n") -match "Get-Command node[^\n]*\) \{ throw")

# ---- Deploy-Server.ps1 --------------------------------------------------------
$s = @(Get-Content -LiteralPath (Join-Path $Repo 'scripts\deploy\Deploy-Server.ps1'))
$check = LineOf $s '^\s*& node --check \$built'
# Every server file the record lists goes, since #1214, so the list is built
# from the record rather than written out.
$list = LineOf $s "^\`$files = "
# The first line that runs a call to the VPS: Remote, scp or ssh, or one of
# the functions that ask the live server who is on it. Read off the syntax
# tree, and only outside a function body, because a body runs where it is
# called and not where it is written: since #865 Warn-LiveRoom holds two
# Remote lines near the top of the file and is called after the check.
$vpsCalls = @('Remote', 'scp', 'ssh', 'OnlineNow', 'Get-LiveOnline', 'Warn-LiveRoom')
$tk = $null; $pe = $null
$sAst = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $Repo 'scripts\deploy\Deploy-Server.ps1'), [ref]$tk, [ref]$pe)
$first = 0
foreach ($c in $sAst.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true)) {
    if ($vpsCalls -notcontains $c.GetCommandName()) { continue }
    $inFn = $false
    for ($p = $c.Parent; $p; $p = $p.Parent) { if ($p -is [System.Management.Automation.Language.FunctionDefinitionAst]) { $inFn = $true; break } }
    if ($inFn) { continue }
    $at = $c.Extent.StartLineNumber
    if ($first -eq 0 -or $at -lt $first) { $first = $at }
}
Yes 'Deploy-Server runs node --check on the gamemode.js it sends' ($check -gt 0)
Yes '  before it lists what it sends' ($check -gt 0 -and $list -gt $check)
Yes '  and before anything talks to the VPS' ($check -gt 0 -and ($first -eq 0 -or $first -gt $check))
Yes '  and stops when it fails' (($s -join "`n") -match "LASTEXITCODE -ne 0\) \{ throw 'gamemode.js does not parse")

# ---- Deploy-DevGamemode.ps1 ---------------------------------------------------
$d = @(Get-Content -LiteralPath (Join-Path $Repo 'scripts\deploy\Deploy-DevGamemode.ps1'))
Yes 'Deploy-DevGamemode still runs node --check' ((LineOf $d '& node --check \$Gamemode') -gt 0)
Yes '  and stops when it fails' (($d -join "`n") -match "LASTEXITCODE -ne 0\) \{ throw 'gamemode.js does not parse")
Yes '  and never says the check was skipped' (($d -join "`n") -notmatch 'check was skipped')

# ---- node missing: all three refuse, none skips (#1857) -----------------------
# Each script asks for node in one if, and that if only throws: no else that
# carries on, nothing else in it. The sentence is the same in all three, up to
# what each would have done next (Deploy-Gamemode writes the build, the other
# two send).
$shared = 'node is not on this machine, so gamemode.js cannot be checked before it goes live. Nothing was '
function Read-Ast([string]$rel) {
    $tk = $null; $pe = $null
    return [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $Repo $rel), [ref]$tk, [ref]$pe)
}
function InFunction($n) {
    for ($p = $n.Parent; $p; $p = $p.Parent) { if ($p -is [System.Management.Automation.Language.FunctionDefinitionAst]) { return $true } }
    return $false
}
function NodeIfs($ast) {
    return , @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.IfStatementAst] }, $true) |
               Where-Object { @($_.Clauses | Where-Object { $_.Item1.Extent.Text -match 'Get-Command\s+node\b' }).Count })
}
# The if run on its own, with Get-Command answering for node as a machine
# with or without it would. What it throws, or '' when it carries on.
function Run-NodeIf($if, [bool]$hasNode) {
    $stub = "function Get-Command { param([string]`$Name, `$ErrorAction) if (`$Name -eq 'node') { if (`$$hasNode) { return 'node' } return `$null } throw 'asked for ' + `$Name }"
    try { & ([scriptblock]::Create($stub + "`n" + $if.Extent.Text)); return '' }
    catch { return $_.Exception.Message }
}
$scripts = [ordered]@{
    'Deploy-Gamemode.ps1'    = @{ Rel = 'scripts\deploy\Deploy-Gamemode.ps1';    Next = 'written.' }
    'Deploy-Server.ps1'      = @{ Rel = 'scripts\deploy\Deploy-Server.ps1';      Next = 'sent.' }
    'Deploy-DevGamemode.ps1' = @{ Rel = 'scripts\deploy\Deploy-DevGamemode.ps1'; Next = 'sent.' }
}
$said = @{}
foreach ($n in $scripts.Keys) {
    $w = $scripts[$n]
    $ast = Read-Ast $w.Rel
    $ifs = NodeIfs $ast
    Yes "$n asks for node in one place ($($ifs.Count))" ($ifs.Count -eq 1)
    if ($ifs.Count -ne 1) { continue }
    $if = $ifs[0]
    $body = @($if.Clauses[0].Item2.Statements)
    $throw = $null
    if ($body.Count -eq 1 -and $body[0] -is [System.Management.Automation.Language.ThrowStatementAst]) { $throw = $body[0] }
    Yes '  and there it only throws, with no else that carries on' (
        $if.Clauses.Count -eq 1 -and -not $if.ElseClause -and $if.Clauses[0].Item1.Extent.Text -match '^-not\s*\(' -and $throw)
    # Run only when all it does is throw, so nothing else in it runs here.
    $missing = ''; $there = 'not run'
    if ($throw) { $missing = Run-NodeIf $if $false; $there = Run-NodeIf $if $true }
    $said[$n] = $missing
    Yes "  run with node missing, it refuses: $missing" ($missing -eq ($shared + $w.Next))
    Yes '  run with node there, it carries on' ($there -eq '')
    $check = @($ast.FindAll({ param($x) $x -is [System.Management.Automation.Language.CommandAst] -and $x.GetCommandName() -eq 'node' -and $x.Extent.Text -match '--check' }, $true))
    Yes '  before it runs node --check, which nothing asking for node wraps' (
        $check.Count -eq 1 -and $if.Extent.EndOffset -lt $check[0].Extent.StartOffset -and
        -not ($ifs | Where-Object { $_.Extent.StartOffset -lt $check[0].Extent.StartOffset -and $_.Extent.EndOffset -gt $check[0].Extent.EndOffset }))
}
Yes 'Deploy-DevGamemode refuses with the same sentence as Deploy-Server' (
    $said['Deploy-DevGamemode.ps1'] -and $said['Deploy-DevGamemode.ps1'] -eq $said['Deploy-Server.ps1'])

# Deploy-Gamemode writes the build and talks to nobody: the refusal comes
# before it copies gamemode.js in.
$gAst = Read-Ast 'scripts\deploy\Deploy-Gamemode.ps1'
$gIf = @(NodeIfs $gAst)
$gCopy = LineOf $g "^\s*Copy-Item -LiteralPath \`$Gamemode -Destination \(Join-Path \`$Dist 'gamemode.js'\)"
Yes 'Deploy-Gamemode refuses before it copies the file into the build' ($gIf.Count -eq 1 -and $gCopy -gt $gIf[0].Extent.StartLineNumber)

# Deploy-DevGamemode refuses before anything reaches the box: the artifact
# sent to the store, a Remote, ssh or scp, or any function of its own that
# calls one. Read off the syntax tree, outside function bodies, because a
# body runs where it is called and not where it is written.
$dAst = Read-Ast 'scripts\deploy\Deploy-DevGamemode.ps1'
$far = @('ssh', 'scp', 'Invoke-ThornswoodRemote', 'Send-ThornswoodArtifact', 'Set-ThornswoodArtifactCurrent', 'Save-SwapPreviousRecord', 'Restore-SwapRecord')
$fns = @($dAst.FindAll({ param($x) $x -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true))
do {
    $grew = $false
    foreach ($f in $fns) {
        if ($far -contains $f.Name) { continue }
        $calls = @($f.Body.FindAll({ param($x) $x -is [System.Management.Automation.Language.CommandAst] }, $true) | ForEach-Object { $_.GetCommandName() })
        if (@($calls | Where-Object { $far -contains $_ }).Count) { $far += $f.Name; $grew = $true }
    }
} while ($grew)
$firstFar = @($dAst.FindAll({ param($x) $x -is [System.Management.Automation.Language.CommandAst] }, $true) |
              Where-Object { ($far -contains $_.GetCommandName()) -and -not (InFunction $_) } |
              Sort-Object { $_.Extent.StartOffset } | Select-Object -First 1)
$dIf = @(NodeIfs $dAst)
$farSay = if ($firstFar.Count) { '{0}, line {1}' -f $firstFar[0].GetCommandName(), $firstFar[0].Extent.StartLineNumber } else { 'none' }
Yes "Deploy-DevGamemode refuses before anything reaches the box (the first is $farSay)" (
    $dIf.Count -eq 1 -and $firstFar.Count -eq 1 -and $dIf[0].Extent.EndOffset -lt $firstFar[0].Extent.StartOffset)
$dCheck = @($dAst.FindAll({ param($x) $x -is [System.Management.Automation.Language.CommandAst] -and $x.GetCommandName() -eq 'node' }, $true))
Yes '  and checks the file before anything reaches the box too' ($dCheck.Count -eq 1 -and $firstFar.Count -eq 1 -and $dCheck[0].Extent.EndOffset -lt $firstFar[0].Extent.StartOffset)
Yes '  and checks the copy it sends, the artifact''s' ($dCheck.Count -eq 1 -and $dCheck[0].Extent.StartOffset -gt ($dAst.Extent.Text.IndexOf('$Gamemode = Join-Path $artifact.Folder')))
# A put-back sends no gamemode, so it asks for no node, as Deploy-Server's.
$guard = @($dAst.FindAll({ param($x) $x -is [System.Management.Automation.Language.IfStatementAst] -and $x.Clauses[0].Item1.Extent.Text -eq '-not $PutBack' }, $true) |
           Where-Object { $dIf.Count -eq 1 -and $_.Extent.StartOffset -lt $dIf[0].Extent.StartOffset -and $_.Extent.EndOffset -gt $dIf[0].Extent.EndOffset })
Yes '  and a put-back, which sends no gamemode, does not ask for node' ($guard.Count -ge 1)

# ---- node --check really fails on a broken file -------------------------------
if (Get-Command node -ErrorAction SilentlyContinue) {
    $tmp = Join-Path ([IO.Path]::GetTempPath()) ('ts-parse-' + [guid]::NewGuid().ToString('N') + '.js')
    # node says why a file does not parse on stderr. Under Windows PowerShell
    # 5.1 that line comes back through 2>&1 as an error record, and with Stop
    # it ended this harness before the exit code was read (#2739); PowerShell
    # 7 hands it over as text. The exit code is what is checked, so the line
    # is let through to Out-Null here, and Stop is back after.
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try {
        [IO.File]::WriteAllText($tmp, "function (\n")
        & node --check $tmp 2>&1 | Out-Null
        Yes 'node --check fails on a file that does not parse' ($LASTEXITCODE -ne 0)
        [IO.File]::WriteAllText($tmp, "const a = 1;`n")
        & node --check $tmp 2>&1 | Out-Null
        Yes '  and passes one that does' ($LASTEXITCODE -eq 0)
    }
    finally {
        $ErrorActionPreference = $old
        Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
    }
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
