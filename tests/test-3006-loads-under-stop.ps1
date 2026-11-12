<#
  test-3006-loads-under-stop.ps1

      pwsh -NoProfile -File .\tests\test-3006-loads-under-stop.ps1

  Every file a script dot-sources is loaded while $ErrorActionPreference is
  Stop, so a file that is missing or does not parse ends the run on that line.

  WHY THIS EXISTS. Issue #3006. Ship.ps1 loaded its freshness guard (#2118),
  scripts\deploy\Fresh-Checkout.ps1, at line 350 and set Stop at line 965.
  Under the default, Continue, a dot-source of a file that is not there is
  an error PowerShell prints and walks past, and so is every call to a
  function that file would have defined: Assert-FreshCheckout was "not
  recognized" and the Ship went on with no freshness check at all.
  tests\test-ship-dry-run.ps1 did exactly that on every run, because its
  scratch tree had no Fresh-Checkout.ps1, and passed. About fifty other
  scripts (the deploys, Publish-Server, Publish-Update, Package-Thornswood,
  Publish-Installer, the box scripts loading Vps.ps1) had the same order,
  copied from each other, and the scripts that run under Continue on purpose
  (Check-ShipReady, Go, Get-Logs) loaded theirs under Continue too: a
  Check-ShipReady with no Assert-PublishSigned.ps1 read the signing as fine.

  THE RULE, for a script that is run rather than loaded: walking its top
  level in order, the last assignment to $ErrorActionPreference before each
  dot-source is 'Stop'. A script that runs under Continue on purpose sets
  Stop, loads, then sets Continue. A dot-source inside a function runs when
  the function is called, so it is allowed only in a script that never sets
  anything but Stop at its top level. A file another file dot-sources and
  that sets no preference of its own is a library: it loads under its
  caller's Stop, so its own loads are its caller's.

  The reader is driven over planted scripts first, each written to break the
  rule one way, so a reader that finds nothing anywhere cannot pass.

  Read only. Scratch files go under the temp folder.
#>
[CmdletBinding()]
param([string]$Repo)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $Repo) { $Repo = Split-Path -Parent $PSScriptRoot }

$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}

$CmdAst = [System.Management.Automation.Language.CommandAst]
$AssignAst = [System.Management.Automation.Language.AssignmentStatementAst]
$FnAst = [System.Management.Automation.Language.FunctionDefinitionAst]
$StrAst = [System.Management.Automation.Language.StringConstantExpressionAst]
# Predicates for FindAll, plain scriptblocks: a function call per node is slow
# over six hundred files.
$IsDot = { param($n) $n -is $CmdAst -and $n.InvocationOperator -eq 'Dot' }
$IsPrefSet = { param($n) $n -is $AssignAst -and $n.Left.Extent.Text -match '^\$(script:|global:)?ErrorActionPreference$' }
function Parse([string]$path) {
    $t = $null; $e = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$t, [ref]$e)
    return [pscustomobject]@{ Ast = $ast; Errors = @($e) }
}
# '$ErrorActionPreference = <value>' as a statement, in any scope prefix.
function Get-PreferenceSet($n) {
    if ($n -isnot $AssignAst) { return $null }
    if ($n.Left.Extent.Text -notmatch '^\$(script:|global:)?ErrorActionPreference$') { return $null }
    $v = $n.Right.Extent.Text.Trim()
    if ($v -match '^[''"](\w+)[''"]$') { return $Matches[1] }
    return $v
}
# The scope a statement runs in: the nearest script block around it. A
# preference set inside '& { }' or a Where-Object block is that block's own.
function Get-Scope($n) {
    $p = $n.Parent
    while ($p -and $p -isnot [System.Management.Automation.Language.ScriptBlockAst]) { $p = $p.Parent }
    return $p
}
function Test-Within($n, $outer) {
    $p = $n
    while ($p) { if ([object]::ReferenceEquals($p, $outer)) { return $true }; $p = $p.Parent }
    return $false
}
function Test-InFunction($n, $stop) {
    $p = $n.Parent
    while ($p -and -not [object]::ReferenceEquals($p, $stop)) {
        if ($p -is $FnAst) { return $true }
        $p = $p.Parent
    }
    return $false
}
# The file names a dot-source loads, from the strings in what it is handed.
function Get-LoadedNames($ast) {
    $names = @()
    foreach ($d in $ast.FindAll($IsDot, $true)) {
        foreach ($s in $d.CommandElements[0].FindAll({ param($n) $n -is $StrAst }, $true)) {
            if ($s.Value -match '\.ps1$') { $names += (($s.Value -replace '\\', '/') -split '/')[-1].ToLowerInvariant() }
        }
    }
    return $names
}

