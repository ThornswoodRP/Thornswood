<#
  test-4517-helps-match-code.ps1

      pwsh -NoProfile -File .\tests\test-4517-helps-match-code.ps1

  The helps of scripts in scripts\mods said things their code does not do
  (#4517). Each fact here is read out of the code itself, so a help that
  drifts from its code again turns this red:
    1. LoadOrder.ps1, Generated.ps1 and OnBox.ps1 name every script that
       dot-sources them (found by parsing every script under scripts);
    2. OnBox.ps1 says what it holds: the script texts it builds and the
       variables it sets, not "functions and nothing else";
    3. Clean-Everything names no parameter it does not have;
    4. Check-CollectionRules' usage lines give each of its parameters, and its
       help says the verdict it prints (NOT HELD);
    5. Build-LastPlugin's help for --check names every file and table that
       --check compares, and that the manifest is compared by what it says;
    6. Audit-ModMenus, Check-SkyUIMenus and Check-CreationForms each name the
       plugins.txt they read when --plugins is not given.
#>
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond, [string]$why = '') {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red; if ($why) { Write-Host "      $why" } }
}
# A file as text with LF line ends: a Windows checkout holds these scripts
# CRLF (.gitattributes pins only the generated tables), and what a help says
# is the same either way.
function Text([string]$rel) { return [IO.File]::ReadAllText((Join-Path $repo $rel)).Replace("`r`n", "`n") }
# A PowerShell script's help: its first <# #> block.
function PsHelp([string]$rel) { return [regex]::Match((Text $rel), '(?s)<#(.*?)#>').Groups[1].Value }
# A node script's help: the // lines it starts with.
function JsHelp([string]$rel) {
    $out = New-Object Text.StringBuilder
    foreach ($l in [IO.File]::ReadAllLines((Join-Path $repo $rel))) { if ($l -notmatch '^//') { break }; [void]$out.AppendLine($l.Substring(2)) }
    return $out.ToString()
}
# One run of spaces and line breaks reads as one space, so a help may wrap anywhere.
function Flat([string]$s) { return ($s -replace '\s+', ' ') }

# ---- 1. who dot-sources each library ------------------------------------------------
$scripts = @(Get-ChildItem -LiteralPath (Join-Path $repo 'scripts') -Recurse -File -Filter '*.ps1')
function Sourcers([string]$lib) {
    $by = @()
    foreach ($f in $scripts) {
        if ($f.Name -eq $lib) { continue }
        $ast = [Management.Automation.Language.Parser]::ParseFile($f.FullName, [ref]$null, [ref]$null)
        $hit = $ast.Find({ param($a) $a -is [Management.Automation.Language.CommandAst] -and $a.InvocationOperator -eq 'Dot' -and $a.Extent.Text -match ("[\\/'""]" + [regex]::Escape($lib) + "['""]") }, $true)
        if ($hit) { $by += $f.Name }
    }
    return @($by | Sort-Object -Unique)
}
foreach ($lib in @(@('LoadOrder.ps1', 'scripts/mods/LoadOrder.ps1'), @('Generated.ps1', 'scripts/mods/Generated.ps1'), @('OnBox.ps1', 'scripts/mods/OnBox.ps1'))) {
    $by = Sourcers $lib[0]
    $help = Flat (PsHelp $lib[1])
    $missing = @($by | Where-Object { $help -notmatch [regex]::Escape($_) })
    Yes ("{0}'s help names every script that dot-sources it ({1})" -f $lib[0], ($by -join ', ')) ($by.Count -gt 0 -and $missing.Count -eq 0) ('not named: ' + ($missing -join ', '))
}

# ---- 2. what OnBox.ps1 holds ----------------------------------------------------------
$onBox = Text 'scripts/mods/OnBox.ps1'
$onHelp = Flat (PsHelp 'scripts/mods/OnBox.ps1')
$texts = @([regex]::Matches($onBox, '(?m)^function (Get-ThornswoodOnBox\w*Script)\b') | ForEach-Object { $_.Groups[1].Value })
$vars = @([regex]::Matches($onBox, '(?m)^(\$Thornswood\w+)\s*=') | ForEach-Object { $_.Groups[1].Value })
$words = @{ 1 = 'one'; 2 = 'two'; 3 = 'three'; 4 = 'four'; 5 = 'five'; 6 = 'six' }
Yes ("OnBox.ps1's help gives the number of script texts it builds ({0})" -f $texts.Count) ($texts.Count -gt 0 -and $onHelp -match ('\b' + $words[$texts.Count] + ' script texts\b')) ($texts -join ', ')
Yes 'and names each variable it sets, so it no longer says it defines functions and nothing else' (
    $vars.Count -gt 0 -and @($vars | Where-Object { $onHelp -notmatch [regex]::Escape($_) }).Count -eq 0 -and $onHelp -notmatch 'Defines functions and nothing else') ($vars -join ', ')

