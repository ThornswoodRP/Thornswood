<#
  test-remote-header.ps1

      pwsh -NoProfile -File .\scripts\tests\test-remote-header.ps1

  Remote.ps1's header shows the commands a person copies. Each one has to
  parse, and every -Parameter on it has to be one Remote.ps1 declares.
  Issue #1085: the header showed -Dev, which the param block does not have,
  and nothing read the header, so the line failed when someone used it.

  The check is the same idea as tests\test-new-box-runbook.ps1: parse the
  text, and compare each parameter to the script's param block. A line
  written wrong on purpose has to be caught, or a checker that stopped
  seeing the header would pass by finding nothing.

  Read only. Never runs Remote.ps1 and never reaches the VPS.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent (Split-Path -Parent $Here)
$Remote = Join-Path $Repo 'scripts\vps\Remote.ps1'

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

$common = @('Verbose', 'Debug', 'ErrorAction', 'WarningAction', 'InformationAction', 'ErrorVariable',
            'WarningVariable', 'InformationVariable', 'OutVariable', 'OutBuffer', 'PipelineVariable', 'WhatIf', 'Confirm')

function HeaderOf([string]$path) {
    $text = [IO.File]::ReadAllText($path)
    $a = $text.IndexOf('<#')
    $b = $text.IndexOf('#>')
    if ($a -lt 0 -or $b -lt $a) { return $null }
    return $text.Substring($a, $b - $a)
}

# Lines in a header that are a Remote.ps1 command, and what is wrong with them.
function BadExamples([string]$header, [string]$path) {
    $errs = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$null, [ref]$errs)
    $names = @{}
    if ($ast.ParamBlock) {
        foreach ($p in $ast.ParamBlock.Parameters) { $names[$p.Name.VariablePath.UserPath] = $true }
    }
    $bad = @()
    if (@($errs).Count) { $bad += "$path does not parse" }
    $lines = @([regex]::Matches($header, '(?m)^\s*(\.\\scripts\\vps\\Remote\.ps1\b.*)$') | ForEach-Object { $_.Groups[1].Value.Trim() })
    if (-not $lines.Count) { $bad += 'the header shows no Remote.ps1 command' }
    foreach ($line in $lines) {
        $perr = $null
        $past = [System.Management.Automation.Language.Parser]::ParseInput($line, [ref]$null, [ref]$perr)
        if (@($perr).Count) { $bad += "does not parse: $line"; continue }
        foreach ($cmd in @($past.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true))) {
            $name = $cmd.GetCommandName()
            if (-not $name -or $name -notlike '*Remote.ps1') { continue }
            foreach ($e in @($cmd.CommandElements | Select-Object -Skip 1)) {
                if ($e -isnot [System.Management.Automation.Language.CommandParameterAst]) { continue }
                $p = $e.ParameterName
                if ($common -contains $p) { continue }
                if (-not $names.ContainsKey($p)) { $bad += "Remote.ps1 has no -$p" }
            }
        }
    }
    return @($bad)
}

Yes 'Remote.ps1 is there' (Test-Path -LiteralPath $Remote)
$header = HeaderOf $Remote
Yes 'Remote.ps1 has a header' ([bool]$header)

$planted = ".\scripts\vps\Remote.ps1 `"Restart-Service W32Time`" -Dev"
$caught = @(BadExamples $planted $Remote)
Yes 'a header line with -Dev is caught' ($caught.Count -eq 1 -and $caught[0] -eq 'Remote.ps1 has no -Dev')

$real = @(BadExamples $header $Remote)
Yes 'every header example parses and passes only parameters Remote.ps1 has' ($real.Count -eq 0)
foreach ($b in $real) { Write-Host "        $b" }

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0