# Each load in a script that is run, that does not run under Stop, as a line.
# '$old = $ErrorActionPreference' is followed, so the put back after a call
# run under Continue for itself is read as the value it puts back.
$IsPrefSave = { param($n) $n -is $AssignAst -and $n.Right.Extent.Text.Trim() -match '^\$(script:|global:)?ErrorActionPreference$' }
function Get-LoadsWithoutStop($ast) {
    $out = @()
    $state = ''
    $saved = @{}
    $fnDots = @()
    function Resolve-Set([string]$v) { if ($v.StartsWith('$') -and $saved.ContainsKey($v)) { return $saved[$v] } return $v }
    foreach ($s in $ast.EndBlock.Statements) {
        $set = Get-PreferenceSet $s
        if ($null -ne $set) { $state = Resolve-Set $set; continue }
        if (& $IsPrefSave $s) { $saved[$s.Left.Extent.Text.Trim()] = $state; continue }
        if ($s -is $FnAst) {
            $fnDots += @($s.FindAll($IsDot, $true)); continue
        }
        # A preference set inside the statement (a try that sets Continue for
        # one call) holds for what follows it there.
        $dots = @($s.FindAll($IsDot, $true))
        if (-not $dots.Count) { continue }
        $inner = @($s.FindAll({ param($n) (& $IsPrefSet $n) -or (& $IsPrefSave $n) }, $true) |
                   Where-Object { -not (Test-InFunction $_ $s) } | Sort-Object { $_.Extent.StartOffset })
        foreach ($d in $dots) {
            if (Test-InFunction $d $s) { $fnDots += $d; continue }
            $here = $state
            $keep = $saved.Clone()
            foreach ($a in $inner) {
                if ($a.Extent.EndOffset -gt $d.Extent.StartOffset) { break }
                if (-not (Test-Within $d (Get-Scope $a))) { continue }
                if (& $IsPrefSave $a) { $saved[$a.Left.Extent.Text.Trim()] = $here } else { $here = Resolve-Set (Get-PreferenceSet $a) }
            }
            $saved = $keep
            if ($here -ne 'Stop') {
                $was = if ($here) { $here } else { 'not set, so the caller''s or Continue' }
                $out += ("line {0}: {1} loads while ErrorActionPreference is {2}" -f $d.Extent.StartLineNumber, $d.Extent.Text, $was)
            }
        }
    }
    # A function runs when it is called, which in a script that ends its top
    # level under Continue is under Continue.
    if ($state -ne 'Stop') {
        foreach ($d in $fnDots) {
            $out += ("line {0}: {1} loads inside a function, in a script whose top level ends under {2}" -f $d.Extent.StartLineNumber, $d.Extent.Text, $(if ($state) { $state } else { 'its caller''s preference' }))
        }
    }
    return ,$out
}
function Test-Library($ast, [string]$leaf, $loaded) {
    if (-not ($loaded -contains $leaf.ToLowerInvariant())) { return $false }
    foreach ($s in $ast.EndBlock.Statements) { if ($null -ne (Get-PreferenceSet $s)) { return $false } }
    return $true
}

