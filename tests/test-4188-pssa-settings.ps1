<#
  test-4188-pssa-settings.ps1

      pwsh -NoProfile -File .\tests\test-4188-pssa-settings.ps1

  Issue #4188. .github\lint\PSScriptAnalyzerSettings.psd1 turns off
  PSAvoidUsingConvertToSecureStringWithPlainText and gives its reason as the
  places the rule would hit, each a file and a line number. Line numbers
  move with every edit to those files and nothing held the list to the
  tree, so by 13 Nov 2026 every one of the four was wrong (137, 78, 98 and
  212 for hits at 326, 79, 103 and 233).

  This finds the places the rule would hit the way PSScriptAnalyzer does:
  every ConvertTo-SecureString command given -AsPlainText, read from the
  parsed script (so a remote script inside a here-string is text, not a
  hit), in every tracked .ps1, .psm1 and .psd1. It holds:

    1. the settings file still turns the rule off, with a comment above it;
    2. the comment names every file with a hit, and no file without one;
    3. it gives no line numbers, which no check could keep true;
    4. the reader finds a planted hit, and passes one inside a here-string.

  Reads only. Connects to nothing.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$settingsPath = Join-Path $repo '.github\lint\PSScriptAnalyzerSettings.psd1'
$rule = 'PSAvoidUsingConvertToSecureStringWithPlainText'

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

# The ConvertTo-SecureString -AsPlainText commands in one script's text.
function Get-PlainSecureHits([string]$text) {
    $tokens = $null; $errors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseInput($text, [ref]$tokens, [ref]$errors)
    return @($ast.FindAll({
        param($n)
        $n -is [System.Management.Automation.Language.CommandAst] -and
        $n.GetCommandName() -eq 'ConvertTo-SecureString' -and
        @($n.CommandElements | Where-Object {
            $_ -is [System.Management.Automation.Language.CommandParameterAst] -and
            'AsPlainText'.StartsWith($_.ParameterName, [StringComparison]::OrdinalIgnoreCase) -and $_.ParameterName.Length -ge 3
        }).Count -gt 0
    }, $true))
}

# ---- 4. the reader -----------------------------------------------------------
Yes '4. the reader finds a planted ConvertTo-SecureString -AsPlainText' (
    @(Get-PlainSecureHits '$s = ConvertTo-SecureString $pw -AsPlainText -Force').Count -eq 1)
Yes '   and passes one that is text inside a here-string' (
    @(Get-PlainSecureHits ('$far = @"' + "`n" + '`$s = ConvertTo-SecureString `$pw -AsPlainText -Force' + "`n" + '"@')).Count -eq 0)
Yes '   and one with no -AsPlainText' (
    @(Get-PlainSecureHits '$s = ConvertTo-SecureString $enc -Key $k').Count -eq 0)

# ---- the places in the tree ---------------------------------------------------
Push-Location $repo
try { $tracked = @(git ls-files '*.ps1' '*.psm1' '*.psd1') } finally { Pop-Location }
Yes ('git lists the PowerShell files ({0})' -f $tracked.Count) ($LASTEXITCODE -eq 0 -and $tracked.Count -gt 100)
$hitFiles = @(foreach ($f in $tracked) {
    $path = Join-Path $repo $f
    if (-not (Test-Path -LiteralPath $path)) { continue }
    if (@(Get-PlainSecureHits ([IO.File]::ReadAllText($path))).Count) { $f -replace '\\', '/' }
}) | Sort-Object -Unique
Yes ('the rule would hit {0} file(s) today: {1}' -f $hitFiles.Count, ($hitFiles -join ', ')) ($hitFiles.Count -gt 0)

# ---- 1 to 3. the settings file -------------------------------------------------
$settings = [IO.File]::ReadAllText($settingsPath)
$turnedOff = @((Import-PowerShellDataFile -LiteralPath $settingsPath).ExcludeRules)
Yes ('1. the settings turn ' + $rule + ' off') ($turnedOff -contains $rule)
$comment = (@($settings -split "`r?`n" | Where-Object { $_ -match '^\s*#' }) -join "`n")
Yes '   with its reason in the comment above' ($comment.Contains($rule))
$named = @([regex]::Matches($comment, '[A-Za-z0-9_./\\-]+\.ps[dm]?1') | ForEach-Object { $_.Value -replace '\\', '/' } | Sort-Object -Unique)
$missing = @($hitFiles | Where-Object { $named -notcontains $_ })
$extra = @($named | Where-Object { $hitFiles -notcontains $_ })
Yes ('2. the comment names every file the rule would hit (not named: ' + $(if ($missing.Count) { $missing -join ', ' } else { 'none' }) + ')') ($missing.Count -eq 0)
Yes ('   and no file it would not (named but no hit: ' + $(if ($extra.Count) { $extra -join ', ' } else { 'none' }) + ')') ($extra.Count -eq 0)
$lines = @([regex]::Matches($comment, '\.ps[dm]?1:\d+') | ForEach-Object { $_.Value })
Yes ('3. it gives no line numbers, which move with every edit (' + $(if ($lines.Count) { $lines -join ', ' } else { 'none' }) + ')') ($lines.Count -eq 0)

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