# ---- 3. Clean-Everything -------------------------------------------------------------
$ce = 'scripts/mods/Clean-Everything.ps1'
$ceAst = [Management.Automation.Language.Parser]::ParseFile((Join-Path $repo $ce), [ref]$null, [ref]$null)
$ceParams = @($ceAst.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath })
$tokens = $null
[void][Management.Automation.Language.Parser]::ParseFile((Join-Path $repo $ce), [ref]$tokens, [ref]$null)
$named = @($tokens | Where-Object { $_.Kind -eq 'Comment' -and $_.Text -notmatch '^#Requires\b' } | ForEach-Object { [regex]::Matches($_.Text, '(?<![\w-])-([A-Z][A-Za-z]+)\b') } | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique)
$notThere = @($named | Where-Object { $ceParams -notcontains $_ })
Yes 'Clean-Everything''s help and comments name no parameter it does not have' ($notThere.Count -eq 0) ('named but not declared: ' + ($notThere -join ', '))

# ---- 4. Check-CollectionRules -------------------------------------------------------
$cr = 'scripts/mods/Check-CollectionRules.ps1'
$crAst = [Management.Automation.Language.Parser]::ParseFile((Join-Path $repo $cr), [ref]$null, [ref]$null)
$crParams = @($crAst.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath })
$crHelp = PsHelp $cr
$usage = (@($crHelp -split "`n" | Where-Object { $_ -match 'Check-CollectionRules\.ps1\b' -and $_ -match '^\s+\.\\' }) -join ' ')
$noUsage = @($crParams | Where-Object { $usage -notmatch ('-' + $_ + '\b') })
Yes ("Check-CollectionRules' usage lines give each of its parameters ({0})" -f ($crParams -join ', ')) ($noUsage.Count -eq 0) ('not in a usage line: ' + ($noUsage -join ', '))
$crCode = Text $cr
Yes 'and its help says the verdict it prints, NOT HELD, and not NO' ($crCode.Contains('NOT HELD.') -and (Flat $crHelp) -match 'NOT HELD' -and (Flat $crHelp) -notmatch '\bIt says NO\b')

# ---- 5. Build-LastPlugin --check -----------------------------------------------------
$blp = Text 'scripts/mods/Build-LastPlugin.py'
$doc = [regex]::Match($blp, '(?s)^"""(.*?)"""').Groups[1].Value
$checkHelp = Flat ([regex]::Match($doc, '(?s)--check builds.*?(?=--verify|\z)').Value)
$branch = [regex]::Match($blp, '(?s)    if args\.check:\n(.*?)\n        return 0 if').Groups[1].Value
$tables = @([regex]::Matches($branch, "is_current\('(\w+)'") | ForEach-Object { $_.Groups[1].Value })
$noTable = @($tables | Where-Object { $checkHelp -notmatch [regex]::Escape($_) })
Yes ("Build-LastPlugin's help for --check names each table --check compares ({0})" -f ($tables -join ', ')) ($tables.Count -gt 0 -and $noTable.Count -eq 0) ('not named: ' + ($noTable -join ', '))
Yes '  and says the manifest is compared by what it says, not as bytes' ($branch -match 'compared as what it says' -and $checkHelp -match 'by what it says')

# ---- 6. the plugin list each node check reads by default -----------------------------
foreach ($js in 'Audit-ModMenus', 'Check-SkyUIMenus', 'Check-CreationForms') {
    $rel = "scripts/mods/$js.js"
    $code = Text $rel
    $want = $null
    $m = [regex]::Match($code, "opt\('plugins', path\.join\(data, '\.\.', '\.\.', 'Profile', '(\w+)', 'plugins\.txt'\)\)")
    if ($m.Success) { $want = 'Profile\' + $m.Groups[1].Value + '\plugins.txt' }
    else {
        $m = [regex]::Match($code, "list = '((?:[^'\\]|\\.)*plugins\.txt)'")
        if ($m.Success) { $want = $m.Groups[1].Value -replace '\\\\', '\' }
    }
    Yes ("{0}'s help names the plugin list it reads with no --plugins ({1})" -f $js, $want) ($want -and (Flat (JsHelp $rel)).Contains($want))
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