# ---- the reader, on planted scripts ------------------------------------------------
Write-Host 'The reader, on planted scripts'
$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-3006-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $T | Out-Null
try {
    $planted = [ordered]@{
        # name = text, bad lines it must find
        'before-stop' = @("param([switch]`$X)`n. (Join-Path `$PSScriptRoot 'Fresh-Checkout.ps1')`nAssert-FreshCheckout`n`$ErrorActionPreference = 'Stop'`n", 1)
        'never-set' = @("param()`n. (Join-Path `$PSScriptRoot 'Vps.ps1')`n", 1)
        'stop-first' = @("param()`n`$ErrorActionPreference = 'Stop'`n. (Join-Path `$PSScriptRoot 'Vps.ps1')`n", 0)
        'stop-then-continue' = @("param()`n`$ErrorActionPreference = 'Stop'`n. (Join-Path `$PSScriptRoot 'Vps.ps1')`n`$ErrorActionPreference = 'Continue'`n", 0)
        'continue-then-load' = @("`$ErrorActionPreference = 'Continue'`n. (Join-Path `$PSScriptRoot 'Vps.ps1')`n", 1)
        'later-load-under-continue' = @("`$ErrorActionPreference = 'Stop'`n. 'a.ps1'`n`$ErrorActionPreference = 'Continue'`nif (`$true) { . 'b.ps1' }`n", 1)
        'try-under-continue' = @("`$ErrorActionPreference = 'Continue'`ntry { . 'a.ps1' } catch { }`n", 1)
        'continue-inside-a-block' = @("`$ErrorActionPreference = 'Stop'`nif (`$true) { `$ErrorActionPreference = 'Continue'; . 'a.ps1' }`n", 1)
        'continue-in-a-child-scope' = @("`$ErrorActionPreference = 'Stop'`ntry { & { `$ErrorActionPreference = 'Continue'; git status }; . 'a.ps1' } finally { }`n", 0)
        'load-in-a-child-scope-under-continue' = @("`$ErrorActionPreference = 'Stop'`n& { `$ErrorActionPreference = 'Continue'; . 'a.ps1' }`n", 1)
        'function-in-a-continue-script' = @("`$ErrorActionPreference = 'Stop'`n. 'a.ps1'`n`$ErrorActionPreference = 'Continue'`nfunction F { . 'b.ps1' }`n", 1)
        'function-in-a-stop-script' = @("`$ErrorActionPreference = 'Stop'`nfunction F { . 'b.ps1' }`n", 0)
        'put-back-to-stop' = @("`$ErrorActionPreference = 'Stop'`n`$old = `$ErrorActionPreference; `$ErrorActionPreference = 'Continue'`n& git status`n`$ErrorActionPreference = `$old`n. 'a.ps1'`nfunction F { . 'b.ps1' }`n", 0)
        'put-back-to-continue' = @("`$ErrorActionPreference = 'Continue'`n`$old = `$ErrorActionPreference; `$ErrorActionPreference = 'Stop'`n`$ErrorActionPreference = `$old`n. 'a.ps1'`n", 1)
        'load-between-a-save-and-its-put-back' = @("`$ErrorActionPreference = 'Stop'`ntry { `$old = `$ErrorActionPreference; `$ErrorActionPreference = 'Continue'; . 'a.ps1' } finally { `$ErrorActionPreference = `$old }`n. 'b.ps1'`n", 1)
    }
    foreach ($k in $planted.Keys) {
        $p = Join-Path $T ($k + '.ps1')
        [IO.File]::WriteAllText($p, $planted[$k][0])
        $found = Get-LoadsWithoutStop (Parse $p).Ast
        Yes ("{0}: {1} found, {2} planted" -f $k, $found.Count, $planted[$k][1]) ($found.Count -eq $planted[$k][1])
    }
    $lib = Join-Path $T 'lib.ps1'
    [IO.File]::WriteAllText($lib, ". (Join-Path `$PSScriptRoot 'Vps.ps1')`nfunction G { }`n")
    Yes 'a file another file loads, setting no preference, is a library' (Test-Library (Parse $lib).Ast 'lib.ps1' @('lib.ps1'))
    Yes '  and one nothing loads is a script that is run' (-not (Test-Library (Parse $lib).Ast 'lib.ps1' @('other.ps1')))
    [IO.File]::WriteAllText($lib, "`$ErrorActionPreference = 'Continue'`n. 'a.ps1'`n")
    Yes '  and one that sets its own preference is held to the rule, loaded or not' (-not (Test-Library (Parse $lib).Ast 'lib.ps1' @('lib.ps1')))
} finally {
    Remove-Item -LiteralPath $T -Recurse -Force -ErrorAction SilentlyContinue
}

# ---- every script here ---------------------------------------------------------------
Write-Host ''; Write-Host 'Every script in scripts\, tests\, installer\ and each product''s tests folder'
# And every product's own tests folder (game\tests, launcher\tests, #5341).
$beside = @(Get-ChildItem -LiteralPath $Repo -Directory | Where-Object { $_.Name -notin @('tests', 'node_modules', 'worktrees', 'temp', 'local') -and (Test-Path -LiteralPath (Join-Path $_.FullName 'tests') -PathType Container) } | ForEach-Object { Join-Path $_.Name 'tests' })
$files = @(foreach ($d in @('scripts', 'tests', 'installer') + $beside) {
    $dir = Join-Path $Repo $d
    if (Test-Path -LiteralPath $dir) {
        Get-ChildItem -LiteralPath $dir -Recurse -File -Filter '*.ps1' | Where-Object { $_.FullName -notmatch '[\\/]node_modules[\\/]' }
    }
})
Yes ("{0} scripts found" -f $files.Count) ($files.Count -gt 200)
$parsed = @{}
$loaded = @()
foreach ($f in $files) {
    $r = Parse $f.FullName
    $parsed[$f.FullName] = $r
    $loaded += @(Get-LoadedNames $r.Ast)
}
$loaded = @($loaded | Sort-Object -Unique)
Yes 'Fresh-Checkout.ps1 and Vps.ps1 are among the files loaded, so libraries are told apart' ($loaded -contains 'fresh-checkout.ps1' -and $loaded -contains 'vps.ps1')
$bad = 0; $libs = 0; $run = 0
foreach ($f in $files) {
    $rel = $f.FullName.Substring($Repo.Length).TrimStart('\', '/')
    $r = $parsed[$f.FullName]
    if ($r.Errors.Count) { $bad++; Yes ("{0} parses ({1})" -f $rel, $r.Errors[0].Message) $false; continue }
    if (Test-Library $r.Ast $f.Name $loaded) { $libs++; continue }
    $run++
    $found = Get-LoadsWithoutStop $r.Ast
    if ($found.Count) {
        $bad++
        Yes ("{0} loads every file under Stop" -f $rel) $false
        foreach ($x in $found) { Write-Host ("      " + $x) }
    }
}
Yes ("every one of the {0} scripts that are run loads under Stop ({1} libraries load under their caller's)" -f $run, $libs) ($bad -eq 0)
Done
