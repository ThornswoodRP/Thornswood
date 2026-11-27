<#
  test-4385-ssh-warning-kept.ps1

      pwsh -NoProfile -File .\scripts\tests\test-4385-ssh-warning-kept.ps1

  Issues #4385 and #4400. The fix for #1043 took the filter that dropped ssh's
  post-quantum warning out of the box scripts, so a warning that comes back
  (an sshd put back to one with no post-quantum key exchange) is seen.
  Set-InboundRules.ps1, Install-Gate.ps1 and Box-Run.ps1 still dropped it, and
  no test read whether the warning reached the output, so a filter put back
  anywhere passed every test.

  This holds, reading the scripts under scripts\ (not their tests) with
  PowerShell's parser:
    1. every Clean($lines), the function each box script runs ssh's answer
       through, lifted out by its AST and run on the three lines of the
       warning, keeps all three and drops only the empty lines; and Install-
       Gate, Set-InboundRules, Harden-VPS, Set-SshScope, Set-TimeWait,
       Set-WebFirewall and Grant-BoxAccess are among them;
    2. no comparison, -match, -notmatch, -like, -notlike or -replace, in any
       of those scripts names the warning (post-quantum, "store now, decrypt
       later" or openssh.com/pq.html), so no other filter drops it either;
    3. Box-Run.ps1 writes every other non-empty line ssh says into the sealed
       output, the warning included.

  Never connects to anything. Under a second.
#>
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$ok) {
    if ($ok) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}

# What OpenSSH 9.x and later print on stderr for a connection to an sshd with
# no post-quantum key exchange (#941, #1043).
$Warning = @(
    '** WARNING: connection is not using a post-quantum key exchange algorithm.',
    '** This session may be vulnerable to "store now, decrypt later" attacks.',
    '** The server may need to be upgraded. See https://openssh.com/pq.html')

$L = [System.Management.Automation.Language.Ast]
$scriptsDir = [IO.Path]::Combine($Repo, 'scripts')
$files = @(Get-ChildItem -LiteralPath $scriptsDir -Recurse -Filter '*.ps1' |
    Where-Object { $_.FullName.Substring($scriptsDir.Length) -notmatch '^[\\/]tests[\\/]' })
Yes ('the scripts under scripts\ are read (' + $files.Count + ')') ($files.Count -gt 50)
$parsed = @{}
foreach ($f in $files) {
    $errs = $null
    $parsed[$f.FullName] = [System.Management.Automation.Language.Parser]::ParseFile($f.FullName, [ref]$null, [ref]$errs)
}
function Short([string]$full) { $full.Substring($Repo.Length + 1).Replace('\', '/') }

# ---- 1. every Clean($lines) keeps the warning -------------------------------
$cleans = @()
foreach ($f in $files) {
    foreach ($fn in $parsed[$f.FullName].FindAll({ param($a)
            $a -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $a.Name -eq 'Clean' -and
            @($a.Parameters).Count -eq 1 -and $a.Parameters[0].Name.VariablePath.UserPath -eq 'lines' }, $true)) {
        $cleans += [pscustomobject]@{ File = (Short $f.FullName); Text = $fn.Extent.Text }
    }
}
$named = @('scripts/deploy/Install-Gate.ps1', 'scripts/vps/Set-InboundRules.ps1', 'scripts/vps/Harden-VPS.ps1',
           'scripts/vps/Set-SshScope.ps1', 'scripts/vps/Set-TimeWait.ps1', 'scripts/vps/Set-WebFirewall.ps1',
           'scripts/vps/Grant-BoxAccess.ps1')
$missing = @($named | Where-Object { @($cleans.File) -notcontains $_ })
Yes ('1 the box scripts that read ssh''s answer through Clean are all found (' + $cleans.Count + ' Clean)' +
     $(if ($missing.Count) { '; missing: ' + ($missing -join ', ') } else { '' })) (-not $missing.Count)
$answer = @('CHANGED one rule', '') + $Warning + @('', 'DONE')
foreach ($c in $cleans) {
    . ([scriptblock]::Create($c.Text))
    $got = @(Clean $answer | ForEach-Object { "$_".Trim() })
    $kept = @($Warning | Where-Object { $got -contains $_ })
    Yes ('1 ' + $c.File + ' keeps the three warning lines (' + $kept.Count + ') and the box''s own') (
        $kept.Count -eq 3 -and $got -contains 'CHANGED one rule' -and $got -contains 'DONE')
    Yes ('1 ' + $c.File + ' leaves out only the empty lines (' + $got.Count + ' of ' + $answer.Count + ')') (
        $got.Count -eq 5 -and -not @($got | Where-Object { -not $_ }).Count)
    Remove-Item Function:\Clean
}

# ---- 2. no filter names the warning ----------------------------------------
$names = '(?i)quantum|decrypt later|pq\\?\.html'
$ops = 'match|notmatch|like|notlike|replace|eq|ne|contains|notcontains|in|notin'
$found = @()
foreach ($f in $files) {
    foreach ($b in $parsed[$f.FullName].FindAll({ param($a)
            $a -is [System.Management.Automation.Language.BinaryExpressionAst] -and
            ($a.Operator.ToString() -replace '^[IC]', '') -match ('^(' + $ops + ')$') }, $true)) {
        foreach ($s in $b.FindAll({ param($a) $a -is [System.Management.Automation.Language.StringConstantExpressionAst] -or
                                            $a -is [System.Management.Automation.Language.ExpandableStringExpressionAst] }, $true)) {
            if ($s.Value -match $names) { $found += (Short $f.FullName) + ':' + $b.Extent.StartLineNumber + ' ' + $b.Extent.Text }
        }
    }
}
Yes ('2 no comparison in scripts\ names the warning' + $(if ($found.Count) { ': ' + ($found -join ' | ') } else { '' })) (-not $found.Count)

# ---- 3. Box-Run.ps1 writes what ssh says ------------------------------------
$boxRun = [IO.Path]::Combine($Repo, 'scripts', 'vps', 'Box-Run.ps1')
$gl = $parsed[$boxRun].Find({ param($a) $a -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $a.Name -eq 'Invoke-GateLine' }, $true)
Yes '3 Box-Run.ps1 has Invoke-GateLine' ($null -ne $gl)
$glText = if ($gl) { $gl.Extent.Text } else { '' }
Yes '3 and its last case writes every other non-empty line ssh says into the output' (
    $glText -match "(?m)^\s*elseif \(\`$l\) \{ \[IO\.File\]::AppendAllText\(\`$out, 'ssh: ' \+ \`$l \+ ""``n"", \`$utf8\) \}\s*$")

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
exit ([int]($script:fail -gt 0))
