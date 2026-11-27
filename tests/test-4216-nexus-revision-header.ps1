<#
  test-4216-nexus-revision-header.ps1

      pwsh -NoProfile -File .\tests\test-4216-nexus-revision-header.ps1

  #4216. New-NexusRevision.ps1's first sentence, and the scripts\README.md row
  New-ScriptIndex.ps1 builds from it, said only that it moves mods to a new
  Nexus file, so the index hid every other way it makes a revision.

  The modes are read from the script itself, not listed here:
    - the parameters in the condition of its "Say which ..." refusal, the one
      a run with no mode stops on;
    - and each parameter with its own "-<name> ... takes no" refusal, the
      runs that do one thing alone (-Publish, -Discard).
  Each has to be a declared parameter, and the index row has to name it as
  -<name>. tests\test-script-index.ps1 holds that row to the header's first
  sentence, so the two together hold the header.

  Read only.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}

$path = Join-Path (Join-Path (Join-Path $Repo 'scripts') 'release') 'New-NexusRevision.ps1'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors)
Yes 'New-NexusRevision.ps1 parses' (@($errors).Count -eq 0)
$declared = @($ast.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath })
Yes ('it declares its parameters (' + $declared.Count + ')') ($declared.Count -gt 5)

# Every Die call, with its message text.
$dies = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] -and $n.GetCommandName() -eq 'Die' }, $true))
$modes = New-Object System.Collections.Generic.List[string]
$sayChecked = New-Object System.Collections.Generic.HashSet[string]
foreach ($d in $dies) {
    $msg = @($d.CommandElements)[1]
    if ($msg -isnot [System.Management.Automation.Language.StringConstantExpressionAst]) { continue }
    $text = $msg.Value
    # The refusal of a run with no mode: the variables of its condition.
    if ($text.StartsWith('Say which ')) {
        $if = $d.Parent
        while ($if -and $if -isnot [System.Management.Automation.Language.IfStatementAst]) { $if = $if.Parent }
        if ($if) {
            foreach ($v in @($if.Clauses[0].Item1.FindAll({ param($n) $n -is [System.Management.Automation.Language.VariableExpressionAst] }, $true))) {
                $name = $v.VariablePath.UserPath
                if ($declared -contains $name -and -not $modes.Contains($name)) { $modes.Add($name) }
                # #6501: the refusal's own text names each switch its condition reads.
                if ($declared -contains $name -and -not $sayChecked.Contains($name)) {
                    [void]$sayChecked.Add($name)
                    Yes ("the no-mode refusal names -$name, which its condition reads") ($text -match ('(?<![A-Za-z])-' + $name + '(?![A-Za-z])'))
                }
            }
        }
    }
    # A run that does one thing alone: "-<name> ... takes no ...".
    $m = [regex]::Match($text, '^-([A-Za-z]+) [^.]*\btakes no\b')
    if ($m.Success -and $declared -contains $m.Groups[1].Value -and -not $modes.Contains($m.Groups[1].Value)) { $modes.Add($m.Groups[1].Value) }
}
Yes ('the script names its modes in its refusals (' + ($modes -join ', ') + ')') ($modes.Count -ge 7 -and $modes.Contains('Mod') -and $modes.Contains('Publish'))

$index = [IO.File]::ReadAllText((Join-Path (Join-Path $Repo 'scripts') 'README.md'))
$row = @($index -split "\r?\n" | Where-Object { $_.StartsWith('| [release/New-NexusRevision.ps1](release/New-NexusRevision.ps1) |') })
Yes 'scripts\README.md has one row for New-NexusRevision.ps1' ($row.Count -eq 1)
foreach ($n in $modes) {
    Yes ("  and it names -$n") ($row.Count -eq 1 -and $row[0] -match ('(?<![A-Za-z])-' + $n + '(?![A-Za-z])'))
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
